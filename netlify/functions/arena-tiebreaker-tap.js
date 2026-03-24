/**
 * Arena Tiebreaker — Auto Enhancement Race.
 * Both players auto-enhance from +9 to +13 using protection jelly rates.
 * Winner = fewest taps. If tied, both re-roll until one wins.
 *
 * Either player triggers this once — server simulates both runs.
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

const RATES = {
  10: { success: 30, failDowngrade: 0 },
  11: { success: 25, failDowngrade: 1 },
  12: { success: 20, failDowngrade: 2 },
  13: { success: 15, failDowngrade: 2 }
};
const START_LEVEL = 9;
const TARGET_LEVEL = 13;

/**
 * Simulate one player auto-enhancing from +9 to +13.
 * Returns array of taps and total tap count.
 */
function simulateAutoEnhance() {
  let level = START_LEVEL;
  const taps = [];

  while (level < TARGET_LEVEL) {
    const targetLevel = level + 1;
    const rate = RATES[targetLevel];
    const roll = Math.random() * 100;
    const success = roll < rate.success;
    const newLevel = success ? targetLevel : Math.max(START_LEVEL, level - rate.failDowngrade);

    taps.push({
      fromLevel: level,
      toLevel: newLevel,
      targetLevel,
      success,
      roll: Math.round(roll * 100) / 100
    });

    level = newLevel;
  }

  return { taps, totalTaps: taps.length, finalLevel: level };
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
    const { matchId, discordId } = JSON.parse(event.body || '{}');

    if (!matchId || !discordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // Get match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match || match.status !== 'tiebreaker') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Not in tiebreaker phase' }) };
    }

    // Get tiebreaker
    const tbs = await sbGet('arena_tiebreakers', `match_id=eq.${matchId}&select=*`);
    const tb = tbs[0];
    if (!tb) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Tiebreaker not found' }) };
    }
    if (tb.winner_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Tiebreaker already complete' }) };
    }

    // Verify caller is a player
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    if (p1?.discord_id !== discordId && p2?.discord_id !== discordId) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player' }) };
    }

    // Simulate both players auto-enhancing
    let p1Result, p2Result;
    // Keep re-rolling if tied, until one player wins
    do {
      p1Result = simulateAutoEnhance();
      p2Result = simulateAutoEnhance();
    } while (p1Result.totalTaps === p2Result.totalTaps);

    const winnerId = p1Result.totalTaps < p2Result.totalTaps ? match.player1_id : match.player2_id;
    const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

    // Write tiebreaker result
    await sbPatch('arena_tiebreakers', `id=eq.${tb.id}`, {
      player1_level: TARGET_LEVEL,
      player2_level: TARGET_LEVEL,
      player1_taps: p1Result.taps,
      player2_taps: p2Result.taps,
      winner_id: winnerId
    });

    // Update match
    await sbPatch('arena_matches', `id=eq.${matchId}`, { status: 'complete', winner_id: winnerId });

    // Update stats
    const winRows = await sbGet('arena_participants', `id=eq.${winnerId}&select=wins`);
    await sbPatch('arena_participants', `id=eq.${winnerId}`, { wins: (winRows[0]?.wins || 0) + 1 });
    const loseRows = await sbGet('arena_participants', `id=eq.${loserId}&select=losses`);
    await sbPatch('arena_participants', `id=eq.${loserId}`, { losses: (loseRows[0]?.losses || 0) + 1 });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        player1Taps: p1Result.taps,
        player2Taps: p2Result.taps,
        player1Total: p1Result.totalTaps,
        player2Total: p2Result.totalTaps,
        winnerId
      })
    };
  } catch (err) {
    console.error('Arena tiebreaker error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
