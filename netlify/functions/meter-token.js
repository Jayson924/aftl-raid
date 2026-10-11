// Meter tokens: POST claim/list/revoke or mint with a session; GET ?claim=CODE hands the token to the meter once.
// Only the sha256 of a token is stored.
import { verifySession, newMeterToken, sha256 } from '../lib/session.js';
import { sbPost, sbDelete, sbGet, sbPatch, userRecord, PLAYER_ROLES, json } from '../lib/db.js';

const CLAIM_MINUTES = 10;
const CODE = /^[A-Z0-9]{6,12}$/;

async function pickup(code) {
  if (!CODE.test(code || '')) return json(400, { error: 'Bad code' });
  const rows = await sbGet('meter_tokens', `claim_code=eq.${code}&select=token_hash,claim_token,claim_expires_at,discord_id`);
  const row = rows[0];
  if (!row || !row.claim_token) return json(404, { error: 'pending' });
  await sbPatch('meter_tokens', `token_hash=eq.${row.token_hash}`, { claim_code: null, claim_token: null, claim_expires_at: null });
  if (new Date(row.claim_expires_at).getTime() < Date.now()) return json(410, { error: 'The link code expired. Start again from the meter.' });
  const user = await userRecord(row.discord_id);
  return json(200, { token: row.claim_token, display_name: user?.display_name || user?.username || '' });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return json(500, { error: 'Server not configured' });
  if (event.httpMethod === 'GET') {
    try { return await pickup(event.queryStringParameters?.claim); } catch (err) { console.error('meter-token pickup:', err); return json(500, { error: err.message }); }
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const secret = process.env.SESSION_SECRET;
  if (!secret) return json(500, { error: 'Server not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const discordId = verifySession(body.session, secret);
  if (!discordId) return json(401, { error: 'Log in again first' });

  try {
    const user = await userRecord(discordId);
    if (!PLAYER_ROLES.has(user?.role)) return json(403, { error: 'Guildmates only' });

    const q = `discord_id=eq.${encodeURIComponent(discordId)}`;
    if (body.action === 'revoke') {
      await sbDelete('meter_tokens', q);
      return json(200, { ok: true, revoked: true });
    }
    if (body.action === 'list') {
      const rows = await sbGet('meter_tokens', `${q}&select=label,created_at,last_used_at&order=created_at.desc`);
      return json(200, { tokens: rows });
    }
    const label = String(body.label || '').trim().slice(0, 64) || null;
    const token = newMeterToken();
    const row = { token_hash: sha256(token), discord_id: discordId, label };
    if (body.action === 'claim') {
      const code = String(body.code || '').toUpperCase();
      if (!CODE.test(code)) return json(400, { error: 'Bad code' });
      // A code approved twice would leave two pending tokens; keep only the newest.
      await sbDelete('meter_tokens', `claim_code=eq.${code}`);
      Object.assign(row, { claim_code: code, claim_token: token, claim_expires_at: new Date(Date.now() + CLAIM_MINUTES * 60000).toISOString() });
      await sbPost('meter_tokens', row);
      return json(200, { ok: true, display_name: user.display_name || user.username || '' });
    }
    const rows = await sbPost('meter_tokens', row);
    return json(200, { token, label, created_at: rows[0]?.created_at || null });
  } catch (err) {
    console.error('meter-token error:', err);
    return json(500, { error: err.message });
  }
}
