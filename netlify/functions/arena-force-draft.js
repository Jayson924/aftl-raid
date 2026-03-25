/**
 * Arena Force Draft — Auto-picks random characters for a player who hasn't drafted in time.
 * Called by the opponent's client when the draft timer expires.
 *
 * Expects: { matchId, requestingDiscordId }
 * - requestingDiscordId must have already drafted (proves they waited)
 * - The OTHER player gets random characters auto-picked from their roster
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

const FORMAT_RULES = {
  1: { chars: 1, maxHired: 1 },
  2: { chars: 2, maxHired: 1 },
  3: { chars: 3, maxHired: 2 }
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const { matchId, requestingDiscordId } = JSON.parse(event.body || '{}');

    if (!matchId || !requestingDiscordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    if (match.status !== 'drafting') {
      // Already moved past drafting — nothing to do
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // Get participants
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    // Determine who is requesting and who needs force-draft
    let requesterSide, absentSide, absentParticipant;
    if (p1?.discord_id === requestingDiscordId) {
      requesterSide = 'player1';
      absentSide = 'player2';
      absentParticipant = p2;
    } else if (p2?.discord_id === requestingDiscordId) {
      requesterSide = 'player2';
      absentSide = 'player1';
      absentParticipant = p1;
    } else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player in this match' }) };
    }

    // Verify requester has already drafted
    if (!match[`${requesterSide}_draft`]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'You must draft first before forcing opponent draft' }) };
    }

    // Verify opponent hasn't drafted
    if (match[`${absentSide}_draft`]) {
      // Opponent already drafted — maybe just not transitioned yet
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, alreadyResolved: true }) };
    }

    // Get absent player's characters
    const format = FORMAT_RULES[match.match_format] || FORMAT_RULES[1];
    const absentChars = await sbGet('players', `discord_id=eq.${absentParticipant.discord_id}&select=id,name,role&order=name.asc`);

    if (absentChars.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Absent player has no characters to draft' }) };
    }

    // Randomly pick characters
    const shuffled = shuffle(absentChars);
    const picked = shuffled.slice(0, Math.min(format.chars, shuffled.length));
    const draftCharacters = picked.map(c => ({
      playerId: c.id,
      playerName: c.name,
      className: c.role,
      isHired: false
    }));

    // Save the forced draft
    await sbPatch('arena_matches', `id=eq.${matchId}`, {
      [`${absentSide}_draft`]: draftCharacters
    });

    // Re-check: now both should be drafted
    const updatedMatches = await sbGet('arena_matches', `id=eq.${matchId}&select=player1_draft,player2_draft`);
    const updated = updatedMatches[0];
    const bothReady = !!(updated?.player1_draft && updated?.player2_draft);

    if (bothReady) {
      // Transition to in_progress
      await sbPatch('arena_matches', `id=eq.${matchId}`, { status: 'in_progress' });

      // Create first round
      await sbPost('arena_rounds', {
        match_id: matchId,
        round_number: 1,
        player1_hp: 120,
        player2_hp: 120
      }, { ignoreDuplicate: true });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, forcedDraft: draftCharacters, bothReady })
    };
  } catch (err) {
    console.error('Arena force-draft error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
