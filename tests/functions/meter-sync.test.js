// meter-token and character-sync against a stubbed Supabase REST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, sha256 } from '../../netlify/lib/session.js';
import { handler as meterToken } from '../../netlify/functions/meter-token.js';
import { handler as characterSync } from '../../netlify/functions/character-sync.js';

process.env.SESSION_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';

// A tiny in-memory Supabase: tables as arrays, PostgREST eq filters only.
function stubDb(tables) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, table, body, query: u.search });
    const filters = [...u.searchParams].filter(([k]) => !['select', 'order'].includes(k)).map(([k, v]) => [k, v.replace(/^eq\./, '')]);
    const match = (row) => filters.every(([k, v]) => String(row[k]) === v);
    const rows = tables[table] || (tables[table] = []);
    let result;
    if (method === 'GET') result = rows.filter(match);
    else if (method === 'POST') { const row = { id: `id-${rows.length + 1}`, created_at: 'now', ...body }; rows.push(row); result = [row]; }
    else if (method === 'PATCH') { result = rows.filter(match); for (const r of result) Object.assign(r, body); }
    else if (method === 'DELETE') { result = rows.filter(match); tables[table] = rows.filter((r) => !match(r)); }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

const post = (body, headers = {}) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) });
const parse = (res) => ({ status: res.statusCode, ...JSON.parse(res.body) });

test('sessions verify only when signed with the secret and unexpired', () => {
  const token = signSession('123', 'test-secret');
  assert.equal(verifySession(token, 'test-secret'), '123');
  assert.equal(verifySession(token, 'other'), null);
  assert.equal(verifySession(token.replace(/.$/, 'x'), 'test-secret'), null);
  assert.equal(verifySession(signSession('123', 'test-secret', Date.now() - 31 * 86400 * 1000), 'test-secret'), null);
  assert.equal(verifySession('garbage', 'test-secret'), null);
});

test('meter-token refuses a bad session and a guest, mints for a guildmate', async () => {
  const db = { app_users: [{ discord_id: 'g1', role: 'guildmate' }, { discord_id: 'v1', role: 'guest' }] };
  stubDb(db);
  assert.equal(parse(await meterToken(post({ session: 'nope' }))).status, 401);
  assert.equal(parse(await meterToken(post({ session: signSession('v1', 'test-secret') }))).status, 403);
  const minted = parse(await meterToken(post({ session: signSession('g1', 'test-secret'), label: 'Desk PC' })));
  assert.equal(minted.status, 200);
  assert.ok(minted.token.length >= 40);
  assert.deepEqual(db.meter_tokens.map((t) => [t.discord_id, t.label]), [['g1', 'Desk PC']]);
  assert.equal(db.meter_tokens[0].token_hash, sha256(minted.token));
  assert.notEqual(db.meter_tokens[0].token_hash, minted.token);
  const revoked = parse(await meterToken(post({ session: signSession('g1', 'test-secret'), action: 'revoke' })));
  assert.equal(revoked.revoked, true);
  assert.equal(db.meter_tokens.length, 0);
});

test('a link code is approved on the site and picked up once by the meter', async () => {
  const db = { app_users: [{ discord_id: 'g1', role: 'guildmate', display_name: 'Satan', username: 'satan' }] };
  stubDb(db);
  const pickup = (code) => meterToken({ httpMethod: 'GET', headers: {}, queryStringParameters: { claim: code } });
  assert.equal(parse(await pickup('ABCDEFGH')).status, 404);
  const approved = parse(await meterToken(post({ session: signSession('g1', 'test-secret'), action: 'claim', code: 'abcdefgh', label: 'Win32' })));
  assert.equal(approved.status, 200);
  assert.equal(approved.display_name, 'Satan');
  assert.equal(approved.token, undefined);
  assert.equal(db.meter_tokens[0].claim_code, 'ABCDEFGH');
  const picked = parse(await pickup('ABCDEFGH'));
  assert.equal(picked.status, 200);
  assert.equal(picked.display_name, 'Satan');
  assert.equal(db.meter_tokens[0].token_hash, sha256(picked.token));
  assert.equal(db.meter_tokens[0].claim_token, null);
  assert.equal(parse(await pickup('ABCDEFGH')).status, 404);
  assert.equal(parse(await meterToken(post({ session: signSession('g1', 'test-secret'), action: 'claim', code: 'nope!' }))).status, 400);
});

