// meter-token and character-sync against a stubbed Supabase REST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, sha256 } from '../../netlify/lib/session.js';
import { handler as meterToken } from '../../netlify/functions/meter-token.js';
import { handler as characterSync } from '../../netlify/functions/character-sync.js';
import { handler as characterOverrides } from '../../netlify/functions/character-overrides.js';
import { deriveStats } from '../../netlify/lib/sync-derive.js';
import { calculatePanel } from '../../netlify/lib/sync-merge.js';

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
    const filters = [...u.searchParams].filter(([k]) => !['select', 'order'].includes(k));
    const test = (value, f) => (f.startsWith('in.(') ? f.slice(4, -1).split(',').includes(String(value)) : String(value) === f.replace(/^eq\./, ''));
    const match = (row) => filters.every(([k, f]) => test(row[k], f));
    const rows = tables[table] || (tables[table] = []);
    let result;
    if (method === 'GET') result = rows.filter(match);
    else if (method === 'POST') { result = [].concat(body).map((b) => ({ id: `id-${rows.length + 1}`, created_at: 'now', ...b })); rows.push(...result); }
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
  assert.deepEqual(row.build, { second_job: 'Elestra', game_fields: [] });
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

test('character-sync stores the weekly clears the login carried and keeps them when a sync has none', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [],
  };
  stubDb(db);
  const weekly_clears = {
    14501: { name: 'Black Dragon Nest (Classic)', clears: 1, entries: 4, limit: 10 },
    17610: { name: 'Desert Dragon Nest (Hardcore Mode)', clears: '1', entries: 0, limit: 0 },
    junk: { clears: 5 }, 14300: 'nope', 14410: { clears: -2, entries: 1e9 },
  };
  const payload = { character: { name: 'Swipe', job: 'Elestra', weekly_clears }, build: { second_job: 'Elestra' }, meter_version: '1.4.3' };
  assert.equal(parse(await characterSync(post(payload, { 'x-meter-token': token }))).status, 200);
  const row = db.players.find((p) => p.name === 'Swipe');
  assert.deepEqual(row.weekly_clears, {
    14501: { name: 'Black Dragon Nest (Classic)', clears: 1, entries: 4, limit: 10 },
    17610: { name: 'Desert Dragon Nest (Hardcore Mode)', clears: 1, entries: 0, limit: 0 },
    14410: { name: 'Stage 14410', clears: 0, entries: 999, limit: 0 },
  });
  assert.ok(Date.now() - Date.parse(row.weekly_clears_at) < 60e3);
  const readAt = row.weekly_clears_at;
  // An older toolbox sends no counts; the stored ones stay.
  assert.equal(parse(await characterSync(post({ ...payload, character: { name: 'Swipe', job: 'Elestra' } }, { 'x-meter-token': token }))).status, 200);
  assert.equal(row.weekly_clears[14501].clears, 1);
  assert.equal(row.weekly_clears_at, readAt);
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

// Shaped like the toolbox's payload: English slot names, the item tables' names, the calculator's panel.
const syncedBuild = {
  second_job: 'Elestra',
  equipment: [
    { slot: 'Helmet', name: 'Green Dragon Terminator Tiara', suffix: 'Iron Wall II', enhance: 11 },
    { slot: 'Shoes', name: 'Not An Item', enhance: 15 },
    { slot: 'Main weapon', name: 'Green Dragon Terminator Crystal Ball', suffix: 'Intellect II', enhance: 13 },
    { slot: 'Secondary weapon', name: 'Green Dragon Terminator Staff', suffix: 'Hero II', enhance: 13 },
  ],
  jewelry: [
    { slot: 'Necklace', name: 'Black Dragon Hunter Necklace', variant: 'AGI/INT' },
    { slot: 'Ring 2', name: 'Green Dragon Hunter Ring', variant: 'AGI/INT' },
  ],
};
const syncedPanel = {
  rows: [{ attr: 'Final damage', buffed: 4210 }, { attr: 'DEF', buffed: 30111.6 }, { attr: 'MDEF', buffed: 28000 }],
  summary: {
    HP: 213517, physical_max: 10375, magic_max: 23481, crit_percent: 87.3, crit_damage_percent: 11.302,
    'Fire attack %': 10, 'Water attack %': 42, 'Light attack %': 6, 'Dark attack %': 6.125,
  },
};

