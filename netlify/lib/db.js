// Supabase REST with the service key; env is read per call so tests can set it.

function headers() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function request(method, table, query, body, extraHeaders = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { method, headers: { ...headers(), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error(`${method} ${table} failed:`, data);
    throw new Error(`DB ${method} ${table} failed: ${data?.message || res.status}`);
  }
  return data;
}

export const sbGet = (table, query) => request('GET', table, query);
export const sbPost = (table, body) => request('POST', table, '', body);
export const sbPatch = (table, query, body) => request('PATCH', table, query, body);
export const sbDelete = (table, query) => request('DELETE', table, query);
export const sbRpc = (fn, args) => request('POST', `rpc/${fn}`, '', args);
// Insert or update on the given unique columns.
export const sbUpsert = (table, body, onConflict) =>
  request('POST', table, `on_conflict=${onConflict}`, body, { Prefer: 'return=representation,resolution=merge-duplicates' });

export const PLAYER_ROLES = new Set(['guildmate', 'admin', 'editor']);

export async function userRecord(discordId) {
  const rows = await sbGet('app_users', `discord_id=eq.${encodeURIComponent(discordId)}&select=role,display_name,username`);
  return rows[0] || null;
}

export async function userRole(discordId) {
  const rows = await sbGet('app_users', `discord_id=eq.${encodeURIComponent(discordId)}&select=role`);
  return rows[0]?.role || null;
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Meter-Token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
