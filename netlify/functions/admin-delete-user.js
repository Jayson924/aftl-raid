// Admin-only removal of a user and everything that belongs to them.
// GET  ?discord_id=…  (X-Session header): what a delete would remove, deleting nothing.
// POST {session, discord_id, confirm: true}: deletes it. Children go first, so a failure
// part-way leaves the user in place and the delete can simply be run again.
// Loot history (who held or was paid what) is kept: it is a record, stored by name.
import { verifySession } from '../lib/session.js';
import { sbGet, sbDelete, userRecord, json } from '../lib/db.js';

const enc = encodeURIComponent;

// Owned by the user, keyed by discord_id.
const USER_TABLES = ['personal_raids', 'shopping_list', 'saved_builds', 'meter_tokens', 'character_groups'];
// Owned by a character, keyed by player_id.
const PLAYER_TABLES = ['player_cards', 'player_extra_cards', 'personal_raids', 'shopping_list'];

// Lineup slots store the character name; only names no other user's character shares are freed.
async function lineupSlots(players, discordId) {
  const slots = new Map();
  for (const p of players) {
    for (const row of await sbGet('lineup_players', `player_id=eq.${enc(p.id)}&select=id,lineup_id`)) slots.set(row.id, row);
    const namesakes = await sbGet('players', `name=eq.${enc(p.name)}&discord_id=neq.${enc(discordId)}&select=id`);
    if (namesakes.length) continue;
    for (const row of await sbGet('lineup_players', `player_name=eq.${enc(p.name)}&select=id,lineup_id`)) slots.set(row.id, row);
  }
  return [...slots.values()];
}

async function plan(discordId) {
  const players = await sbGet('players', `discord_id=eq.${enc(discordId)}&select=id,name`);
  const ids = players.map((p) => p.id);
  const count = async (table, query) => (await sbGet(table, `${query}&select=*`)).length;
  const perPlayer = async (table) => {
    let n = 0;
    for (const id of ids) n += await count(table, `player_id=eq.${enc(id)}`);
    return n;
  };
  const slots = await lineupSlots(players, discordId);
  const lineupIds = [...new Set(slots.map((s) => s.lineup_id))];
  const lineups = [];
  for (const id of lineupIds) lineups.push(...(await sbGet('lineups', `id=eq.${enc(id)}&select=name`)).map((l) => l.name));
  return {
    players,
    slots,
    counts: {
      characters: players.length,
      cards: (await perPlayer('player_cards')) + (await perPlayer('player_extra_cards')),
      personalRaids: await count('personal_raids', `discord_id=eq.${enc(discordId)}`),
      shoppingList: await count('shopping_list', `discord_id=eq.${enc(discordId)}`),
      savedBuilds: await count('saved_builds', `discord_id=eq.${enc(discordId)}`),
      meterLinks: await count('meter_tokens', `discord_id=eq.${enc(discordId)}`),
      characterGroups: await count('character_groups', `discord_id=eq.${enc(discordId)}`),
      lineupSlots: slots.length,
    },
    lineups,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'GET or POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SESSION_SECRET) return json(500, { error: 'Server not configured' });

  let body = {};
  if (event.httpMethod === 'POST') {
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  }
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const session = event.httpMethod === 'GET' ? headers['x-session'] : body.session;
  const callerId = verifySession(session, process.env.SESSION_SECRET);
  if (!callerId) return json(401, { error: 'Log in again first' });
  const targetId = String((event.httpMethod === 'GET' ? event.queryStringParameters?.discord_id : body.discord_id) || '').trim();
  if (!targetId) return json(400, { error: 'discord_id is required' });

  try {
    const caller = await userRecord(callerId);
    if (caller?.role !== 'admin') return json(403, { error: 'Admins only' });
    if (targetId === callerId) return json(400, { error: 'You cannot delete yourself' });
    const target = await userRecord(targetId);
    if (!target) return json(404, { error: 'No such user' });
    if (target.role === 'admin') return json(400, { error: 'Demote an admin before deleting them' });

    const p = await plan(targetId);
    if (event.httpMethod === 'GET') return json(200, { user: { displayName: target.display_name, username: target.username }, counts: p.counts, lineups: p.lineups, characters: p.players.map((c) => c.name) });
    if (body.confirm !== true) return json(400, { error: 'confirm: true is required' });

    for (const slot of p.slots) await sbDelete('lineup_players', `id=eq.${enc(slot.id)}`);
    for (const c of p.players) {
      for (const table of PLAYER_TABLES) await sbDelete(table, `player_id=eq.${enc(c.id)}`);
    }
    for (const table of USER_TABLES) await sbDelete(table, `discord_id=eq.${enc(targetId)}`);
    await sbDelete('players', `discord_id=eq.${enc(targetId)}`);
    const removed = await sbDelete('app_users', `discord_id=eq.${enc(targetId)}`);
    if (!removed?.length) return json(500, { error: 'The user row was not removed' });
    return json(200, { ok: true, counts: p.counts });
  } catch (e) {
    console.error('admin-delete-user failed:', e);
    return json(500, { error: 'Delete failed part-way; run it again to finish' });
  }
}
