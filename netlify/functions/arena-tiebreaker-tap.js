/**
 * Arena Tiebreaker Tap — Enhancement race RNG.
 * Uses protection jelly rates: +10 (30%), +11 (25%), +12 (20%), +13 (15%).
 * First to +13 wins.
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

const RATES = {
  10: { success: 30, failDowngrade: 0 },
  11: { success: 25, failDowngrade: 1 },
  12: { success: 20, failDowngrade: 2 },
  13: { success: 15, failDowngrade: 2 }
};
const START_LEVEL = 9;
const TARGET_LEVEL = 13;

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

    // Determine side
    const participants = await sbGet('arena_participants', `id=in.(${match.player1_id},${match.player2_id})&select=*`);
    const p1 = participants.find(p => p.id === match.player1_id);
    const p2 = participants.find(p => p.id === match.player2_id);

    let playerSide;
    if (p1?.discord_id === discordId) playerSide = 'player1';
    else if (p2?.discord_id === discordId) playerSide = 'player2';
    else {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a player' }) };
    }

    const levelField = `${playerSide}_level`;
    const tapsField = `${playerSide}_taps`;
    const currentLevel = tb[levelField];
    const taps = tb[tapsField] || [];

    if (currentLevel >= TARGET_LEVEL) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Already at max level' }) };
    }

    const targetLevel = currentLevel + 1;
    const rate = RATES[targetLevel];
    if (!rate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid enhancement level' }) };
    }

    // Roll
    const roll = Math.random() * 100;
    const success = roll < rate.success;
    const newLevel = success ? targetLevel : Math.max(START_LEVEL, currentLevel - rate.failDowngrade);

    const tap = {
      fromLevel: currentLevel,
      toLevel: newLevel,
      targetLevel,
      success,
      roll: Math.round(roll * 100) / 100,
      timestamp: new Date().toISOString()
    };
    taps.push(tap);

    const update = {
      [levelField]: newLevel,
      [tapsField]: taps
    };

    // Check if won
    let winner = null;
    if (newLevel >= TARGET_LEVEL) {
      const winnerId = playerSide === 'player1' ? match.player1_id : match.player2_id;
      const loserId = playerSide === 'player1' ? match.player2_id : match.player1_id;
      update.winner_id = winnerId;
      winner = winnerId;

      await sbPatch('arena_matches', `id=eq.${matchId}`, { status: 'complete', winner_id: winnerId });

      // Update stats
      const winRows = await sbGet('arena_participants', `id=eq.${winnerId}&select=wins`);
      await sbPatch('arena_participants', `id=eq.${winnerId}`, { wins: (winRows[0]?.wins || 0) + 1 });
      const loseRows = await sbGet('arena_participants', `id=eq.${loserId}&select=losses`);
      await sbPatch('arena_participants', `id=eq.${loserId}`, { losses: (loseRows[0]?.losses || 0) + 1 });
    }

    await sbPatch('arena_tiebreakers', `id=eq.${tb.id}`, update);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, tap, newLevel, won: !!winner })
    };
  } catch (err) {
    console.error('Arena tiebreaker error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
