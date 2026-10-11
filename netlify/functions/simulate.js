// POST {builds: {key: build}} (up to four) -> {results: {key: {rows, summary, preview, items}}}.
import { getTables } from '../lib/sim/tables.js';
import { createCalculator } from '../lib/sim/calc.js';
import { buildResult } from '../lib/sim/results.js';
import { json } from '../lib/db.js';

const MAX_BODY = 256 * 1024;
const MAX_BUILDS = 4;
const RATE_LIMIT = 120;  // per IP per window, per warm instance
const RATE_WINDOW_MS = 60 * 1000;
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const hit = hits.get(ip);
  if (!hit || now - hit.start > RATE_WINDOW_MS) { hits.set(ip, { start: now, count: 1 }); return false; }
  hit.count += 1;
  if (hits.size > 5000) for (const [key, h] of hits) if (now - h.start > RATE_WINDOW_MS) hits.delete(key);
  return hit.count > RATE_LIMIT;
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || h['client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

let calc = null;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: json(204, {}).headers };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if ((event.body || '').length > MAX_BODY) return json(413, { error: 'Payload too large' });
  if (limited(clientIp(event))) return json(429, { error: 'Too many requests; try again in a minute' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad JSON' }); }
  const builds = body.builds;
  if (!builds || typeof builds !== 'object' || Array.isArray(builds)) return json(400, { error: 'builds is required' });
  const entries = Object.entries(builds);
  if (!entries.length || entries.length > MAX_BUILDS) return json(400, { error: `Send 1 to ${MAX_BUILDS} builds` });

  try {
    const tables = getTables();
    calc ??= createCalculator(tables);
    const results = {};
    for (const [key, build] of entries) {
      if (!build || typeof build !== 'object' || Array.isArray(build)) return json(400, { error: `builds.${key} must be an object` });
      try {
        results[key] = buildResult(calc, tables, build);
      } catch (err) {
        return json(400, { error: `builds.${key}: ${err.message}` });
      }
    }
    return json(200, { results });
  } catch (err) {
    console.error('simulate error:', err);
    return json(500, { error: err.message });
  }
}
