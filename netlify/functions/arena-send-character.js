/**
 * Arena Send Character — Blind character selection per round.
 * Both players pick which character to send out. When both committed, creates first turn.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  return res.json();
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  return res.json();
}

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
    const { matchId, roundId, discordId, character } = JSON.parse(event.body || '{}');

    if (!matchId || !roundId || !discordId || !character) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    // Determine side
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    let playerSide;
    if (p1?.discord_id === discordId) playerSide = 'player1';
    else if (p2?.discord_id === discordId) playerSide = 'player2';
    else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player in this match' }) };
    }

    // Validate character in draft
    const draft = match[`${playerSide}_draft`];
    if (!draft?.some(c => c.playerId === character.playerId)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Character not in your draft' }) };
    }

    // Set character on round
    const charField = `${playerSide}_character`;
    await sbPatch('arena_rounds', `id=eq.${roundId}`, { [charField]: character });

    // Check if both set
    const rounds = await sbGet('arena_rounds', `id=eq.${roundId}&select=player1_character,player2_character`);
    const round = rounds[0];

    let bothReady = false;
    if (round?.player1_character && round?.player2_character) {
      bothReady = true;
      await sbPost('arena_turns', {
        round_id: roundId,
        turn_number: 1,
        player1_committed: false,
        player2_committed: false,
        resolved: false
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, bothReady })
    };
  } catch (err) {
    console.error('Arena send-character error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
