// site-write permission rules against a stubbed Supabase REST.
import test from 'node:test';
import fs from 'node:fs';
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
      { discord_id: 'pal', role: 'friend' },
      { discord_id: 'visitor', role: 'guest' },
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

test('only admins change users; only the owner edits another admin', async () => {
  let db = fixture(); stubDb(db);
  assert.equal((await parse(call('mate', 'admin.updateUser', { discord_id: 'other', fields: { role: 'admin' } }))).status, 403);
  assert.equal((await parse(call('editor', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'editor' } }))).status, 403);
  assert.equal((await parse(call('admin2', 'admin.updateUser', { discord_id: 'owner', fields: { role: 'guest' } }))).status, 403);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'owner', fields: { role: 'guest' } }))).status, 403);
  assert.equal((await parse(call('admin2', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'editor' } }))).status, 200);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'admin2', fields: { exclude: true } }))).status, 200);
  assert.equal(db.app_users.find((u) => u.discord_id === 'admin2').exclude, true);
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

test('a hand-built character gets its panel calculated; typed stats win and synced ones ignore builds', async () => {
  const db = fixture(); stubDb(db);
  const build = JSON.parse(fs.readFileSync(new URL('../../netlify/data/sim/defaults.json', import.meta.url), 'utf8')).build1;
  const added = await parse(call('pal', 'player.add', { fields: { name: 'Built', role: 'Elestra' }, build, hand_stats: { finalDamage: 12345, hp: '' } }));
  assert.equal(added.status, 200);
  const row = db.players.find((p) => p.name === 'Built');
  assert.ok(row.panel?.rows?.length);
  assert.ok(row.equipment.helmet.rarity && row.equipment.helmet.enhancement > 0);
  assert.equal(row.character_stats.finalDamage, 12345);
  assert.ok(row.character_stats.attackPower > 0 && row.character_stats.hp > 0);
  assert.deepEqual(row.overrides.hand_stats, { finalDamage: 12345 });
  // Re-saving keeps other override keys; a synced character never takes a build from the form.
  row.overrides.hand_set_wins = true;
  await parse(call('pal', 'player.update', { id: row.id, fields: { name: 'Built' }, build, hand_stats: {} }));
  assert.deepEqual(row.overrides, { hand_set_wins: true, hand_stats: {} });
  await parse(call('mate', 'player.update', { id: 'p-synced', fields: {}, build }));
  assert.equal(db.players[1].build, undefined);
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

function lineupFixture() {
  const db = fixture();
  db.lineups = [{ id: 'L1', name: 'BDN 1', raid_type: 'BDN Classic', completed: false }];
  db.lineup_players = [
    { id: 's1', lineup_id: 'L1', player_name: 'Litten', uses_ticket: false, pilot_name: null },
    { id: 's2', lineup_id: 'L1', player_name: 'Keeper', uses_ticket: true, pilot_name: 'Mate' },
  ];
  db.lineup_loot = []; db.lineup_payouts = []; db.loot_records = []; db.thread_requests = [];
  return db;
}

test('lineups, loot, records and thread requests need an editor', async () => {
  const db = lineupFixture(); stubDb(db);
  for (const [action, args] of [
    ['lineups.save', { fields: { name: 'x' }, slots: [] }], ['lineups.delete', { id: 'L1' }],
    ['lineups.update', { id: 'L1', fields: { raid_type: 'DDN Classic' } }], ['lineups.toggleCompleted', { id: 'L1' }],
    ['loot.add', { lineup_id: 'L1', item: 'Orb' }], ['loot.delete', { id: 'x' }],
    ['records.delete', { id: 'r' }], ['threads.request', { lineup_id: 'L1', kind: 'create' }],
  ]) {
    assert.equal((await parse(call('mate', action, args))).status, 403, action);
  }
  const saved = await parse(call('editor', 'lineups.save', { id: 'L1', fields: { name: 'Renamed' }, slots: [{ player_name: 'Keeper', slot_position: 1 }] }));
  assert.equal(saved.data.name, 'Renamed');
  assert.deepEqual(db.lineup_players.map((s) => s.player_name), ['Keeper']);
  const loot = await parse(call('editor', 'loot.add', { lineup_id: 'L1', item: ' Orb ' }));
  assert.equal(loot.data.item, 'Orb');
  assert.equal(loot.data.created_by, 'editor');
});

test('clearing a lineup marks its members and ticket runs', async () => {
  const db = lineupFixture(); const rpcs = stubDb(db);
  const res = await parse(call('editor', 'lineups.toggleCompleted', { id: 'L1' }));
  assert.equal(res.completed, true);
  assert.ok(db.players.find((p) => p.name === 'Litten').bdn_classic_completed);
  assert.ok(db.players.find((p) => p.name === 'Keeper').bdn_classic_completed);
  assert.deepEqual(rpcs, [{ fn: 'set_ticket_used', body: { p_raid: 'BDN Classic', p_used: true, p_names: ['Keeper'] } }]);
  // Un-clearing leaves the ticket runner marked.
  await parse(call('editor', 'lineups.toggleCompleted', { id: 'L1' }));
  assert.equal(db.players.find((p) => p.name === 'Litten').bdn_classic_completed, null);
  assert.ok(db.players.find((p) => p.name === 'Keeper').bdn_classic_completed);
});

test('a gold share is marked by its owner, its pilot or an editor, nobody else', async () => {
  const db = lineupFixture(); stubDb(db);
  db.app_users.push({ discord_id: 'stranger', role: 'guildmate', display_name: 'Nobody' });
  assert.equal((await parse(call('stranger', 'payouts.mark', { lineup_id: 'L1', member_name: 'Litten', amount: 10 }))).status, 403);
  assert.equal((await parse(call('mate', 'payouts.mark', { lineup_id: 'L1', member_name: 'Litten', amount: 10 }))).status, 200);
  // Mate pilots Keeper (owned by "other").
  assert.equal((await parse(call('mate', 'payouts.mark', { lineup_id: 'L1', member_name: 'Keeper', amount: 10 }))).status, 200);
  assert.deepEqual(db.lineup_payouts.map((p) => [p.member_name, p.discord_id]), [['Litten', 'mate'], ['Keeper', 'other']]);
  assert.equal((await parse(call('stranger', 'payouts.unmark', { lineup_id: 'L1', member_name: 'Keeper' }))).status, 403);
  assert.equal((await parse(call('editor', 'payouts.unmark', { lineup_id: 'L1', member_name: 'Keeper' }))).status, 200);
  assert.equal(db.lineup_payouts.length, 1);
});

test('site settings are admin-only', async () => {
  const db = fixture(); db.app_config = [{ key: 'power_index_max', value: '100000' }]; stubDb(db);
  assert.equal((await parse(call('editor', 'config.set', { key: 'power_index_max', value: '1' }))).status, 403);
  assert.equal((await parse(call('owner', 'config.set', { key: 'power_index_max', value: '90000' }))).status, 200);
  assert.deepEqual(db.app_config, [{ key: 'power_index_max', value: '90000' }]);
});

test('guests cannot add characters; friends can', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('visitor', 'player.add', { fields: { name: 'Nope' } }))).status, 403);
  assert.equal((await parse(call('pal', 'player.add', { fields: { name: 'Pal' } }))).status, 200);
  assert.ok(db.players.some((p) => p.name === 'Pal' && p.discord_id === 'pal'));
});