test('character-sync derives equipment, stats and suffixes from the build', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', suffix2: 'fire', equipment: { boots: { rarity: 'epic', level: '60', enhancement: 9 } } }],
  };
  stubDb(db);
  await characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: syncedBuild, panel: syncedPanel }, { 'x-meter-token': token }));
  const row = db.players[0];
  assert.deepEqual(row.equipment, {
    helmet: { level: '50', rarity: 'legend', enhancement: 11 },
    mainWeapon: { level: '50', rarity: 'legend', enhancement: 13 },
    subWeapon: { level: '50', rarity: 'legend', enhancement: 13 },
    necklace: { level: '70', rarity: 'legend', enhancement: 0 },
    ring2: { level: '50', rarity: 'legend', enhancement: 0 },
  });
  // The site recalculates the panel from the build; the meter's panel is only a fallback.
  const panel = calculatePanel(syncedBuild);
  assert.deepEqual(row.panel.summary, panel.summary);
  assert.deepEqual(row.character_stats, deriveStats(panel));
  assert.notEqual(row.character_stats.hp, 213517);
  assert.equal(row.suffix1, 'intellect');
  // A suffix the site has no key for leaves the old value.
  assert.equal(row.suffix2, 'fire');
});

test('a sync without gear or panel keeps hand-entered columns', async () => {
  const token = 'meter-token-value';
  const hand = { equipment: { helmet: { rarity: 'unique', level: '70', enhancement: 12 } }, character_stats: { attackPower: 9000 }, suffix1: 'fire' };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', ...structuredClone(hand) }],
  };
  stubDb(db);
  await characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: {} }, { 'x-meter-token': token }));
  const row = db.players[0];
  assert.deepEqual(row.equipment, hand.equipment);
  assert.deepEqual(row.character_stats, hand.character_stats);
  assert.equal(row.suffix1, 'fire');
});

test('character-sync replaces the cards the sync knows and leaves the rest', async () => {
  const token = 'meter-token-value';
  const slotNames = { 0: 'Deputy Umzaka', 1: 'Deputy Umhar', 2: 'Minotaur Knight', 3: 'Not In The Sync' };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    app_config: [{ key: 'card_slot_names', value: JSON.stringify(slotNames) }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1' }],
    player_cards: [
      { id: 'c1', player_id: 'p1', slot_index: 1, rarity: 'epic' },
      { id: 'c2', player_id: 'p1', slot_index: 2, rarity: 'legend' },
      { id: 'c3', player_id: 'p1', slot_index: 3, rarity: 'rare' },
      { id: 'c4', player_id: 'other', slot_index: 0, rarity: 'magic' },
    ],
  };
  stubDb(db);
  const send = (cardGrades) => characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: { card_grades: cardGrades } }, { 'x-meter-token': token }));
  const mine = () => db.player_cards.filter((c) => c.player_id === 'p1').map((c) => [c.slot_index, c.rarity]).sort((a, b) => a[0] - b[0]);

  // No graded card at all: the archive had not arrived, nothing changes.
  await send([{ name: 'Deputy Umzaka', grade: 'None' }, { name: 'Minotaur Knight', grade: 'None' }]);
  assert.deepEqual(mine(), [[1, 'epic'], [2, 'legend'], [3, 'rare']]);

  await send([{ name: 'Deputy Umzaka', grade: 'L' }, { name: 'Deputy Umhar', grade: 'S' }, { name: 'Minotaur Knight', grade: 'None' }]);
  // Synced grades replace their slots, None empties one, an unsynced slot keeps its row.
  assert.deepEqual(mine(), [[0, 'legend'], [1, 'unique'], [3, 'rare']]);
  assert.equal(db.player_cards.find((c) => c.player_id === 'other').rarity, 'magic');
});

