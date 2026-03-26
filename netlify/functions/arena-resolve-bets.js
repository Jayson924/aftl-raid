/**
 * Shared bet resolution logic — called when a match completes.
 *
 * Losing bets' gold is distributed proportionally to winning bettors.
 * If nobody bet on the winner, all bets are refunded.
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

/**
 * Resolve all active bets for a completed match.
 * @param {string} matchId
 * @param {string} winnerId - the winning participant ID
 */
async function resolveBets(matchId, winnerId) {
  // Fetch all active bets for this match
  const bets = await sbGet('arena_bets', `match_id=eq.${matchId}&status=eq.active&select=*`);
  if (!bets || bets.length === 0) return; // No bets to resolve

  const winningBets = bets.filter(b => b.backed_participant_id === winnerId);
  const losingBets = bets.filter(b => b.backed_participant_id !== winnerId);

  const totalLosingPool = losingBets.reduce((sum, b) => sum + b.amount, 0);
  const totalWinningBets = winningBets.reduce((sum, b) => sum + b.amount, 0);

  if (winningBets.length === 0) {
    // Nobody bet on the winner — refund all bets
    for (const bet of losingBets) {
      await sbPatch('arena_bets', `id=eq.${bet.id}`, { status: 'refunded', payout: bet.amount });
      // Return gold to bettor
      const bettor = await sbGet('arena_participants', `id=eq.${bet.bettor_id}&select=gold`);
      if (bettor[0]) {
        await sbPatch('arena_participants', `id=eq.${bet.bettor_id}`, {
          gold: bettor[0].gold + bet.amount
        });
      }
    }
    return;
  }

  // Mark losing bets
  for (const bet of losingBets) {
    await sbPatch('arena_bets', `id=eq.${bet.id}`, { status: 'lost', payout: 0 });
  }

  // Distribute losing pool proportionally to winners
  let distributed = 0;
  for (let i = 0; i < winningBets.length; i++) {
    const bet = winningBets[i];
    let share;
    if (i === winningBets.length - 1) {
      // Last winner gets remainder to avoid rounding errors
      share = totalLosingPool - distributed;
    } else {
      share = Math.floor(totalLosingPool * (bet.amount / totalWinningBets));
      distributed += share;
    }

    const payout = bet.amount + share; // original bet + winnings
    await sbPatch('arena_bets', `id=eq.${bet.id}`, { status: 'won', payout });

    // Credit gold to bettor
    const bettor = await sbGet('arena_participants', `id=eq.${bet.bettor_id}&select=gold`);
    if (bettor[0]) {
      await sbPatch('arena_participants', `id=eq.${bet.bettor_id}`, {
        gold: bettor[0].gold + payout
      });
    }
  }
}

export { resolveBets };
