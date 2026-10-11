// Signed site sessions (which Discord user the browser is) and meter tokens; needs SESSION_SECRET.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 30;

const hmac = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');

export function signSession(discordId, secret, now = Date.now()) {
  const exp = now + SESSION_DAYS * 86400 * 1000;
  const payload = `${discordId}.${exp}`;
  return `v1.${payload}.${hmac(secret, payload)}`;
}

// Returns the Discord id, or null when the token is malformed, forged or expired.
export function verifySession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const [version, discordId, exp, signature] = token.split('.');
  if (version !== 'v1' || !discordId || !exp || !signature) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  const expected = hmac(secret, `${discordId}.${exp}`);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return discordId;
}

export const newMeterToken = () => randomBytes(32).toString('base64url');
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
