/**
 * Arena Draft — Validates and stores draft picks.
 * When both players have submitted, transitions match to in_progress and creates first round.
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
  const data = await res.json();
  if (!res.ok) {
    console.error(`sbGet ${table} failed:`, data);
    throw new Error(`DB read failed: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`sbPatch ${table} failed:`, data, 'body:', body);
    throw new Error(`DB update failed: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`sbPost ${table} failed:`, data, 'body:', body);
    throw new Error(`DB insert failed: ${data.message || JSON.stringify(data)}`);
  }
  return data;
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
    const { matchId, discordId, characters } = JSON.parse(event.body || '{}');

    if (!matchId || !discordId || !characters) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    if (!Array.isArray(characters) || characters.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Must pick at least 1 character' }) };
    }

    // Get match (need match_format for validation)
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    if (match.status !== 'drafting') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Match not in drafting phase' }) };
    }

    // Validate character count based on match format
    const FORMAT_RULES = {
      1: { chars: 1, maxHired: 1 },
      2: { chars: 2, maxHired: 1 },
      3: { chars: 3, maxHired: 2 }
    };
    const format = FORMAT_RULES[match.match_format] || FORMAT_RULES[1];

    if (characters.length !== format.chars) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Must pick exactly ${format.chars} character${format.chars > 1 ? 's' : ''}` }) };
    }

    const hiredCount = characters.filter(c => c.isHired).length;
    if (hiredCount > format.maxHired) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Max ${format.maxHired} hired character${format.maxHired > 1 ? 's' : ''}` }) };
    }

    // Get participants
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    let playerSide;
    if (p1?.discord_id === discordId) playerSide = 'player1';
    else if (p2?.discord_id === discordId) playerSide = 'player2';
    else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player in this match' }) };
    }

    // Validate hire restrictions
    const opponentId = playerSide === 'player1' ? p2.discord_id : p1.discord_id;
    const myParticipant = playerSide === 'player1' ? p1 : p2;

    for (const char of characters) {
      if (char.isHired) {
        // Can't hire opponent's characters
        const oppChars = await sbGet('players', `discord_id=eq.${opponentId}&select=id`);
        if (oppChars.some(c => c.id === char.playerId)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't hire opponent's character" }) };
        }

        // Can't hire from same bracket
        const bracketPlayers = await sbGet('arena_participants', `tournament_id=eq.${match.tournament_id}&bracket_number=eq.${myParticipant.bracket_number}&select=discord_id`);
        const bracketIds = bracketPlayers.map(p => p.discord_id);
        const hireOwners = await sbGet('players', `id=eq.${char.playerId}&select=discord_id`);
        if (hireOwners[0] && bracketIds.includes(hireOwners[0].discord_id)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't hire from players in your bracket" }) };
        }
      }
    }

    // Save draft
    const draftField = `${playerSide}_draft`;
    await sbPatch('arena_matches', `id=eq.${matchId}`, { [draftField]: characters });

    // Check if both players have drafted
    const updatedMatches = await sbGet('arena_matches', `id=eq.${matchId}&select=player1_draft,player2_draft`);
    const updated = updatedMatches[0];
    const bothReady = !!(updated?.player1_draft && updated?.player2_draft);

    if (bothReady) {
      // Both drafted — transition to in_progress
      await sbPatch('arena_matches', `id=eq.${matchId}`, { status: 'in_progress' });

      // Create first round
      await sbPost('arena_rounds', {
        match_id: matchId,
        round_number: 1,
        player1_hp: 120,
        player2_hp: 120
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, bothReady })
    };
  } catch (err) {
    console.error('Arena draft error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