test('overrides set on the site survive a sync and recalculate the panel', async () => {
  const token = 'meter-token-value';
  const base = { ...syncedBuild, card_grades: [], buffs: [] };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: base }],
  };
  stubDb(db);
  // The site saves hand-set fields from a loaded build.
  const edited = { ...base, title: 'Song of Wind', collection_level: 12, card_bonus_levels: { HP: 20 }, buffs: [{ skill: 'Battle Howl', level: 5 }] };
  const saved = parse(await characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', build: edited })));
  assert.equal(saved.status, 200);
  // Buffs never go onto the character; its panel must match the game's window.
  assert.deepEqual(saved.overrides, { title: 'Song of Wind', card_bonus_levels: { HP: 20 }, collection_level: 12 });
  const row = db.players[0];
  assert.equal(row.build.title, 'Song of Wind');
  assert.ok(row.panel && row.panel.summary && row.panel.rows.length);
  assert.ok(row.character_stats.hp > 0);
  // Another user cannot write, and a never-synced character is refused.
  assert.equal(parse(await characterOverrides(post({ session: signSession('v9', 'test-secret'), player_id: 'p1', build: edited }))).status, 403);
  // A later sync keeps the overrides on top of the fresh build and recalculates.
  const synced = parse(await characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: { ...base, title: 'None', buffs: [{ skill: 'Physical Mastery', level: 6 }] }, panel: { summary: { HP: 1 } } }, { 'x-meter-token': token })));
  assert.equal(synced.status, 200);
  assert.equal(db.players[0].build.title, 'Song of Wind');
  assert.equal(db.players[0].build.collection_level, 12);
  assert.deepEqual(db.players[0].build.buffs, [{ skill: 'Physical Mastery', level: 6 }]);
  assert.notEqual(db.players[0].panel.summary.HP, 1);
});


test('fields the game sent beat hand-set ones unless the character keeps hand-set values', async () => {
  const token = 'meter-token-value';
  const base = { ...syncedBuild, card_grades: [], buffs: [] };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: base, overrides: { title: 'Song of Wind', collection_level: 12 } }],
  };
  stubDb(db);
  const sync = (gameFields) => characterSync(post({
    character: { name: 'Swipe', job: 'Elestra', game_fields: gameFields },
    build: { ...base, title: 'Desert Resource · Explorer', collection_level: 30 },
  }, { 'x-meter-token': token }));

  assert.equal(parse(await sync(['title', 'collection_level', 'bogus'])).status, 200);
  assert.deepEqual(db.players[0].build.game_fields, ['title', 'collection_level']);
  assert.equal(db.players[0].build.title, 'Desert Resource · Explorer');
  assert.equal(db.players[0].build.collection_level, 30);

  // An older meter sends no game fields; the hand-set values apply as before.
  await sync(undefined);
  assert.equal(db.players[0].build.title, 'Song of Wind');

  // The toggle makes hand-set values win, and later partial saves keep it.
  const save = (body) => characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', ...body }));
  assert.equal(parse(await save({ build: {}, hand_set_wins: true })).status, 200);
  await save({ build: { collection_level: 12 } });
  assert.equal(db.players[0].overrides.hand_set_wins, true);
  await sync(['title', 'collection_level']);
  assert.equal(db.players[0].build.title, 'Song of Wind');
  assert.equal(db.players[0].build.collection_level, 12);
});

