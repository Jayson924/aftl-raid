// site-write permission rules against a stubbed Supabase REST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../../netlify/lib/session.js';
import { handler } from '../../netlify/functions/site-write.js';

process.env.SESSION_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.OWNER_DISCORD_ID = 'owner';

// In-memory tables: eq filters, POST insert or upsert, PATCH, DELETE, and rpc calls recorded.
function stubDb(tables) {
  const rpcs = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (parts.at(-2) === 'rpc') { rpcs.push({ fn: parts.at(-1), body }); return new Response('1', { status: 200 }); }
    const table = parts.at(-1);
    const filters = [...u.searchParams].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
    const match = (row) => filters.every(([k, f]) => String(row[k]) === f.replace(/^eq\./, ''));
    const rows = tables[table] || (tables[table] = []);
    let result;
    if (method === 'GET') result = rows.filter(match);
    else if (method === 'POST') {
      const keys = u.searchParams.get('on_conflict')?.split(',');
      result = [].concat(body).map((b) => {
        const existing = keys && rows.find((r) => keys.every((k) => r[k] === b[k]));
        if (existing) return Object.assign(existing, b);
        const row = { id: `${table}-${rows.length + 1}`, ...b };
        rows.push(row);
        return row;
      });
    } else if (method === 'PATCH') { result = rows.filter(match); for (const r of result) Object.assign(r, body); }
    else if (method === 'DELETE') { result = rows.filter(match); tables[table] = rows.filter((r) => !match(r)); }
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return rpcs;
}

function fixture() {
  return {
    app_users: [
      { discord_id: 'owner', role: 'admin' },
      { discord_id: 'admin2', role: 'admin' },
      { discord_id: 'editor', role: 'editor' },
      { discord_id: 'mate', role: 'guildmate', display_name: 'Mate' },
      { discord_id: 'other', role: 'guildmate' },
    ],
    players: [
      { id: 'p-mate', discord_id: 'mate', name: 'Litten', synced_at: null, role: 'Saint' },
      { id: 'p-synced', discord_id: 'mate', name: 'Synced', synced_at: '2026-10-01', role: 'Majesty' },
      { id: 'p-other', discord_id: 'other', name: 'Keeper', synced_at: null },
    ],
    player_cards: [], player_extra_cards: [{ id: 'x1', player_id: 'p-other', card_name: 'Bishop Gaius', rarity: 'epic', amount: 2 }],
    personal_raids: [{ id: 'r1', discord_id: 'mate', player_id: 'p-mate', current_clears: 1, max_clears: 1 }],
    shopping_list: [], character_groups: [{ id: 'g-other', discord_id: 'other' }], saved_builds: [],
  };
}

const call = (who, action, args = {}) => handler({ httpMethod: 'POST', body: JSON.stringify({ session: who && signSession(who, process.env.SESSION_SECRET), action, ...args }) });
const parse = async (res) => { const r = await res; return { status: r.statusCode, ...JSON.parse(r.body) }; };

test('nobody can raise their own role through their profile', async () => {
  const db = fixture(); stubDb(db);
  const res = await parse(call('mate', 'user.updateSelf', { fields: { display_name: 'New', role: 'admin' } }));
  assert.equal(res.status, 200);
  const mate = db.app_users.find((u) => u.discord_id === 'mate');
  assert.equal(mate.role, 'guildmate');
  assert.equal(mate.display_name, 'New');
});

test('only admins change users; only the owner changes another admin', async () => {
  let db = fixture(); stubDb(db);
  assert.equal((await parse(call('mate', 'admin.updateUser', { discord_id: 'other', fields: { role: 'admin' } }))).status, 403);
  assert.equal((await parse(call('editor', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'editor' } }))).status, 403);
  assert.equal((await parse(call('admin2', 'admin.updateUser', { discord_id: 'owner', fields: { role: 'guest' } }))).status, 403);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'owner', fields: { role: 'guest' } }))).status, 403);
  assert.equal((await parse(call('admin2', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'editor' } }))).status, 200);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'admin2', fields: { role: 'guildmate' } }))).status, 200);
  assert.equal(db.app_users.find((u) => u.discord_id === 'admin2').role, 'guildmate');
  db = fixture(); stubDb(db);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'superuser' } }))).status, 403);
});

