/**
 * Arena Bet — Server-side bet placement with full validation.
 *
 * Validates: betting window open, bettor is tournament participant,
 * bettor not in this match, 50% gold cap, valid increment amounts.
 * Deducts gold atomically on placement.
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

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`DB insert failed: ${data.message || JSON.stringify(data)}`);
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

// Fallback bet increments per phase
const DEFAULT_INCREMENTS = {
  group_stage: [20, 50, 100],
  semifinals: [50, 125, 200],
  finals: [50, 125, 200]
};

// Prize pool distribution percentages (mirrored from arena-constants.js)
const PRIZE_PCT = { '1st': 0.40, '2nd': 0.20, '3rd': 0.125, '4th': 0.125, 'rest': 0.15 };

function getParticipationPrize(pool, count) {
  if (!pool || pool <= 0 || count <= 4) return 0;
  const topTotal = Math.round(pool * 0.40) + Math.round(pool * 0.20) + Math.round(pool * 0.125) + Math.round(pool * 0.125);
  const restCount = count - 4;
  return restCount > 0 ? Math.floor((pool - topTotal) / restCount) : 0;
}

function roundToNice(n) {
  if (n <= 10) return Math.max(5, Math.round(n / 5) * 5);
  if (n <= 50) return Math.round(n / 5) * 5;
  if (n <= 100) return Math.round(n / 10) * 10;
  return Math.round(n / 25) * 25;
}

function getDynamicIncrements(startingGold, participantCount) {
  if (!startingGold || startingGold <= 0) return DEFAULT_INCREMENTS;
  const bettableMatches = Math.max(3, participantCount - 1);
  const minBet = Math.max(5, roundToNice(startingGold / bettableMatches));
  return {
    group_stage: [minBet, minBet * 2, minBet * 4],
    semifinals: [minBet * 2, minBet * 4, minBet * 8],
    finals: [minBet * 2, minBet * 4, minBet * 8]
  };
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { matchId, discordId, backedParticipantId, amount } = JSON.parse(event.body);

    if (!matchId || !discordId || !backedParticipantId || !amount) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    // 1. Fetch match
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=*`);
    const match = matches[0];
    if (!match) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Match not found' }) };
    }

    // 2. Check betting window — open for pending, drafting, or in_progress with timer
    if (match.status === 'complete') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Betting not open for this match' }) };
    }
    if (match.status !== 'pending' && match.status !== 'drafting' && match.status !== 'roster_reveal') {
      // Not in drafting — need a betting_closes_at window
      if (!match.betting_closes_at) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Betting not open for this match' }) };
      }
      if (new Date() > new Date(match.betting_closes_at)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Betting is closed' }) };
      }
    }

    // 3. Fetch tournament + participants for dynamic increments and gold floor
    const tournaments = await sbGet('arena_tournaments', `id=eq.${match.tournament_id}&select=prizes`);
    const tournament = tournaments[0];
    const allParticipants = await sbGet('arena_participants',
      `tournament_id=eq.${match.tournament_id}&select=*`);
    const participantCount = allParticipants.length;
    const pool = tournament?.prizes?.pool || 0;
    const startingGold = getParticipationPrize(pool, participantCount);
    const betIncrements = startingGold > 0 ? getDynamicIncrements(startingGold, participantCount) : DEFAULT_INCREMENTS;

    // Validate amount is a valid increment for the phase
    const phaseIncrements = betIncrements[match.phase] || betIncrements.group_stage;
    const validIncrement = phaseIncrements.some(inc => amount % inc === 0);
    if (!validIncrement) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid bet amount for ${match.phase}` }) };
    }

    // 4. Find bettor's participant record
    const bettor = allParticipants.find(p => p.discord_id === discordId);
    if (!bettor) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'You are not a participant in this tournament' }) };
    }

    // 5. Can't bet on your own match
    if (bettor.id === match.player1_id || bettor.id === match.player2_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't bet on your own match" }) };
    }

    // 6. Backed participant must be in this match
    if (backedParticipantId !== match.player1_id && backedParticipantId !== match.player2_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid player to back' }) };
    }

    // 7. Can't bet on both players in the same match
    const matchBets = await sbGet('arena_bets',
      `bettor_id=eq.${bettor.id}&match_id=eq.${matchId}&status=eq.active&select=backed_participant_id`);
    const otherSideBet = matchBets.find(b => b.backed_participant_id !== backedParticipantId);
    if (otherSideBet) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Can't bet on both players" }) };
    }

    // 8. Check gold floor — must keep 50% of participation prize
    const goldFloor = startingGold > 0 ? Math.floor(startingGold * 0.5) : 0;

    const existingBets = await sbGet('arena_bets',
      `bettor_id=eq.${bettor.id}&status=eq.active&select=amount`);
    const totalActiveBets = existingBets.reduce((sum, b) => sum + b.amount, 0);

    const maxBettable = Math.max(0, bettor.gold - goldFloor);
    if (totalActiveBets + amount > maxBettable) {
      return { statusCode: 400, headers, body: JSON.stringify({
        error: `Exceeds betting limit. You have ${bettor.gold}G (${goldFloor}G reserved), can wager up to ${maxBettable}G, already wagered: ${totalActiveBets}G`
      }) };
    }

    // Check sufficient gold
    if (amount > bettor.gold) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Not enough gold' }) };
    }

    // 9. Deduct gold atomically (WHERE gold >= amount prevents negative)
    const deducted = await sbPatch('arena_participants',
      `id=eq.${bettor.id}&gold=gte.${amount}`,
      { gold: bettor.gold - amount });
    if (!deducted || deducted.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Insufficient gold (race condition)' }) };
    }

    // 10. Insert bet
    const bet = await sbPost('arena_bets', {
      tournament_id: match.tournament_id,
      match_id: matchId,
      bettor_id: bettor.id,
      backed_participant_id: backedParticipantId,
      amount,
      status: 'active',
      payout: 0
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bet: bet[0],
        remainingGold: bettor.gold - amount
      })
    };
  } catch (err) {
    console.error('Arena bet error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
