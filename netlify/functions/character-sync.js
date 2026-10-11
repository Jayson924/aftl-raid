// POST a synced character with X-Meter-Token; upserts the guildmate's players row.
import { sha256 } from '../lib/session.js';
import { sbGet, sbPost, sbPatch, sbDelete, userRole, PLAYER_ROLES, json } from '../lib/db.js';
import { deriveColumns, deriveCardRows } from '../lib/sync-derive.js';

const MAX_BODY = 512 * 1024;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return json(500, { error: 'Server not configured' });

  const token = event.headers?.['x-meter-token'] || event.headers?.['X-Meter-Token'];
  if (!token) return json(401, { error: 'Missing meter token' });
  if ((event.body || '').length > MAX_BODY) return json(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const name = String(body.character?.name || '').trim();
  const job = String(body.character?.job || '').trim();
  if (!name || name.length > 40 || !job) return json(400, { error: 'character.name and character.job are required' });
  if (!body.build || typeof body.build !== 'object') return json(400, { error: 'build is required' });

  try {
    const tokens = await sbGet('meter_tokens', `token_hash=eq.${sha256(token)}&select=token_hash,discord_id`);
    const discordId = tokens[0]?.discord_id;
    if (!discordId) return json(401, { error: 'Unknown meter token' });
    const role = await userRole(discordId);
    if (!PLAYER_ROLES.has(role)) return json(403, { error: 'Guildmates only' });

    const now = new Date().toISOString();
    const fields = {
      role: job, discord_id: discordId, build: body.build, panel: body.panel || null, synced_at: now,
      ...deriveColumns(body.build, body.panel, job),
    };
    const existing = await sbGet('players', `name=eq.${encodeURIComponent(name)}&select=id,discord_id,account_number`);
    const accountName = String(body.character?.account || '').trim().slice(0, 40);
    if (accountName) {
      fields.account_name = accountName;
      const accountNumber = await accountNumberFor(discordId, accountName, existing[0]);
      if (accountNumber) fields.account_number = accountNumber;
    }
    let playerId; let created = false;
    if (!existing.length) {
      const rows = await sbPost('players', { name, ...fields });
      playerId = rows[0]?.id; created = true;
    } else if (!existing[0].discord_id || existing[0].discord_id === discordId) {
      await sbPatch('players', `id=eq.${existing[0].id}`, fields);
      playerId = existing[0].id;
    } else {
      return json(409, { error: `"${name}" belongs to another user on the site` });
    }
    await syncCards(playerId, body.build);
    await sbPatch('meter_tokens', `token_hash=eq.${tokens[0].token_hash}`, { last_used_at: now });
    return json(200, { ok: true, player_id: playerId, created, synced_at: now });
  } catch (err) {
    console.error('character-sync error:', err);
    return json(500, { error: err.message });
  }
}

// Replaces the character's cards in the admin's slots the sync knows about.
async function syncCards(playerId, build) {
  const config = await sbGet('app_config', 'key=eq.card_slot_names&select=value');
  let slotNames = config[0]?.value || {};
  if (typeof slotNames === 'string') { try { slotNames = JSON.parse(slotNames); } catch (e) { slotNames = {}; } }
  const cards = deriveCardRows(build, slotNames);
  if (!cards || !cards.slots.length) return;
  await sbDelete('player_cards', `player_id=eq.${playerId}&slot_index=in.(${cards.slots.join(',')})`);
  if (cards.rows.length) await sbPost('player_cards', cards.rows.map((row) => ({ player_id: playerId, ...row })));
}

// Characters that share an account nickname follow the account number the owner already
// gave one of them; a number set on this character stays, and nothing is invented otherwise.
async function accountNumberFor(discordId, accountName, current) {
  const siblings = await sbGet('players', `discord_id=eq.${encodeURIComponent(discordId)}&select=account_name,account_number`);
  const match = siblings.find((p) => p.account_name === accountName && p.account_number);
  if (match) return match.account_number;
  return current?.account_number || null;
}
