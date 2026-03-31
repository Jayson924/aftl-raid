/**
 * Shared win gold logic — awards gold-per-win to match winner.
 *
 * Reads the tournament's prizes.win_pool_percent, estimates total matches,
 * calculates gold per win, and adds it to the winner's participant gold.
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
  if (!res.ok) {
    const data = await res.json();
    throw new Error(`DB patch failed: ${data.message || JSON.stringify(data)}`);
  }
}

function estimateTotalMatches(participantCount, bracketCount) {
  if (!participantCount || !bracketCount || participantCount < 2) return 0;
  const perBracket = Math.ceil(participantCount / bracketCount);
  const groupMatches = bracketCount * (perBracket * (perBracket - 1)) / 2;
  const semiMatches = Math.max(1, Math.floor(bracketCount / 2));
  const playoffMatches = semiMatches + 1 + (semiMatches > 1 ? 1 : 0);
  return Math.round(groupMatches + playoffMatches);
}

/**
 * Award gold-per-win to the match winner.
 * @param {string} matchId - The completed match ID
 * @param {string} winnerId - The winning participant ID
 */
export async function awardWinGold(matchId, winnerId) {
  try {
    // Get match → tournament
    const matches = await sbGet('arena_matches', `id=eq.${matchId}&select=tournament_id`);
    if (!matches[0]) return;
    const tournamentId = matches[0].tournament_id;

    // Get tournament
    const tournaments = await sbGet('arena_tournaments', `id=eq.${tournamentId}`);
    if (!tournaments[0]) return;
    const tournament = tournaments[0];

    const pool = tournament.prizes?.pool;
    const winPct = tournament.prizes?.win_pool_percent;
    if (!pool || !winPct) return; // no win gold configured

    // Count participants
    const participants = await sbGet('arena_participants', `tournament_id=eq.${tournamentId}&select=id`);
    const participantCount = participants.length;
    const totalMatches = estimateTotalMatches(participantCount, tournament.bracket_count || 2);
    if (totalMatches <= 0) return;

    const goldPerWin = Math.floor((pool * (winPct / 100)) / totalMatches);
    if (goldPerWin <= 0) return;

    // Get winner's current gold
    const winners = await sbGet('arena_participants', `id=eq.${winnerId}&select=id,gold`);
    if (!winners[0]) return;
    const currentGold = winners[0].gold || 0;

    await sbPatch('arena_participants', `id=eq.${winnerId}`, { gold: currentGold + goldPerWin });
    console.log(`[WinGold] Awarded ${goldPerWin}G to participant ${winnerId}`);
  } catch (e) {
    console.error('[WinGold] Error:', e);
  }
}
