/**
 * Arena Data Service
 *
 * Standalone data module for all arena operations.
 * Imports the same Supabase client setup from data.js but keeps arena code isolated.
 */

import { createClient } from '@supabase/supabase-js';

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

  async createTournament(name, bracketCount, prizes = null) {
    const { data, error } = await supabase
      .from('arena_tournaments')
      .insert({
        name,
        bracket_count: bracketCount,
        prizes,
        status: 'setup',
        current_phase: 'setup'
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

    // Reset participant stats
    const { error: partErr } = await supabase
      .from('arena_participants')
      .update({ wins: 0, losses: 0 })
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
  async createQuickMatch(player1DiscordId, player2DiscordId) {
    // Create a throwaway tournament
    const { data: tournament, error: tErr } = await supabase
      .from('arena_tournaments')
      .insert({
        name: `Quick Match`,
        bracket_count: 1,
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

  async getMatch(matchId) {
    const { data, error } = await supabase
      .from('arena_matches')
      .select('*')
      .eq('id', matchId)
      .single();
    if (error) throw error;
    return data;
  }

  async createMatch(tournamentId, phase, player1Id, player2Id) {
    const { data, error } = await supabase
      .from('arena_matches')
      .insert({
        tournament_id: tournamentId,
        phase,
        player1_id: player1Id,
        player2_id: player2Id,
        status: 'pending',
        player1_rounds_won: 0,
        player2_rounds_won: 0
      })
      .select()
      .single();
    if (error) throw error;
    return data;
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

  async submitReaction(matchId, discordId, emoji) {
    return this.callFunction('arena-react', { matchId, discordId, emoji });
  }

  async submitTiebreakerTap(matchId, discordId) {
    return this.callFunction('arena-tiebreaker-tap', { matchId, discordId });
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

  async createChallenge(challengerDiscordId, challengedDiscordId) {
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

  async getStandings(tournamentId) {
    const participants = await this.getParticipants(tournamentId);
    const matches = await this.getMatches(tournamentId);

    // Group by bracket
    const brackets = {};
    for (const p of participants) {
      const bn = p.bracket_number || 0;
      if (!brackets[bn]) brackets[bn] = [];
      brackets[bn].push({ ...p });
    }

    // Sort each bracket by wins (desc), then losses (asc)
    for (const bn of Object.keys(brackets)) {
      brackets[bn].sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.losses - b.losses;
      });
    }

    return { brackets, matches };
  }

  // ============================================
  // PHASE ADVANCEMENT
  // ============================================

  async generateGroupMatches(tournamentId) {
    const participants = await this.getParticipants(tournamentId);

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

  async generateSemifinalMatches(tournamentId) {
    const { brackets } = await this.getStandings(tournamentId);
    const bracketNumbers = Object.keys(brackets).sort((a, b) => a - b);

    // Top player from each bracket
    const semifinalists = bracketNumbers.map(bn => brackets[bn][0]).filter(Boolean);

    if (semifinalists.length < 2) throw new Error('Not enough bracket winners for semifinals');

    const matches = [];
    // 1st bracket top vs last bracket top, 2nd vs 2nd-last, etc.
    const half = Math.floor(semifinalists.length / 2);
    for (let i = 0; i < half; i++) {
      matches.push(
        await this.createMatch(tournamentId, 'semifinals', semifinalists[i].id, semifinalists[semifinalists.length - 1 - i].id)
      );
    }

    await this.updateTournament(tournamentId, { current_phase: 'semifinals' });
    return matches;
  }

  async generateFinalMatch(tournamentId) {
    const matches = await this.getMatches(tournamentId);
    const semis = matches.filter(m => m.phase === 'semifinals' && m.status === 'complete');

    const winners = semis.map(m => m.winner_id).filter(Boolean);
    if (winners.length < 2) throw new Error('Not enough semifinal winners for final');

    const finalMatch = await this.createMatch(tournamentId, 'finals', winners[0], winners[1]);
    await this.updateTournament(tournamentId, { current_phase: 'finals' });
    return finalMatch;
  }
}

export const arenaData = new ArenaDataService();