test('characters: owners and admins edit, others cannot; new ones belong to the caller', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('other', 'player.update', { id: 'p-mate', fields: { name: 'Hacked' } }))).status, 403);
  assert.equal((await parse(call('other', 'player.delete', { id: 'p-mate' }))).status, 403);
  assert.equal((await parse(call('mate', 'player.update', { id: 'p-mate', fields: { name: 'Litten2', discord_id: 'other' } }))).status, 200);
  assert.equal(db.players[0].name, 'Litten2');
  assert.equal(db.players[0].discord_id, 'mate');
  // A synced character keeps its class and gear.
  await parse(call('mate', 'player.update', { id: 'p-synced', fields: { role: 'Saint', notes: 'hi' } }));
  assert.equal(db.players[1].role, 'Majesty');
  assert.equal(db.players[1].notes, 'hi');
  assert.equal((await parse(call('owner', 'player.update', { id: 'p-other', fields: { notes: 'admin note' } }))).status, 200);
  const added = await parse(call('mate', 'player.add', { fields: { name: 'Alt', discord_id: 'other', whitelisted: true } }));
  assert.equal(added.data.discord_id, 'mate');
  assert.equal(added.data.whitelisted, undefined);
  assert.equal((await parse(call('mate', 'player.adminFlags', { id: 'p-mate', fields: { whitelisted: true } }))).status, 403);
});

test('lineup completion and tickets need an editor', async () => {
  const db = fixture(); const rpcs = stubDb(db);
  assert.equal((await parse(call('mate', 'players.lineupCompletion', { names: ['Keeper'], column: 'bdn_classic_completed', completed: true }))).status, 403);
  assert.equal((await parse(call('editor', 'players.lineupCompletion', { names: ['Keeper'], column: 'role', completed: true }))).status, 403);
  assert.equal((await parse(call('editor', 'players.lineupCompletion', { names: ['Keeper'], column: 'bdn_classic_completed', completed: true }))).status, 200);
  assert.ok(db.players[2].bdn_classic_completed);
  assert.equal((await parse(call('mate', 'players.ticketUsed', { names: ['Keeper'], raid: 'BDN Classic', used: true }))).status, 403);
  await parse(call('editor', 'players.ticketUsed', { names: ['Keeper'], raid: 'BDN Classic', used: true }));
  assert.deepEqual(rpcs, [{ fn: 'set_ticket_used', body: { p_raid: 'BDN Classic', p_used: true, p_names: ['Keeper'] } }]);
});

test('cards and extras follow the character owner', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('other', 'cards.set', { player_id: 'p-mate', entries: [{ slot_index: 3, rarity: 'legend' }] }))).status, 403);
  await parse(call('mate', 'cards.set', { player_id: 'p-mate', entries: [{ slot_index: 3, rarity: 'legend' }, { slot_index: 4, rarity: 'epic' }] }));
  await parse(call('mate', 'cards.set', { player_id: 'p-mate', entries: [{ slot_index: 3, rarity: 'unique' }, { slot_index: 4, rarity: null }] }));
  assert.deepEqual(db.player_cards.map((c) => [c.slot_index, c.rarity]), [[3, 'unique']]);
  assert.equal((await parse(call('mate', 'extras.setAmount', { id: 'x1', amount: 9 }))).status, 403);
  const added = await parse(call('other', 'extras.add', { player_id: 'p-other', card_name: 'Bishop Gaius', rarity: 'epic', amount: 3 }));
  assert.equal(added.amount, 5);
});

test('personal raids, groups and builds belong to their user', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('other', 'raids.step', { id: 'r1', delta: -1 }))).status, 403);
  assert.equal((await parse(call('mate', 'raids.step', { id: 'r1', delta: 1 }))).status, 403);
  assert.equal((await parse(call('mate', 'raids.step', { id: 'r1', delta: -1 }))).newClears, 0);
  assert.equal((await parse(call('mate', 'raids.add', { player_id: 'p-other', name: 'x' }))).status, 403);
  assert.equal((await parse(call('mate', 'player.setGroup', { id: 'p-mate', group_id: 'g-other' }))).status, 403);
  assert.equal((await parse(call('mate', 'groups.delete', { id: 'g-other' }))).status, 403);
  const build = await parse(call('mate', 'builds.save', { name: 'Mine', build: { a: 1 } }));
  assert.equal(build.data.discord_id, 'mate');
  assert.equal((await parse(call('other', 'builds.save', { id: build.data.id, name: 'Stolen', build: {} }))).status, 403);
});

test('no session, a bad session or an unknown action is refused', async () => {
  stubDb(fixture());
  assert.equal((await parse(call(null, 'user.updateSelf', { fields: {} }))).status, 401);
  assert.equal((await parse(handler({ httpMethod: 'POST', body: JSON.stringify({ session: 'v1.mate.9999999999999.bad', action: 'user.updateSelf' }) }))).status, 401);
  assert.equal((await parse(call('mate', 'players.dropTable'))).status, 400);
});