test('a partial override save keeps fields saved earlier', async () => {
  const base = { ...syncedBuild, card_grades: [], buffs: [] };
  const engravings = [{ slot: 'Helmet', grade: 'Rare', rank: 1 }];
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: base }],
  };
  stubDb(db);
  const save = (build) => characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', build }));
  assert.equal(parse(await save({ ...base, engravings })).status, 200);
  assert.equal(parse(await save({ title: 'Song of Wind' })).status, 200);
  const row = db.players[0];
  assert.deepEqual(row.overrides.engravings, engravings);
  assert.equal(row.overrides.title, 'Song of Wind');
  assert.deepEqual(row.build.engravings, engravings);
  assert.equal(row.build.title, 'Song of Wind');
});

test('passive levels are saved per character and survive a sync; party buffs are not', async () => {
  const token = 'meter-token-value';
  const top = [{ skill: 'Physical Mastery', level: 6 }, { skill: 'Mental Mastery', level: 6 }, { skill: 'Mind Conquer', level: 6 }];
  const base = { ...syncedBuild, card_grades: [], buffs: top };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: base }],
  };
  stubDb(db);
  const buffs = [{ skill: 'Mental Mastery', level: 1 }, { skill: 'Mind Conquer', level: 0 }, { skill: 'Battle Howl', level: 5 }];
  const saved = parse(await characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', build: { buffs } })));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.overrides.passives, [{ skill: 'Mental Mastery', level: 1 }, { skill: 'Mind Conquer', level: 0 }]);
  const levels = () => Object.fromEntries(db.players[0].build.buffs.map((b) => [b.skill, b.level]));
  assert.deepEqual(levels(), { 'Physical Mastery': 6, 'Mental Mastery': 1 });
  await characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: base }, { 'x-meter-token': token }));
  assert.deepEqual(levels(), { 'Physical Mastery': 6, 'Mental Mastery': 1 });
});

test('a typed name cannot move a synced character to another class; a captured name can', async () => {
  const token = 'meter-token-value';
  const base = { ...syncedBuild, card_grades: [], buffs: [] };
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Moonlord', build: base, synced_at: 'earlier' }],
  };
  stubDb(db);
  const send = (job, source) => characterSync(post({ character: { name: 'Swipe', job, name_source: source }, build: base }, { 'x-meter-token': token }));
  const refused = parse(await send('Elestra', 'typed'));
  assert.equal(refused.status, 422);
  assert.match(refused.error, /Swipe is a Moonlord on Afterlight, but this Elestra build has a typed name/);
  assert.equal(db.players[0].role, 'Moonlord');
  assert.equal(parse(await send('Moonlord', 'typed')).status, 200);
  assert.equal(parse(await send('Gladiator', 'game')).status, 200);
  assert.equal(db.players[0].role, 'Gladiator');
});

test('a sync without cards keeps the stored cards in the build and the panel', async () => {
  const token = 'meter-token-value';
  const cards = [{ name: 'Deputy Umzaka', grade: 'L' }];
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: { ...syncedBuild, card_grades: cards }, synced_at: 'earlier' }],
  };
  stubDb(db);
  const send = (cardGrades) => characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: { ...syncedBuild, card_grades: cardGrades } }, { 'x-meter-token': token }));
  await send([{ name: 'Deputy Umzaka', grade: 'None' }]);
  assert.deepEqual(db.players[0].build.card_grades, cards);
  await send([{ name: 'Deputy Umzaka', grade: 'S' }]);
  assert.deepEqual(db.players[0].build.card_grades, [{ name: 'Deputy Umzaka', grade: 'S' }]);
});

