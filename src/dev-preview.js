// Local-only preview login: see logged-in pages on the dev server without Discord, with every write blocked.
// Open ?preview=guest, friend, guildmate or admin on localhost; ?preview=off ends it. Inert in production builds.
const KEY = 'aftl_dev_preview';
const ROLES = new Set(['guest', 'friend', 'guildmate', 'admin', 'editor']);
const READ_ONLY = 'Dev preview is read-only';
const LOCAL = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(location.hostname);

function chosenRole() {
  if (!LOCAL) return null;
  const asked = new URLSearchParams(location.search).get('preview');
  try {
    if (asked === 'off') localStorage.removeItem(KEY);
    else if (ROLES.has(asked)) localStorage.setItem(KEY, asked);
    return localStorage.getItem(KEY);
  } catch (e) {
    return ROLES.has(asked) ? asked : null;
  }
}

export const previewRole = chosenRole();
// Read only in dev, so a production build never embeds the id.
export const previewDiscordId = import.meta.env.DEV && previewRole ? import.meta.env.VITE_DEV_PREVIEW_DISCORD_ID || '' : '';

// Any chain after a blocked write (.update(...).eq(...).select()) still ends in the read-only error.
function refuse() {
  const chain = new Proxy(() => chain, {
    get: (t, p) => (p === 'then' ? (ok, fail) => Promise.reject(new Error(READ_ONLY)).then(ok, fail) : () => chain),
    apply: () => chain,
  });
  return chain;
}
const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);

// A Supabase client whose writes fail; reads and realtime pass through.
export function guardClient(client) {
  if (!previewRole) return client;
  const passthrough = (target, prop) => {
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const storage = {
    from: (bucket) => new Proxy(client.storage.from(bucket), {
      get: (t, p) => (['upload', 'update', 'remove', 'move', 'copy'].includes(p) ? refuse : passthrough(t, p)),
    }),
  };
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'rpc') return refuse;
      if (prop === 'storage') return storage;
      if (prop === 'from') {
        return (...args) => new Proxy(target.from(...args), { get: (q, p) => (WRITES.has(p) ? refuse : passthrough(q, p)) });
      }
      return passthrough(target, prop);
    },
  });
}

// Site functions: only the simulator's calculator, which writes nothing, may be posted to.
if (previewRole) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init.method || input?.method || 'GET').toUpperCase();
    if (url.includes('/.netlify/functions/') && method !== 'GET' && !url.includes('/.netlify/functions/simulate')) {
      return Promise.resolve(new Response(JSON.stringify({ error: READ_ONLY }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };
  console.warn(`[dev preview] signed in as ${previewRole}; writes are blocked`);
}