test('friends keep personal raids but not cards, shopping or saved builds', async () => {
  const db = fixture(); stubDb(db);
  db.players.push({ id: 'p-pal', discord_id: 'pal', name: 'Pal', synced_at: null });
  assert.equal((await parse(call('pal', 'raids.add', { player_id: 'p-pal', name: 'Nest', max_clears: 2 }))).status, 200);
  for (const [action, args] of [['shopping.add', { player_id: 'p-pal', item: 'Plate' }], ['extras.add', { player_id: 'p-pal', card_name: 'X', rarity: 'epic', amount: 1 }], ['builds.save', { name: 'B', build: {} }]]) {
    const res = await parse(call('pal', action, args));
    assert.equal(res.status, 403, action);
    assert.equal(res.error, 'Guildmates only');
  }
});

test('admins can set the friend role', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'visitor', fields: { role: 'friend' } }))).status, 200);
  assert.equal(db.app_users.find((u) => u.discord_id === 'visitor').role, 'friend');
});

test('admin is Discord-only: nobody grants or removes it on the site', async () => {
  const db = fixture(); stubDb(db);
  const grant = await parse(call('owner', 'admin.updateUser', { discord_id: 'mate', fields: { role: 'admin' } }));
  assert.equal(grant.status, 403);
  assert.equal(grant.error, 'Admin is set in Discord (Vice Members)');
  assert.equal((await parse(call('owner', 'admin.updateUser', { discord_id: 'admin2', fields: { role: 'guildmate' } }))).status, 403);
  assert.equal(db.app_users.find((u) => u.discord_id === 'admin2').role, 'admin');
});

test('raid marks: owners set the lineup raids and the hand-marked ones, nothing else', async () => {
  const db = fixture(); stubDb(db);
  assert.equal((await parse(call('mate', 'player.raidCompletion', { id: 'p-mate', column: 'bdn_memoria_completed', completed: true }))).status, 200);
  assert.ok(db.players[0].bdn_memoria_completed);
  assert.equal((await parse(call('mate', 'player.raidCompletion', { id: 'p-mate', column: 'bdn_memoria_completed', completed: false }))).status, 200);
  assert.equal(db.players[0].bdn_memoria_completed, null);
  assert.equal((await parse(call('mate', 'player.raidCompletion', { id: 'p-mate', column: 'ddn_classic_completed', completed: true }))).status, 200);
  assert.equal((await parse(call('mate', 'player.raidCompletion', { id: 'p-mate', column: 'synced_at', completed: true }))).status, 403);
  assert.equal((await parse(call('other', 'player.raidCompletion', { id: 'p-mate', column: 'abyssal_mire_completed', completed: true }))).status, 403);
});
