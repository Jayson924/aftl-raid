/**
 * Arena React — Rate-limited spectator reactions.
 * 1 reaction per 3s per user.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

const VALID_EMOJIS = ['👍', '👎', '😂', '😢', '😮'];
const COOLDOWN_SECONDS = 2;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const { matchId, discordId, emoji } = JSON.parse(event.body || '{}');

    if (!matchId || !discordId || !emoji) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    if (!VALID_EMOJIS.includes(emoji)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid emoji' }) };
    }

    // Rate limit check
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/arena_reactions?match_id=eq.${matchId}&discord_id=eq.${discordId}&select=created_at&order=created_at.desc&limit=1`,
      { headers: sbHeaders }
    );
    const recent = await res.json();

    if (recent && recent.length > 0) {
      const lastTime = new Date(recent[0].created_at);
      const now = new Date();
      if ((now - lastTime) / 1000 < COOLDOWN_SECONDS) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too fast! Wait a moment.' }) };
      }
    }

    // Insert reaction
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/arena_reactions`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ match_id: matchId, discord_id: discordId, emoji })
    });

    if (!insertRes.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to save reaction' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Arena react error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