test('character-sync creates, updates, and refuses another user\'s character', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }, { discord_id: 'v1', role: 'guest' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }, { token_hash: sha256('guest-token'), discord_id: 'v1' }],
    players: [{ id: 'p-old', name: 'Swipe', discord_id: null, role: 'Saleana' }, { id: 'p-other', name: 'Taken', discord_id: 'z9' }],
  };
  stubDb(db);
  const payload = { character: { name: 'Swipe', job: 'Elestra' }, build: { second_job: 'Elestra' }, panel: { HP: 1 }, meter_version: '1.2.1' };

  assert.equal(parse(await characterSync(post(payload))).status, 401);
  assert.equal(parse(await characterSync(post(payload, { 'x-meter-token': 'wrong' }))).status, 401);
  assert.equal(parse(await characterSync(post(payload, { 'x-meter-token': 'guest-token' }))).status, 403);
  assert.equal(parse(await characterSync(post({ build: {} }, { 'x-meter-token': token }))).status, 400);

  // An unowned row with that name is claimed and updated.
  const claimed = parse(await characterSync(post(payload, { 'x-meter-token': token })));
  assert.equal(claimed.status, 200);
  assert.equal(claimed.created, false);
  const row = db.players.find((p) => p.name === 'Swipe');
  assert.equal(row.discord_id, 'g1');
  assert.equal(row.role, 'Elestra');
  assert.deepEqual(row.build, { second_job: 'Elestra' });
  assert.ok(row.synced_at);
  assert.ok(db.meter_tokens[0].last_used_at);

  // A new name is inserted.
  const created = parse(await characterSync(post({ ...payload, character: { name: 'Alt', job: 'Sniper' } }, { 'x-meter-token': token })));
  assert.equal(created.created, true);
  assert.equal(db.players.find((p) => p.name === 'Alt').discord_id, 'g1');

  // Someone else's character is refused.
  const refused = parse(await characterSync(post({ ...payload, character: { name: 'Taken', job: 'Sniper' } }, { 'x-meter-token': token })));
  assert.equal(refused.status, 409);
  assert.equal(db.players.find((p) => p.name === 'Taken').discord_id, 'z9');
});

test('character-sync keeps characters of one game account on one account number', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [
      { id: 'p-main', name: 'Swipe', discord_id: 'g1', account_name: 'Satan', account_number: 2 },
      { id: 'p-set', name: 'Picked', discord_id: 'g1', account_number: 1 },
    ],
  };
  stubDb(db);
  const send = (name, account) => characterSync(post({ character: { name, job: 'Elestra', account }, build: {} }, { 'x-meter-token': token }));

  // A new character of a known account follows that account's number.
  await send('Alt', 'Satan');
  assert.equal(db.players.find((p) => p.name === 'Alt').account_number, 2);
  assert.equal(db.players.find((p) => p.name === 'Alt').account_name, 'Satan');
  // A number the owner set on this character stays, and later siblings of that account follow it.
  await send('Picked', 'Other');
  assert.equal(db.players.find((p) => p.name === 'Picked').account_number, 1);
  await send('Fresh', 'Other');
  assert.equal(db.players.find((p) => p.name === 'Fresh').account_number, 1);
  // A nickname no character carries a number for gets none.
  await send('Lone', 'Nobody');
  assert.equal(db.players.find((p) => p.name === 'Lone').account_number, undefined);
  // No nickname sent: nothing about accounts is touched.
  await send('Plain', '');
  assert.equal('account_name' in db.players.find((p) => p.name === 'Plain'), false);
});