test('cleared cards stay cleared while the same set is resent; a new set replaces them', async () => {
  const token = 'meter-token-value';
  const cards = [{ name: 'Deputy Umzaka', grade: 'L' }, { name: 'Deputy Umhar', grade: 'S' }];
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Elestra', build: { ...syncedBuild, card_grades: cards }, synced_at: 'earlier', overrides: { title: 'Song of Wind' } }],
    player_cards: [{ player_id: 'p1', slot_index: 0, rarity: 'legend' }],
  };
  stubDb(db);
  const cleared = parse(await characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', clear_cards: true })));
  assert.equal(cleared.status, 200);
  const grades = () => db.players[0].build.card_grades.map((c) => c.grade);
  assert.deepEqual(grades(), ['None', 'None']);
  assert.equal(db.player_cards.length, 0);
  assert.deepEqual(db.players[0].overrides.cleared_cards, ['Deputy Umhar|S', 'Deputy Umzaka|L']);
  assert.equal(db.players[0].overrides.title, 'Song of Wind');

  const send = (cardGrades) => characterSync(post({ character: { name: 'Swipe', job: 'Elestra' }, build: { ...syncedBuild, card_grades: cardGrades } }, { 'x-meter-token': token }));
  await send(cards);
  assert.deepEqual(grades(), ['None', 'None']);
  await send([{ name: 'Deputy Umzaka', grade: 'A' }]);
  assert.deepEqual(grades(), ['A']);
  assert.equal(db.players[0].overrides.cleared_cards, undefined);
  assert.equal(db.players[0].overrides.title, 'Song of Wind');
});

test('the role column uses the site spelling of the class', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p1', name: 'Swipe', discord_id: 'g1', role: 'Moonlord', build: { ...syncedBuild }, synced_at: 'earlier' }],
  };
  stubDb(db);
  const sent = parse(await characterSync(post({ character: { name: 'Swipe', job: 'Moonlord', name_source: 'typed' }, build: { ...syncedBuild, second_job: 'Moonlord' } }, { 'x-meter-token': token })));
  assert.equal(sent.status, 200);
  assert.equal(db.players[0].role, 'Moon Lord');
  assert.equal(db.players[0].build.second_job, 'Moonlord');
});

test('a saved self buff that shares a passive name is not kept as the passive', async () => {
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    players: [{ id: 'p1', name: 'Clone', discord_id: 'g1', role: 'Abyss Walker', build: { ...syncedBuild, card_grades: [] } }],
  };
  stubDb(db);
  const buffs = [
    { key: 'Self buff|Abyss Walker|Increased Abyss Chakra', skill: 'Increased Abyss Chakra', level: 1 },
    { key: 'Passive|Abyss Walker|Increased Abyss Chakra', skill: 'Increased Abyss Chakra', level: 0 },
  ];
  const saved = parse(await characterOverrides(post({ session: signSession('g1', 'test-secret'), player_id: 'p1', build: { buffs } })));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.overrides.passives, [{ skill: 'Increased Abyss Chakra', level: 0 }]);
});

test('the synced guild sets the in-guild flag; a blank or missing guild leaves it alone', async () => {
  const token = 'meter-token-value';
  const db = {
    app_users: [{ discord_id: 'g1', role: 'guildmate' }],
    meter_tokens: [{ token_hash: sha256(token), discord_id: 'g1' }],
    players: [{ id: 'p-left', name: 'Leaver', discord_id: 'g1', whitelisted: true }, { id: 'p-old', name: 'Oldtool', discord_id: 'g1', whitelisted: true }],
  };
  stubDb(db);
  const sync = (name, guild) => characterSync(post({ character: { name, job: 'Elestra', ...(guild === undefined ? {} : { guild }) }, build: {} }, { 'x-meter-token': token }));
  const row = (name) => db.players.find((p) => p.name === name);

  await sync('Member', ' AfterLight ');
  assert.equal(row('Member').whitelisted, true);
  assert.equal(row('Member').whitelist_ignored, undefined);

  await sync('Outsider', 'Other Guild');
  assert.equal(row('Outsider').whitelisted, false);
  assert.equal(row('Outsider').whitelist_ignored, true);

  await sync('Leaver', 'New Home');
  assert.equal(row('Leaver').whitelisted, false);
  assert.equal(row('Leaver').whitelist_ignored, undefined);

  await sync('Oldtool', '');
  assert.equal(row('Oldtool').whitelisted, true);

  await sync('Oldtool');
  assert.equal(row('Oldtool').whitelisted, true);
});
