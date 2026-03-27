/**
 * Arena Data Service
 *
 * Standalone data module for all arena operations.
 * Imports the same Supabase client setup from data.js but keeps arena code isolated.
 */

import { createClient } from '@supabase/supabase-js';
import { distributePrizePool, getMatchFormat } from './arena-constants.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

class ArenaDataService {
  // ============================================
  // TOURNAMENTS
  // ============================================

  async getTournaments() {
    const { data, error } = await supabase
      .from('arena_tournaments')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getTournament(id) {
    const { data, error } = await supabase
      .from('arena_tournaments')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async createTournament(name, bracketCount, matchFormat = 1, prizes = null) {
    const { data, error } = await supabase
      .from('arena_tournaments')
      .insert({
        name,
        bracket_count: bracketCount,
        match_format: matchFormat,
        prizes,
        status: 'registration',
        current_phase: 'registration'
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateTournament(id, updates) {
    const { data, error } = await supabase
      .from('arena_tournaments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async deleteTournament(id) {
    const { error } = await supabase
      .from('arena_tournaments')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  /**
   * Stop an in-progress tournament: delete all matches (cascades to rounds/turns/tiebreakers),
   * reset participant W/L, revert tournament to setup phase.
   */
  async stopTournament(id) {
    // Delete all matches (CASCADE deletes rounds, turns, tiebreakers)
    const { error: matchErr } = await supabase
      .from('arena_matches')
      .delete()
      .eq('tournament_id', id);
    if (matchErr) throw matchErr;

    // Reset participant stats and gold
    const { error: partErr } = await supabase
      .from('arena_participants')
      .update({ wins: 0, losses: 0, gold: 0 })
      .eq('tournament_id', id);
    if (partErr) throw partErr;

    // Revert tournament to setup
    const { error: tourErr } = await supabase
      .from('arena_tournaments')
      .update({ status: 'setup', current_phase: 'setup' })
      .eq('id', id);
    if (tourErr) throw tourErr;
  }

  /**
   * Create a standalone quick match: makes a throwaway tournament, adds both players,
   * creates a match in 'drafting' status, and returns the match ID.
   */
  async createQuickMatch(player1DiscordId, player2DiscordId, matchFormat = 1) {
    // Create a throwaway tournament
    const { data: tournament, error: tErr } = await supabase
      .from('arena_tournaments')
      .insert({
        name: `Quick Match`,
        bracket_count: 1,
        match_format: matchFormat,
        status: 'active',
        current_phase: 'group_stage'
      })
      .select()
      .single();
    if (tErr) throw tErr;

    // Add both as participants
    const { data: parts, error: pErr } = await supabase
      .from('arena_participants')
      .insert([
        { tournament_id: tournament.id, discord_id: player1DiscordId, bracket_number: 1, seed_position: 1, wins: 0, losses: 0 },
        { tournament_id: tournament.id, discord_id: player2DiscordId, bracket_number: 1, seed_position: 2, wins: 0, losses: 0 }
      ])
      .select();
    if (pErr) throw pErr;

    const p1 = parts.find(p => p.discord_id === player1DiscordId);
    const p2 = parts.find(p => p.discord_id === player2DiscordId);

    // Create match in drafting status
    const { data: match, error: mErr } = await supabase
      .from('arena_matches')
      .insert({
        tournament_id: tournament.id,
        phase: 'group_stage',
        player1_id: p1.id,
        player2_id: p2.id,
        match_format: matchFormat,
        status: 'drafting',
        player1_rounds_won: 0,
        player2_rounds_won: 0
      })
      .select()
      .single();
    if (mErr) throw mErr;

    return { tournamentId: tournament.id, matchId: match.id };
  }

  // ============================================
  // PARTICIPANTS
  // ============================================

  async getParticipants(tournamentId) {
    const { data, error } = await supabase
      .from('arena_participants')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('bracket_number', { ascending: true })
      .order('seed_position', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async addParticipant(tournamentId, discordId, bracketNumber = null, seedPosition = null) {
    const { data, error } = await supabase
      .from('arena_participants')
      .insert({
        tournament_id: tournamentId,
        discord_id: discordId,
        bracket_number: bracketNumber,
        seed_position: seedPosition,
        wins: 0,
        losses: 0
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateParticipant(id, updates) {
    const { data, error } = await supabase
      .from('arena_participants')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async removeParticipant(id) {
    const { error } = await supabase
      .from('arena_participants')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async bulkUpdateParticipants(updates) {
    // updates = [{ id, bracket_number, seed_position }, ...]
    const promises = updates.map(u =>
      supabase
        .from('arena_participants')
        .update({ bracket_number: u.bracket_number, seed_position: u.seed_position })
        .eq('id', u.id)
    );
    const results = await Promise.all(promises);
    const failed = results.find(r => r.error);
    if (failed) throw failed.error;
  }

  // ============================================
  // SIGNUPS (tournament registration)
  // ============================================

  async getSignups(tournamentId) {
    const { data, error } = await supabase
      .from('arena_signups')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('signed_up_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async signUp(tournamentId, discordId) {
    const { data, error } = await supabase
      .from('arena_signups')
      .upsert({
        tournament_id: tournamentId,
        discord_id: discordId
      }, { onConflict: 'tournament_id,discord_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async leaveSignUp(tournamentId, discordId) {
    const { error } = await supabase
      .from('arena_signups')
      .delete()
      .eq('tournament_id', tournamentId)
      .eq('discord_id', discordId);
    if (error) throw error;
  }

  async removeSignUp(signupId) {
    const { error } = await supabase
      .from('arena_signups')
      .delete()
      .eq('id', signupId);
    if (error) throw error;
  }

  /**
   * Close registration: move to setup phase and promote all signups to participants.
   * Returns the created participants.
   */
  async closeRegistration(tournamentId) {
    // Fetch signups
    const signups = await this.getSignups(tournamentId);

    // Create participants from signups (unassigned bracket)
    const participants = [];
    for (const s of signups) {
      try {
        const p = await this.addParticipant(tournamentId, s.discord_id, null, null);
        participants.push(p);
      } catch (err) {
        // Skip duplicates (already a participant)
        if (!err.message?.includes('duplicate')) throw err;
      }
    }

    // Advance tournament to setup phase
    await this.updateTournament(tournamentId, {
      status: 'setup',
      current_phase: 'setup'
    });

    return participants;
  }

  subscribeToSignups(tournamentId, callback) {
    return supabase
      .channel(`arena-signups-${tournamentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_signups',
        filter: `tournament_id=eq.${tournamentId}`
      }, callback)
      .subscribe();
  }

  // ============================================
  // MATCHES
  // ============================================

  async getMatches(tournamentId) {
    const { data, error } = await supabase
      .from('arena_matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('phase', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  /**
   * Get all recent matches across all tournaments (for the hub).
   * Returns newest first, limited to `limit` matches.
   */
  async getRecentMatches(limit = 20) {
    const { data, error } = await supabase
      .from('arena_matches')
      .select('*, arena_tournaments!inner(name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  /**
   * Get all participants across all tournaments (keyed by participant ID).
   * Used to resolve player names for recent matches.
   */
  async getAllParticipants() {
    const { data, error } = await supabase
      .from('arena_participants')
      .select('*');
    if (error) throw error;
    return data || [];
  }

  /**
   * Subscribe to tournament changes (e.g. prize pool updates).
   */
  subscribeToTournament(tournamentId, callback) {
    return supabase
      .channel(`arena-tournament-${tournamentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'arena_tournaments',
        filter: `id=eq.${tournamentId}`
      }, callback)
      .subscribe();
  }

  /**
   * Subscribe to ALL arena match changes (not scoped to a tournament).
   */
  subscribeToAllMatches(callback) {
    return supabase
      .channel('arena-all-matches')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_matches'
      }, callback)
      .subscribe();
  }

  async getMatch(matchId) {
    const { data, error } = await supabase
      .from('arena_matches')
      .select('*')
      .eq('id', matchId)
      .single();
    if (error) throw error;
    return data;
  }

  async createMatch(tournamentId, phase, player1Id, player2Id, matchFormat = null) {
    // If no format specified, look it up from the tournament
    if (matchFormat == null) {
      const { data: t } = await supabase.from('arena_tournaments').select('match_format').eq('id', tournamentId).single();
      matchFormat = t?.match_format || 1;
    }
    const { data, error } = await supabase
      .from('arena_matches')
      .insert({
        tournament_id: tournamentId,
        phase,
        player1_id: player1Id,
        player2_id: player2Id,
        match_format: matchFormat,
        status: 'pending',
        player1_rounds_won: 0,
        player2_rounds_won: 0
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Check if a participant is currently in an active match (drafting, in_progress, tiebreaker, roster_reveal).
   * Returns the active match if found, null otherwise.
   */
  async getActiveMatchForParticipant(participantId) {
    const { data, error } = await supabase
      .from('arena_matches')
      .select('*')
      .or(`player1_id.eq.${participantId},player2_id.eq.${participantId}`)
      .in('status', ['drafting', 'roster_reveal', 'in_progress', 'tiebreaker'])
      .limit(1);
    if (error) throw error;
    return data?.[0] || null;
  }

  async updateMatch(matchId, updates) {
    const { data, error } = await supabase
      .from('arena_matches')
      .update(updates)
      .eq('id', matchId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Forfeit a match — admin picks a winner, match is marked complete.
   * Updates participant win/loss stats.
   */
  async forfeitMatch(matchId, winnerId) {
    const match = await this.getMatch(matchId);
    if (!match) throw new Error('Match not found');
    if (match.status === 'complete') throw new Error('Match already complete');

    const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
    const isP1Winner = winnerId === match.player1_id;
    const fmt = getMatchFormat(match.match_format);

    // Update match — set rounds_won so the score reflects the forfeit
    await this.updateMatch(matchId, {
      status: 'complete',
      winner_id: winnerId,
      player1_rounds_won: isP1Winner ? fmt.roundsToWin : match.player1_rounds_won,
      player2_rounds_won: !isP1Winner ? fmt.roundsToWin : match.player2_rounds_won
    });

    // Resolve bets — pay out winners as if the match ended normally
    try { await this.resolveBetsForMatch(matchId, winnerId); } catch (e) { console.error('Bet resolve on forfeit:', e); }

    // Update participant stats
    const winnerPart = await supabase
      .from('arena_participants')
      .select('wins')
      .eq('id', winnerId)
      .single();
    if (winnerPart.data) {
      await supabase
        .from('arena_participants')
        .update({ wins: (winnerPart.data.wins || 0) + 1 })
        .eq('id', winnerId);
    }

    const loserPart = await supabase
      .from('arena_participants')
      .select('losses')
      .eq('id', loserId)
      .single();
    if (loserPart.data) {
      await supabase
        .from('arena_participants')
        .update({ losses: (loserPart.data.losses || 0) + 1 })
        .eq('id', loserId);
    }
  }

  /**
   * Refund all active bets for a match.
   */
  async refundBetsForMatch(matchId) {
    const { data: bets } = await supabase
      .from('arena_bets')
      .select('*')
      .eq('match_id', matchId)
      .eq('status', 'active');
    if (!bets || bets.length === 0) return;

    for (const bet of bets) {
      await supabase.from('arena_bets').update({ status: 'refunded', payout: bet.amount }).eq('id', bet.id);
      const { data: bettor } = await supabase.from('arena_participants').select('gold').eq('id', bet.bettor_id).single();
      if (bettor) {
        await supabase.from('arena_participants').update({ gold: bettor.gold + bet.amount }).eq('id', bet.bettor_id);
      }
    }
  }

  /**
   * Resolve bets for a match — pay out winners proportionally from losing pool.
   * If nobody bet on the winner, refund all bets instead.
   */
  async resolveBetsForMatch(matchId, winnerId) {
    const { data: bets } = await supabase
      .from('arena_bets')
      .select('*')
      .eq('match_id', matchId)
      .eq('status', 'active');
    if (!bets || bets.length === 0) return;

    const winningBets = bets.filter(b => b.backed_participant_id === winnerId);
    const losingBets = bets.filter(b => b.backed_participant_id !== winnerId);

    if (winningBets.length === 0) {
      // Nobody bet on the winner — refund all
      for (const bet of losingBets) {
        await supabase.from('arena_bets').update({ status: 'refunded', payout: bet.amount }).eq('id', bet.id);
        const { data: bettor } = await supabase.from('arena_participants').select('gold').eq('id', bet.bettor_id).single();
        if (bettor) {
          await supabase.from('arena_participants').update({ gold: bettor.gold + bet.amount }).eq('id', bet.bettor_id);
        }
      }
      return;
    }

    const totalLosingPool = losingBets.reduce((s, b) => s + b.amount, 0);
    const totalWinningBets = winningBets.reduce((s, b) => s + b.amount, 0);

    // Mark losing bets
    for (const bet of losingBets) {
      await supabase.from('arena_bets').update({ status: 'lost', payout: 0 }).eq('id', bet.id);
    }

    // Distribute losing pool proportionally to winners
    let distributed = 0;
    for (let i = 0; i < winningBets.length; i++) {
      const bet = winningBets[i];
      let share;
      if (i === winningBets.length - 1) {
        share = totalLosingPool - distributed;
      } else {
        share = Math.floor(totalLosingPool * (bet.amount / totalWinningBets));
        distributed += share;
      }

      const payout = bet.amount + share;
      await supabase.from('arena_bets').update({ status: 'won', payout }).eq('id', bet.id);
      const { data: bettor } = await supabase.from('arena_participants').select('gold').eq('id', bet.bettor_id).single();
      if (bettor) {
        await supabase.from('arena_participants').update({ gold: bettor.gold + payout }).eq('id', bet.bettor_id);
      }
    }
  }

  // ============================================
  // ROUNDS
  // ============================================

  async getRounds(matchId) {
    const { data, error } = await supabase
      .from('arena_rounds')
      .select('*')
      .eq('match_id', matchId)
      .order('round_number', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async createRound(matchId, roundNumber) {
    const { data, error } = await supabase
      .from('arena_rounds')
      .insert({
        match_id: matchId,
        round_number: roundNumber
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateRound(roundId, updates) {
    const { data, error } = await supabase
      .from('arena_rounds')
      .update(updates)
      .eq('id', roundId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ============================================
  // TURNS
  // ============================================

  async getTurns(roundId) {
    const { data, error } = await supabase
      .from('arena_turns')
      .select('*')
      .eq('round_id', roundId)
      .order('turn_number', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async getTurn(turnId) {
    const { data, error } = await supabase
      .from('arena_turns')
      .select('*')
      .eq('id', turnId)
      .single();
    if (error) throw error;
    return data;
  }

  // ============================================
  // TIEBREAKERS
  // ============================================

  async getTiebreaker(matchId) {
    const { data, error } = await supabase
      .from('arena_tiebreakers')
      .select('*')
      .eq('match_id', matchId)
      .single();
    if (error) throw error;
    return data;
  }

  // ============================================
  // REACTIONS
  // ============================================

  async getReactions(matchId) {
    const { data, error } = await supabase
      .from('arena_reactions')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  // ============================================
  // REALTIME SUBSCRIPTIONS
  // ============================================

  subscribeToMatches(tournamentId, callback) {
    return supabase
      .channel(`arena-matches-${tournamentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_matches',
        filter: `tournament_id=eq.${tournamentId}`
      }, callback)
      .subscribe();
  }

  subscribeToMatch(matchId, callback) {
    return supabase
      .channel(`arena-match-${matchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_matches',
        filter: `id=eq.${matchId}`
      }, callback)
      .subscribe();
  }

  subscribeToRounds(matchId, callback) {
    return supabase
      .channel(`arena-rounds-${matchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_rounds',
        filter: `match_id=eq.${matchId}`
      }, callback)
      .subscribe();
  }

  subscribeToTurns(roundId, callback) {
    return supabase
      .channel(`arena-turns-${roundId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_turns',
        filter: `round_id=eq.${roundId}`
      }, callback)
      .subscribe();
  }

  subscribeToTiebreaker(matchId, callback) {
    return supabase
      .channel(`arena-tiebreaker-${matchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_tiebreakers',
        filter: `match_id=eq.${matchId}`
      }, callback)
      .subscribe();
  }

  subscribeToReactions(matchId, callback) {
    return supabase
      .channel(`arena-reactions-${matchId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'arena_reactions',
        filter: `match_id=eq.${matchId}`
      }, callback)
      .subscribe();
  }

  unsubscribe(channel) {
    if (channel) {
      supabase.removeChannel(channel);
    }
  }

  // ============================================
  // PRESENCE (match spectators)
  // ============================================

  joinMatchPresence(matchId, user, onPresenceChange) {
    if (!user) return null;

    const channel = supabase.channel(`presence:arena-match:${matchId}`, {
      config: {
        presence: {
          key: user.id
        }
      }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users = Object.values(state).flat().map(p => ({
          id: p.user_id,
          name: p.user_name,
          avatar: p.user_avatar
        }));
        const otherUsers = users.filter(u => u.id !== user.id);
        onPresenceChange(otherUsers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: user.id,
            user_name: user.name || 'Anonymous',
            user_avatar: user.avatar || null,
            online_at: new Date().toISOString()
          });
        }
      });

    return channel;
  }

  leavePresence(channel) {
    if (channel) {
      channel.untrack();
      supabase.removeChannel(channel);
    }
  }

  // ============================================
  // NETLIFY FUNCTION HELPERS
  // ============================================

  async callFunction(functionName, body) {
    const response = await fetch(`/.netlify/functions/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`Function ${functionName} returned non-JSON:`, text.substring(0, 200));
      throw new Error(`Function ${functionName} returned an invalid response`);
    }
    if (!response.ok) {
      throw new Error(data.error || `Function ${functionName} failed`);
    }
    return data;
  }

  async submitDraft(matchId, discordId, characters) {
    return this.callFunction('arena-draft', { matchId, discordId, characters });
  }

  async sendCharacter(matchId, roundId, discordId, character) {
    return this.callFunction('arena-send-character', { matchId, roundId, discordId, character });
  }

  async submitAction(matchId, roundId, turnId, discordId, action, useAbility = false) {
    return this.callFunction('arena-action', { matchId, roundId, turnId, discordId, action, useAbility });
  }

  async forceDraft(matchId, requestingDiscordId) {
    return this.callFunction('arena-force-draft', { matchId, requestingDiscordId });
  }

  async forceSendCharacter(matchId, roundId, requestingDiscordId) {
    return this.callFunction('arena-force-send-character', { matchId, roundId, requestingDiscordId });
  }

  async forceAction(matchId, roundId, turnId, requestingDiscordId) {
    return this.callFunction('arena-force-action', { matchId, roundId, turnId, requestingDiscordId });
  }

  async submitReaction(matchId, discordId, emoji) {
    return this.callFunction('arena-react', { matchId, discordId, emoji });
  }

  async submitTiebreakerTap(matchId, discordId) {
    return this.callFunction('arena-tiebreaker-tap', { matchId, discordId });
  }

  async placeBet(matchId, discordId, backedParticipantId, amount) {
    return this.callFunction('arena-bet', { matchId, discordId, backedParticipantId, amount });
  }

  async getBetsForMatch(matchId) {
    const { data, error } = await supabase
      .from('arena_bets')
      .select('*')
      .eq('match_id', matchId);
    if (error) throw error;
    return data || [];
  }

  subscribeToBets(matchId, callback) {
    return supabase
      .channel(`arena-bets-${matchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_bets',
        filter: `match_id=eq.${matchId}`
      }, callback)
      .subscribe();
  }

  subscribeToParticipantGold(tournamentId, callback) {
    return supabase
      .channel(`arena-participants-gold-${tournamentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'arena_participants',
        filter: `tournament_id=eq.${tournamentId}`
      }, callback)
      .subscribe();
  }

  // ============================================
  // HELPER: Get players for a user
  // ============================================

  async getPlayersByDiscordId(discordId) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('discord_id', discordId)
      .order('account_number', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async getAllAppUsers() {
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .order('username', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // ============================================
  // CHALLENGES
  // ============================================

  async createChallenge(challengerDiscordId, challengedDiscordId, matchFormat = 1) {
    // Clean up any stale pending challenges from this challenger
    await supabase
      .from('arena_challenges')
      .update({ status: 'expired' })
      .eq('challenger_discord_id', challengerDiscordId)
      .eq('status', 'pending');

    const { data, error } = await supabase
      .from('arena_challenges')
      .insert({
        challenger_discord_id: challengerDiscordId,
        challenged_discord_id: challengedDiscordId,
        match_format: matchFormat,
        status: 'pending'
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async updateChallenge(id, updates) {
    const { data, error } = await supabase
      .from('arena_challenges')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getChallenge(id) {
    const { data, error } = await supabase
      .from('arena_challenges')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  /**
   * Subscribe to incoming challenges for a specific player.
   * Fires on INSERT (new challenge) and UPDATE (status change).
   */
  subscribeToChallenges(discordId, callback) {
    return supabase
      .channel(`arena-challenges-${discordId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'arena_challenges',
        filter: `challenged_discord_id=eq.${discordId}`
      }, callback)
      .subscribe();
  }

  /**
   * Subscribe to updates on a challenge you sent (to see accept/decline).
   */
  subscribeToChallengeUpdates(challengeId, callback) {
    return supabase
      .channel(`arena-challenge-${challengeId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'arena_challenges',
        filter: `id=eq.${challengeId}`
      }, callback)
      .subscribe();
  }

  // ============================================
  // STANDINGS
  // ============================================

  async getStandings(tournamentId, { includeTiebreakers = false } = {}) {
    const participants = await this.getParticipants(tournamentId);
    const matches = await this.getMatches(tournamentId);

    // Compute wins/losses from completed group stage match results (more reliable than denormalized counters)
    const completedMatches = matches.filter(m => m.status === 'complete' && m.winner_id && m.phase === 'group_stage');
    const statsMap = {};
    for (const m of completedMatches) {
      const winnerId = m.winner_id;
      const loserId = m.player1_id === winnerId ? m.player2_id : m.player1_id;
      if (!statsMap[winnerId]) statsMap[winnerId] = { wins: 0, losses: 0 };
      if (!statsMap[loserId]) statsMap[loserId] = { wins: 0, losses: 0 };
      statsMap[winnerId].wins++;
      statsMap[loserId].losses++;
    }

    // Optionally compute tiebreaker stats for secondary sorting
    let tbStatsMap = {};
    if (includeTiebreakers) {
      const tbMatches = matches.filter(m => m.status === 'complete' && m.winner_id && m.phase === 'tiebreaker');
      for (const m of tbMatches) {
        const winnerId = m.winner_id;
        const loserId = m.player1_id === winnerId ? m.player2_id : m.player1_id;
        if (!tbStatsMap[winnerId]) tbStatsMap[winnerId] = { wins: 0, losses: 0 };
        if (!tbStatsMap[loserId]) tbStatsMap[loserId] = { wins: 0, losses: 0 };
        tbStatsMap[winnerId].wins++;
        tbStatsMap[loserId].losses++;
      }
    }

    // Group by bracket, override wins/losses with computed stats
    const brackets = {};
    for (const p of participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      const computed = statsMap[p.id] || { wins: 0, losses: 0 };
      const tb = tbStatsMap[p.id] || { wins: 0, losses: 0 };
      brackets[bn].push({ ...p, wins: computed.wins, losses: computed.losses, tbWins: tb.wins, tbLosses: tb.losses });
    }

    // Sort each bracket by wins (desc), then losses (asc), then tiebreaker wins (desc), tiebreaker losses (asc)
    for (const bn of Object.keys(brackets)) {
      brackets[bn].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.losses !== b.losses) return a.losses - b.losses;
        if (includeTiebreakers) {
          if (b.tbWins !== a.tbWins) return b.tbWins - a.tbWins;
          if (a.tbLosses !== b.tbLosses) return a.tbLosses - b.tbLosses;
        }
        return 0;
      });
    }

    return { brackets, matches };
  }

  // ============================================
  // PHASE ADVANCEMENT
  // ============================================

  async generateGroupMatches(tournamentId) {
    const participants = await this.getParticipants(tournamentId);

    // Initialize gold from prize pool
    const tournament = await this.getTournament(tournamentId);
    const pool = tournament.prizes?.pool;
    if (pool && pool > 0) {
      const dist = distributePrizePool(pool, participants.length);
      // Starting gold = participation tier (lowest prize), fallback to smallest value
      const startingGold = dist?.participation
        || Math.min(...Object.values(dist || { x: 500 }));
      const promises = participants.map(p =>
        supabase.from('arena_participants').update({ gold: startingGold }).eq('id', p.id)
      );
      await Promise.all(promises);
    }

    // Group by bracket
    const brackets = {};
    for (const p of participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      brackets[bn].push(p);
    }

    const matches = [];
    for (const players of Object.values(brackets)) {
      // Round robin within bracket
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          matches.push(
            await this.createMatch(tournamentId, 'group_stage', players[i].id, players[j].id)
          );
        }
      }
    }

    await this.updateTournament(tournamentId, {
      status: 'active',
      current_phase: 'group_stage'
    });

    return matches;
  }

  /**
   * Detect if there are ties at advancement boundaries that need tiebreaker matches.
   * Returns { needed, tiedGroups: [{ bracketNumber, players, advanceCount }] }
   */
  async detectTiebreakerNeeded(tournamentId) {
    const { brackets } = await this.getStandings(tournamentId, { includeTiebreakers: true });
    const bracketNumbers = Object.keys(brackets)
      .filter(bn => bn !== '0')
      .sort((a, b) => a - b);

    const tiedGroups = [];

    for (const bn of bracketNumbers) {
      const players = brackets[bn];
      // Top 2 advance per bracket (multi-bracket) or top 4 (single bracket)
      const advanceCount = bracketNumbers.length >= 2 ? 2 : Math.min(4, players.length);
      if (players.length <= advanceCount) continue; // Everyone advances, no tie issue

      // Check the cutoff boundary — last advancing vs first non-advancing
      const lastIn = players[advanceCount - 1];
      const firstOut = players[advanceCount];

      if (lastIn.wins === firstOut.wins && lastIn.losses === firstOut.losses
          && lastIn.tbWins === firstOut.tbWins && lastIn.tbLosses === firstOut.tbLosses) {
        // Collect all players with the same W/L/TB record as the cutoff
        const tied = players.filter(p =>
          p.wins === lastIn.wins && p.losses === lastIn.losses
          && p.tbWins === lastIn.tbWins && p.tbLosses === lastIn.tbLosses
        );
        tiedGroups.push({ bracketNumber: bn, players: tied, advanceCount });
      }
    }

    // Handle single bracket with bracket 0
    if (bracketNumbers.length === 0 && brackets[0]) {
      const players = brackets[0];
      const advanceCount = Math.min(4, players.length);
      if (players.length > advanceCount) {
        const lastIn = players[advanceCount - 1];
        const firstOut = players[advanceCount];
        if (lastIn.wins === firstOut.wins && lastIn.losses === firstOut.losses
            && lastIn.tbWins === firstOut.tbWins && lastIn.tbLosses === firstOut.tbLosses) {
          const tied = players.filter(p =>
            p.wins === lastIn.wins && p.losses === lastIn.losses
            && p.tbWins === lastIn.tbWins && p.tbLosses === lastIn.tbLosses
          );
          tiedGroups.push({ bracketNumber: 0, players: tied, advanceCount });
        }
      }
    }

    return { needed: tiedGroups.length > 0, tiedGroups };
  }

  /**
   * Generate round-robin Bo1 tiebreaker matches for tied players.
   */
  async generateTiebreakerMatches(tournamentId) {
    const { needed, tiedGroups } = await this.detectTiebreakerNeeded(tournamentId);
    if (!needed) return { tiebreakerNeeded: false };

    const matches = [];
    for (const group of tiedGroups) {
      // Round-robin among tied players, always Bo1
      for (let i = 0; i < group.players.length; i++) {
        for (let j = i + 1; j < group.players.length; j++) {
          matches.push(
            await this.createMatch(tournamentId, 'tiebreaker', group.players[i].id, group.players[j].id, 1)
          );
        }
      }
    }

    await this.updateTournament(tournamentId, { current_phase: 'tiebreaker' });
    return { tiebreakerNeeded: true, matches };
  }

  async generateSemifinalMatches(tournamentId, { forceAdvance = false } = {}) {
    // If force-advancing, auto-forfeit incomplete group + tiebreaker matches first
    if (forceAdvance) {
      const allMatches = await this.getMatches(tournamentId);
      const incomplete = allMatches.filter(m =>
        (m.phase === 'group_stage' || m.phase === 'tiebreaker') && m.status !== 'complete'
      );
      for (const m of incomplete) {
        await this.forfeitMatch(m.id, m.player1_id);
      }
    }

    // Check for ties that need tiebreaker matches
    const tieCheck = await this.detectTiebreakerNeeded(tournamentId);
    if (tieCheck.needed && !forceAdvance) {
      return await this.generateTiebreakerMatches(tournamentId);
    }

    const { brackets } = await this.getStandings(tournamentId, { includeTiebreakers: true });
    const bracketNumbers = Object.keys(brackets)
      .filter(bn => bn !== '0') // Exclude unassigned pool
      .sort((a, b) => a - b);

    let semifinalists;

    if (bracketNumbers.length >= 2) {
      // Multiple brackets — top 2 from each bracket (1st seed vs other bracket's 2nd seed)
      semifinalists = [];
      for (const bn of bracketNumbers) {
        const top2 = brackets[bn].slice(0, 2);
        semifinalists.push(...top2);
      }
      semifinalists = semifinalists.filter(Boolean);
    } else {
      // Single bracket or no brackets — take top players ranked by wins
      const allPlayers = bracketNumbers.flatMap(bn => brackets[bn]);
      // Also include bracket 0 if that's all we have
      if (bracketNumbers.length === 0 && brackets[0]) {
        allPlayers.push(...brackets[0]);
      }
      // Take top 4 (or top 2 if fewer) — already sorted by wins desc
      const count = allPlayers.length >= 4 ? 4 : Math.min(allPlayers.length, 2);
      semifinalists = allPlayers.slice(0, count);
    }

    if (semifinalists.length < 2) throw new Error('Not enough players with results for semifinals');

    const matches = [];
    // 1st vs last, 2nd vs 2nd-last, etc.
    const half = Math.floor(semifinalists.length / 2);
    for (let i = 0; i < half; i++) {
      matches.push(
        await this.createMatch(tournamentId, 'semifinals', semifinalists[i].id, semifinalists[semifinalists.length - 1 - i].id)
      );
    }

    await this.updateTournament(tournamentId, { current_phase: 'semifinals' });
    return matches;
  }

  /**
   * Award placement prizes from the prize pool when tournament completes.
   * Derives placements from semifinal/final results.
   */
  async distributePlacementPrizes(tournamentId) {
    const tournament = await this.getTournament(tournamentId);
    const pool = tournament?.prizes?.pool;
    if (!pool || pool <= 0) return;

    const participants = await this.getParticipants(tournamentId);
    const matches = await this.getMatches(tournamentId);
    const prizes = distributePrizePool(pool, participants.length);
    if (!prizes) return;

    const semiMatches = matches.filter(m => m.phase === 'semifinals' && m.status === 'complete');
    const finalsMatches = matches.filter(m => m.phase === 'finals' && m.status === 'complete');
    const grandFinalMatch = matches.find(m => m.phase === 'grand_final' && m.status === 'complete');

    // The "championship" match is the grand final if it exists, otherwise the single finals match
    const championshipMatch = grandFinalMatch || (finalsMatches.length === 1 ? finalsMatches[0] : null);

    // Build placement map: participantId → prize key
    const placements = {};

    if (championshipMatch?.winner_id) {
      placements[championshipMatch.winner_id] = '1st';
      const champLoser = championshipMatch.player1_id === championshipMatch.winner_id ? championshipMatch.player2_id : championshipMatch.player1_id;
      placements[champLoser] = '2nd';
    } else {
      // No championship played — check if a semifinal winner was auto-promoted
      const semiWinners = semiMatches.map(m => m.winner_id).filter(Boolean);
      if (semiWinners.length === 1) {
        placements[semiWinners[0]] = '1st';
      }
    }

    // Finals losers get 3rd/4th (when grand final exists, these are the finals losers)
    if (grandFinalMatch && finalsMatches.length > 0) {
      const finalsLosers = finalsMatches
        .map(m => m.winner_id ? (m.player1_id === m.winner_id ? m.player2_id : m.player1_id) : null)
        .filter(pid => pid && !placements[pid]);
      finalsLosers.forEach(pid => {
        if (!placements[pid]) {
          const usedPlaces = Object.values(placements);
          placements[pid] = !usedPlaces.includes('3rd') ? '3rd' : '4th';
        }
      });
    }

    // Semi losers get 3rd/4th (or 5th+ if finals losers already filled 3rd/4th)
    const semiLosers = semiMatches
      .map(m => m.winner_id ? (m.player1_id === m.winner_id ? m.player2_id : m.player1_id) : null)
      .filter(pid => pid && !placements[pid]);
    semiLosers.forEach(pid => {
      if (!placements[pid]) {
        const usedPlaces = Object.values(placements);
        placements[pid] = !usedPlaces.includes('3rd') ? '3rd' : !usedPlaces.includes('4th') ? '4th' : null;
      }
    });

    // Everyone already received participation gold as starting gold,
    // so only award the difference above that for placed players.
    const startingGold = prizes.participation || 0;

    for (const [pid, place] of Object.entries(placements)) {
      const amount = prizes[place];
      if (!amount || amount <= 0) continue;
      const bonus = amount - startingGold;
      if (bonus <= 0) continue;
      const { data } = await supabase.from('arena_participants').select('gold').eq('id', pid).single();
      if (data) {
        await supabase.from('arena_participants').update({ gold: (data.gold || 0) + bonus }).eq('id', pid);
      }
    }
    // 5th+ already received their participation prize at the start — no extra gold needed.
  }

  async generateFinalMatch(tournamentId, { forceAdvance = false } = {}) {
    const currentPhase = (await this.getTournament(tournamentId)).current_phase;

    // If force-advancing, auto-forfeit incomplete matches from current phase
    if (forceAdvance) {
      const allMatches = await this.getMatches(tournamentId);
      const forfeitable = currentPhase === 'finals' ? 'finals' : 'semifinals';
      const incomplete = allMatches.filter(m => m.phase === forfeitable && m.status !== 'complete');
      for (const m of incomplete) {
        await this.forfeitMatch(m.id, m.player1_id);
      }
    }

    const matches = await this.getMatches(tournamentId);

    // Determine which phase we're advancing FROM
    if (currentPhase === 'finals') {
      // Advancing from finals → grand final
      const finalsMatches = matches.filter(m => m.phase === 'finals' && m.status === 'complete');
      const winners = finalsMatches.map(m => m.winner_id).filter(Boolean);

      if (winners.length < 2) {
        if (winners.length === 1) {
          await this.distributePlacementPrizes(tournamentId);
          await this.updateTournament(tournamentId, { status: 'complete', current_phase: 'complete' });
          return { skipped: true, winnerId: winners[0] };
        }
        throw new Error('No finals winners to advance');
      }

      const grandFinal = await this.createMatch(tournamentId, 'grand_final', winners[0], winners[1]);
      await this.updateTournament(tournamentId, { current_phase: 'grand_final' });
      return grandFinal;
    }

    // Advancing from semifinals → finals
    const semis = matches.filter(m => m.phase === 'semifinals' && m.status === 'complete');
    const winners = semis.map(m => m.winner_id).filter(Boolean);

    if (winners.length < 2) {
      if (winners.length === 1) {
        await this.distributePlacementPrizes(tournamentId);
        await this.updateTournament(tournamentId, { status: 'complete', current_phase: 'complete' });
        return { skipped: true, winnerId: winners[0] };
      }
      throw new Error('No semifinal winners to advance');
    }

    // Pair up winners: 1st vs last, 2nd vs 2nd-last
    const finalMatches = [];
    const half = Math.floor(winners.length / 2);
    for (let i = 0; i < half; i++) {
      finalMatches.push(
        await this.createMatch(tournamentId, 'finals', winners[i], winners[winners.length - 1 - i])
      );
    }

    // If only 1 final match, go straight to finals (no grand final needed)
    // If 2+ final matches, they'll play finals then grand final
    await this.updateTournament(tournamentId, { current_phase: 'finals' });
    return finalMatches.length === 1 ? finalMatches[0] : finalMatches;
  }
}

export const arenaData = new ArenaDataService();
