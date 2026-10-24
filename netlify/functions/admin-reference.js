// Admin-only: the gearscore reference builds, choices and assumptions kept out of the public bundle.
// GET with an X-Session header.
import fs from 'node:fs';
import path from 'node:path';
import { verifySession } from '../lib/session.js';
import { userRole, json } from '../lib/db.js';
import { dataDir } from '../lib/sim/tables.js';

let cached = null;
const references = () => cached || (cached = JSON.parse(fs.readFileSync(path.join(dataDir(), 'reference-builds.json'), 'utf8')));

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SESSION_SECRET) return json(500, { error: 'Server not configured' });

  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const callerId = verifySession(headers['x-session'], process.env.SESSION_SECRET);
  if (!callerId) return json(401, { error: 'Log in again first' });

  try {
    if (await userRole(callerId) !== 'admin') return json(403, { error: 'Admins only' });
    return json(200, references());
  } catch (e) {
    console.error('admin-reference failed:', e);
    return json(500, { error: 'Could not load the references' });
  }
};
