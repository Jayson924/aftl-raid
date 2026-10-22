// admin-delete-user against a stubbed Supabase REST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../../netlify/lib/session.js';
import { handler } from '../../netlify/functions/admin-delete-user.js';

process.env.SESSION_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';

// In-memory tables with PostgREST eq / neq filters.
function stubDb(tables) {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const method = init.method || 'GET';
    const filters = [...u.searchParams].filter(([k]) => k !== 'select');
    const test = (value, f) => (f.startsWith('neq.') ? String(value) !== f.slice(4) : String(value) === f.replace(/^eq\./, ''));
    const match = (row) => filters.every(([k, f]) => test(row[k], f));
    const rows = tables[table] || (tables[table] = []);
    let result = rows.filter(match);
    if (method === 'DELETE') tables[table] = rows.filter((r) => !match(r));
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

function fixture() {
  return {
    app_users: [
      { discord_id: 'admin', role: 'admin', display_name: 'Boss' },
      { discord_id: 'gone', role: 'guildmate', display_name: 'Leaver', username: 'leaver' },
      { discord_id: 'other', role: 'guildmate', display_name: 'Stayer' },
    ],
    players: [
      { id: 'p1', discord_id: 'gone', name: 'Litten' },
      { id: 'p2', discord_id: 'gone', name: 'Twin' },
      { id: 'p3', discord_id: 'other', name: 'Twin' },
      { id: 'p4', discord_id: 'other', name: 'Keeper' },
    ],
    player_cards: [{ player_id: 'p1' }, { player_id: 'p1' }, { player_id: 'p4' }],
    player_extra_cards: [{ player_id: 'p2' }],
    personal_raids: [{ discord_id: 'gone', player_id: 'p1' }, { discord_id: 'other', player_id: 'p4' }],
    shopping_list: [{ discord_id: 'gone', player_id: 'p2' }],
    saved_builds: [], meter_tokens: [], character_groups: [{ discord_id: 'gone' }],
    lineups: [{ id: 'L1', name: 'BDN Team 1' }],
    lineup_players: [
      { id: 's1', lineup_id: 'L1', player_id: null, player_name: 'Litten' },
      { id: 's2', lineup_id: 'L1', player_id: null, player_name: 'Twin' },
      { id: 's3', lineup_id: 'L1', player_id: null, player_name: 'Keeper' },
    ],
    lineup_payouts: [{ member_name: 'Litten', discord_id: 'gone' }],
  };
}

const session = (id) => signSession(id, process.env.SESSION_SECRET);
const preview = (caller, target) => handler({ httpMethod: 'GET', headers: { 'X-Session': session(caller) }, queryStringParameters: { discord_id: target } });
const remove = (caller, target, extra = {}) => handler({ httpMethod: 'POST', body: JSON.stringify({ session: session(caller), discord_id: target, confirm: true, ...extra }) });
const parse = (res) => ({ status: res.statusCode, ...JSON.parse(res.body) });

test('preview counts what would go and deletes nothing', async () => {
  const db = fixture();
  stubDb(db);
  const res = parse(await preview('admin', 'gone'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.counts, { characters: 2, cards: 3, personalRaids: 1, shoppingList: 1, savedBuilds: 0, meterLinks: 0, characterGroups: 1, guestCharacters: 0, lineupSlots: 1 });
  assert.deepEqual(res.lineups, ['BDN Team 1']);
  assert.equal(db.players.length, 4);
});

test('delete removes the user, their characters and data, and frees their lineup slots', async () => {
  const db = fixture();
  stubDb(db);
  const res = parse(await remove('admin', 'gone'));
  assert.equal(res.status, 200);
  assert.deepEqual(db.app_users.map((u) => u.discord_id), ['admin', 'other']);
  assert.deepEqual(db.players.map((p) => p.id), ['p3', 'p4']);
  assert.deepEqual(db.player_cards, [{ player_id: 'p4' }]);
  assert.equal(db.player_extra_cards.length, 0);
  assert.deepEqual(db.personal_raids, [{ discord_id: 'other', player_id: 'p4' }]);
  assert.equal(db.shopping_list.length, 0);
  assert.equal(db.character_groups.length, 0);
  // "Twin" is also another user's character, so that slot stays.
  assert.deepEqual(db.lineup_players.map((s) => s.id), ['s2', 's3']);
  // Loot history is kept.
  assert.equal(db.lineup_payouts.length, 1);
});

test('only admins may delete, and never themselves or another admin', async () => {
  stubDb(fixture());
  assert.equal(parse(await remove('other', 'gone')).status, 403);
  assert.equal(parse(await remove('admin', 'admin')).status, 400);
  const db = fixture();
  db.app_users.push({ discord_id: 'admin2', role: 'admin' });
  stubDb(db);
  assert.equal(parse(await remove('admin', 'admin2')).status, 400);
  assert.equal(parse(await handler({ httpMethod: 'POST', body: JSON.stringify({ session: 'bad', discord_id: 'gone', confirm: true }) })).status, 401);
});

test('a POST without confirm deletes nothing', async () => {
  const db = fixture();
  stubDb(db);
  assert.equal(parse(await remove('admin', 'gone', { confirm: false })).status, 400);
  assert.equal(db.app_users.length, 3);
});
