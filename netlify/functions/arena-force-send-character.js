/**
 * Arena Force Send Character — Auto-picks a character for a player who hasn't sent one in time.
 * Called by the opponent's client when the send-character timer expires.
 *
 * Expects: { matchId, roundId, requestingDiscordId }
 * - requestingDiscordId must have already sent their character
 * - The OTHER player gets a random unused character auto-sent
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
  if (!res.ok) throw new Error(`DB read failed: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`DB update failed: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function sbPost(table, body, { ignoreDuplicate = false } = {}) {
  const postHeaders = { ...sbHeaders };
  if (ignoreDuplicate) {
    postHeaders['Prefer'] = 'return=representation,resolution=ignore-duplicates';
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok && !(ignoreDuplicate && res.status === 409)) {
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
    const { matchId, roundId, requestingDiscordId } = JSON.parse(event.body || '{}');

    if (!matchId || !roundId || !requestingDiscordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    // Get round
    const rounds = await sbGet('arena_rounds', `id=eq.${roundId}&select=*`);
    const round = rounds[0];
    if (!round) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Round not found' }) };
    }

    // Get participants
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    // Determine sides
    let requesterSide, absentSide;
    if (p1?.discord_id === requestingDiscordId) {
      requesterSide = 'player1';
      absentSide = 'player2';
    } else if (p2?.discord_id === requestingDiscordId) {
      requesterSide = 'player2';
      absentSide = 'player1';
    } else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player in this match' }) };
    }

    // Verify requester has already sent their character
    if (!round[`${requesterSide}_character`]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'You must send your character first' }) };
    }

    // Verify opponent hasn't sent theirs
    if (round[`${absentSide}_character`]) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // Get opponent's draft and find unused characters
    const draft = match[`${absentSide}_draft`] || [];
    if (draft.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Absent player has no drafted characters' }) };
    }

    // Find characters already used in previous rounds
    const allRounds = await sbGet('arena_rounds', `match_id=eq.${matchId}&select=${absentSide}_character&id=neq.${roundId}`);
    const usedPlayerIds = allRounds
      .map(r => r[`${absentSide}_character`]?.playerId)
      .filter(Boolean);

    const available = draft.filter(c => !usedPlayerIds.includes(c.playerId));
    if (available.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No unused characters available' }) };
    }

    // Pick random character
    const picked = available[Math.floor(Math.random() * available.length)];
    const character = {
      playerId: picked.playerId,
      playerName: picked.playerName,
      className: picked.className,
      ability: picked.ability || null
    };

    // Set character on round
    await sbPatch('arena_rounds', `id=eq.${roundId}`, {
      [`${absentSide}_character`]: character
    });

    // Both characters now set — create first turn
    const bothReady = true;
    await sbPost('arena_turns', {
      round_id: roundId,
      turn_number: 1,
      player1_committed: false,
      player2_committed: false,
      resolved: false
    }, { ignoreDuplicate: true });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, bothReady, forcedCharacter: character })
    };
  } catch (err) {
    console.error('Arena force-send-character error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
