// POST a synced character with X-Meter-Token; upserts the guildmate's players row.
import { sha256 } from '../lib/session.js';
import { sbGet, sbPost, sbPatch, sbDelete, userRole, PLAYER_ROLES, json } from '../lib/db.js';
import { deriveColumns, deriveCardRows } from '../lib/sync-derive.js';
import { applyOverrides, calculatePanel, gradedCards } from '../lib/sync-merge.js';

const MAX_BODY = 512 * 1024;
// The toolbox's class names where the site's CLASSES spell them differently.
const SITE_CLASS_NAMES = { Moonlord: 'Moon Lord' };
const GUILD = 'afterlight';

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
    const existing = await sbGet('players', `name=eq.${encodeURIComponent(name)}&select=id,discord_id,account_number,overrides,role,synced_at,build`);
    // A typed name with another class is a different character borrowing it; a captured name means a real class change.
    const prior = existing[0];
    const siteRole = SITE_CLASS_NAMES[job] || job;
    if (prior?.synced_at && prior.role && prior.role !== siteRole && SITE_CLASS_NAMES[prior.role] !== siteRole && body.character?.name_source === 'typed') {
      return json(422, { error: `${name} is a ${prior.role} on Afterlight, but this ${siteRole} build has a typed name. Check the name on the sync screen.` });
    }
    // Values set on the site stay on top of every sync; the panel is then the site's own calculation.
    // Cards cleared on the site stay cleared while the toolbox resends that same remembered set.
    const cleared = prior?.overrides?.cleared_cards;
    const incoming = gradedCards(body.build.card_grades);
    const resent = Array.isArray(cleared) && incoming.length && incoming.join() === cleared.join();
    const synced = resent ? { ...body.build, card_grades: (body.build.card_grades || []).map((c) => ({ ...c, grade: 'None' })) } : body.build;
    const build = applyOverrides(withStoredCards(synced, prior?.build), prior?.overrides);
    const panel = calculatePanel(build) || body.panel || null;
    const fields = {
      role: siteRole, discord_id: discordId, build, panel, synced_at: now,
      // New cards replace the cleared set, so the mark goes.
      ...(Array.isArray(cleared) && incoming.length && !resent ? { overrides: Object.fromEntries(Object.entries(prior.overrides).filter(([k]) => k !== 'cleared_cards')) } : {}),
      ...deriveColumns(build, panel, job),
    };
    // The game's guild decides the in-guild flag; a blank one (no guild, or the login was missed) leaves it alone.
    const guild = String(body.character?.guild || '').trim().toLowerCase();
    if (guild) fields.whitelisted = guild === GUILD;
    const accountName = String(body.character?.account || '').trim().slice(0, 40);
    if (accountName) {
      fields.account_name = accountName;
      const accountNumber = await accountNumberFor(discordId, accountName, existing[0]);
      if (accountNumber) fields.account_number = accountNumber;
    }
    let playerId; let created = false;
    if (!existing.length) {
      // An outsider is already answered, so the bot's in-guild review skips it.
      const rows = await sbPost('players', { name, ...fields, ...(fields.whitelisted === false ? { whitelist_ignored: true } : {}) });
      playerId = rows[0]?.id; created = true;
    } else if (!existing[0].discord_id || existing[0].discord_id === discordId) {
      await sbPatch('players', `id=eq.${existing[0].id}`, fields);
      playerId = existing[0].id;
    } else {
      return json(409, { error: `"${name}" belongs to another user on the site` });
    }
    if (!resent) await syncCards(playerId, body.build);
    await sbPatch('meter_tokens', `token_hash=eq.${tokens[0].token_hash}`, { last_used_at: now });
    return json(200, { ok: true, player_id: playerId, created, synced_at: now });
  } catch (err) {
    console.error('character-sync error:', err);
    return json(500, { error: err.message });
  }
}

// The game sends cards once per session; a sync without any keeps the cards already stored.
function withStoredCards(build, stored) {
  if (gradedCards(build.card_grades).length || !gradedCards(stored?.card_grades).length) return build;
  return { ...build, card_grades: stored.card_grades };
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
