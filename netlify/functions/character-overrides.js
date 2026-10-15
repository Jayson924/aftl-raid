// POST {session, player_id, build, hand_set_wins?}: saves the hand-set fields of a synced character and recalculates its panel.
// POST {session, player_id, clear_cards: true}: empties its cards; syncs resending those same cards are ignored.
import { verifySession } from '../lib/session.js';
import { sbGet, sbPatch, sbDelete, userRecord, PLAYER_ROLES, json } from '../lib/db.js';
import { deriveColumns } from '../lib/sync-derive.js';
import { OVERRIDE_FIELDS, pickOverrides, applyOverrides, calculatePanel, gradedCards } from '../lib/sync-merge.js';

const MAX_BODY = 512 * 1024;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SESSION_SECRET) return json(500, { error: 'Server not configured' });
  if ((event.body || '').length > MAX_BODY) return json(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const discordId = verifySession(body.session, process.env.SESSION_SECRET);
  if (!discordId) return json(401, { error: 'Log in again first' });
  const playerId = String(body.player_id || '').trim();
  const clearCards = body.clear_cards === true;
  if (!playerId || (!clearCards && (!body.build || typeof body.build !== 'object'))) return json(400, { error: 'player_id and build are required' });

  try {
    const user = await userRecord(discordId);
    if (!PLAYER_ROLES.has(user?.role)) return json(403, { error: 'Guildmates only' });
    const rows = await sbGet('players', `id=eq.${encodeURIComponent(playerId)}&select=id,discord_id,role,build,overrides`);
    const player = rows[0];
    if (!player) return json(404, { error: 'No such character' });
    if (player.discord_id !== discordId && user.role !== 'admin') return json(403, { error: 'Not your character' });
    if (!player.build) return json(409, { error: 'This character has never been synced' });

    // Merge: a partial save (the players-page modal) keeps fields saved from the simulator.
    const stored = Object.fromEntries(Object.entries(player.overrides || {}).filter(([k]) => [...OVERRIDE_FIELDS, 'cleared_cards', 'hand_set_wins'].includes(k)));
    let overrides; let build;
    if (clearCards) {
      const cleared = gradedCards(player.build.card_grades);
      overrides = cleared.length ? { ...stored, cleared_cards: cleared } : stored;
      build = { ...player.build, card_grades: (player.build.card_grades || []).map((c) => ({ ...c, grade: 'None' })) };
      await sbDelete('player_cards', `player_id=eq.${encodeURIComponent(playerId)}`);
    } else {
      overrides = { ...stored, ...pickOverrides(body.build), ...(typeof body.hand_set_wins === 'boolean' ? { hand_set_wins: body.hand_set_wins } : {}) };
      build = applyOverrides(player.build, overrides);
    }
    const panel = calculatePanel(build);
    const fields = { overrides, build, ...(panel ? { panel } : {}), ...deriveColumns(build, panel, build.second_job || player.role) };
    await sbPatch('players', `id=eq.${encodeURIComponent(playerId)}`, fields);
    return json(200, { ok: true, overrides, panel });
  } catch (err) {
    console.error('character-overrides error:', err);
    return json(500, { error: err.message });
  }
}
