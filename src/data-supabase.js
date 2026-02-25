/**
 * Supabase Data Service
 *
 * Drop-in replacement for data.js that uses Supabase instead of Google Sheets.
 *
 * To switch from Google Sheets to Supabase:
 * 1. Run the migration script (supabase/migrate.js)
 * 2. Rename this file to data.js (backup the original first)
 *    OR update imports to use data-supabase.js
 * 3. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

class DataService {
  constructor() {
    this._session = null;
    this._userRole = null;
  }

  // ============================================
  // CONFIGURATION (compatibility with old API)
  // ============================================

  configure() {
    // No-op for compatibility - Supabase uses env vars
    console.log('configure() is not needed with Supabase');
  }

  loadConfig() {
    // No-op for compatibility
    return true;
  }

  isConfigured() {
    return !!supabaseUrl && !!supabaseAnonKey;
  }

  hasWriteAccess() {
    return this._session !== null;
  }

  checkPassword() {
    // Deprecated - use Supabase auth
    return true;
  }

  // ============================================
  // AUTHENTICATION
  // ============================================

  /**
   * Sign in with Discord OAuth
   * Redirects to Discord, then back to the app
   */
  async signInWithDiscord() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) throw error;
    return data;
  }

  /**
   * Sign in with email/password (fallback)
   */
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    this._session = data.session;
    await this._loadUserRole();
    return data;
  }

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    this._session = null;
    this._userRole = null;
  }

  async getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    this._session = session;

    if (session && !this._userRole) {
      await this._loadUserRole();
    }

    return session;
  }

  async exchangeCodeForSession(code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    this._session = data.session;
    if (this._session) {
      await this._loadUserRole();
    }
    return data;
  }

  async _loadUserRole() {
    if (!this._session) {
      this._userRole = null;
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', this._session.user.id)
      .single();

    // If no profile exists, create one
    if (error && error.code === 'PGRST116') {
      console.log('[Auth] Creating profile for new user');
      const { data: newProfile } = await supabase
        .from('profiles')
        .insert({
          id: this._session.user.id,
          role: 'player',
          display_name: this.getDisplayName()
        })
        .select('role')
        .single();

      this._userRole = newProfile?.role || 'player';
      return;
    }

    this._userRole = data?.role || 'player';
  }

  /**
   * Get the current user's Discord info
   */
  getUser() {
    return this._session?.user || null;
  }

  /**
   * Get Discord username for display
   */
  getDisplayName() {
    const user = this.getUser();
    if (!user) return null;

    // Discord users have user_metadata with username
    return user.user_metadata?.full_name
      || user.user_metadata?.custom_claims?.global_name
      || user.user_metadata?.name
      || user.user_metadata?.preferred_username
      || user.user_metadata?.username
      || 'User';
  }

  /**
   * Get Discord avatar URL
   */
  getAvatarUrl() {
    const user = this.getUser();
    return user?.user_metadata?.avatar_url || null;
  }

  getUserRole() {
    return this._userRole;
  }

  isAuthenticated() {
    return this._session !== null;
  }

  isAdmin() {
    return this._userRole === 'admin';
  }

  isPlayer() {
    return this._userRole === 'player' || this._userRole === 'admin';
  }

  /**
   * Check if user has required role
   */
  hasAccess(requiredRole) {
    if (!this._userRole) return false;

    if (requiredRole === 'admin') {
      return this._userRole === 'admin';
    } else if (requiredRole === 'player') {
      return this._userRole === 'admin' || this._userRole === 'player';
    }

    return false;
  }

  // Listen for auth changes
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      this._session = session;
      if (session) {
        this._loadUserRole().then(() => callback(event, session));
      } else {
        this._userRole = null;
        callback(event, session);
      }
    });
  }

  // ============================================
  // PLAYERS
  // ============================================

  async getPlayers() {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error fetching players:', error);
      return [];
    }

    // Transform to match old format
    return data.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role || '',
      notes: p.notes || '',
      weapon: p.weapon || '',
      weaponEnhance: p.weapon_enhance || '',
      suffix1: p.suffix1 || '',
      suffix2: p.suffix2 || '',
      armor: p.armor || '',
      armorEnhance: p.armor_enhance || '',
      hardcoreCompleted: p.hardcore_completed || '',
      classicCompleted: p.classic_completed || '',
      classicTicketUsed: p.classic_ticket_used || ''
    }));
  }

  async addPlayer(player) {
    const { data, error } = await supabase
      .from('players')
      .insert({
        name: player.name,
        role: player.role,
        notes: player.notes,
        weapon: player.weapon,
        weapon_enhance: player.weaponEnhance,
        suffix1: player.suffix1,
        suffix2: player.suffix2,
        armor: player.armor,
        armor_enhance: player.armorEnhance,
        hardcore_completed: player.hardcoreCompleted || null,
        classic_completed: player.classicCompleted || null,
        classic_ticket_used: player.classicTicketUsed || null
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  }

  async updatePlayer(player, oldName) {
    // Find by old name if provided, otherwise use id or current name
    let query = supabase.from('players').update({
      name: player.name,
      role: player.role,
      notes: player.notes,
      weapon: player.weapon,
      weapon_enhance: player.weaponEnhance,
      suffix1: player.suffix1,
      suffix2: player.suffix2,
      armor: player.armor,
      armor_enhance: player.armorEnhance
    });

    if (player.id) {
      query = query.eq('id', player.id);
    } else {
      query = query.eq('name', oldName || player.name);
    }

    const { data, error } = await query.select().single();

    if (error) throw error;
    return { success: true, data };
  }

  async deletePlayer(playerName) {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('name', playerName);

    if (error) throw error;
    return { success: true };
  }

  // ============================================
  // LINEUPS
  // ============================================

  async getLineups() {
    const { data, error } = await supabase
      .from('lineups')
      .select(`
        *,
        lineup_players (
          player_id,
          player_name,
          slot_position,
          uses_ticket,
          pilot_name
        )
      `)
      .order('name');

    if (error) {
      console.error('Error fetching lineups:', error);
      return [];
    }

    // Transform to match old format
    return data.map(lineup => {
      const players = Array(8).fill('');
      const ticketPlayers = Array(8).fill(false);
      const pilotPlayers = Array(8).fill('');

      (lineup.lineup_players || [])
        .sort((a, b) => a.slot_position - b.slot_position)
        .forEach(lp => {
          const idx = lp.slot_position - 1;
          if (idx >= 0 && idx < 8) {
            players[idx] = lp.player_name || '';
            ticketPlayers[idx] = lp.uses_ticket || false;
            pilotPlayers[idx] = lp.pilot_name || '';
          }
        });

      return {
        id: lineup.id,
        name: lineup.name,
        raidType: lineup.raid_type,
        status: lineup.status,
        completed: lineup.completed,
        isTemplate: lineup.is_template,
        notes: lineup.notes || '',
        players,
        ticketPlayers,
        pilotPlayers
      };
    });
  }

  async addLineup(lineup) {
    return this._saveLineup(lineup, false);
  }

  async updateLineup(lineup, oldName) {
    return this._saveLineup(lineup, true, oldName);
  }

  async _saveLineup(lineup, isUpdate, oldName = null) {
    let lineupId = lineup.id;

    if (isUpdate && !lineupId) {
      // Find existing lineup by name and raid type
      const { data: existing } = await supabase
        .from('lineups')
        .select('id')
        .eq('name', oldName || lineup.name)
        .eq('raid_type', lineup.raidType)
        .single();

      lineupId = existing?.id;
    }

    // Upsert lineup
    const lineupData = {
      name: lineup.name,
      raid_type: lineup.raidType,
      status: lineup.status || 'draft',
      completed: lineup.completed || false,
      is_template: lineup.isTemplate || false,
      notes: lineup.notes || ''
    };

    if (lineupId) {
      lineupData.id = lineupId;
    }

    const { data: savedLineup, error } = await supabase
      .from('lineups')
      .upsert(lineupData)
      .select()
      .single();

    if (error) throw error;

    // Delete existing lineup_players
    await supabase
      .from('lineup_players')
      .delete()
      .eq('lineup_id', savedLineup.id);

    // Insert new lineup_players
    const lineupPlayers = (lineup.players || [])
      .map((name, idx) => {
        if (!name) return null;
        return {
          lineup_id: savedLineup.id,
          player_name: name,
          slot_position: idx + 1,
          uses_ticket: lineup.ticketPlayers?.[idx] || false,
          pilot_name: lineup.pilotPlayers?.[idx] || null
        };
      })
      .filter(Boolean);

    if (lineupPlayers.length > 0) {
      const { error: lpError } = await supabase
        .from('lineup_players')
        .insert(lineupPlayers);

      if (lpError) throw lpError;
    }

    return { success: true, data: savedLineup };
  }

  async deleteLineup(lineupName, raidType) {
    let query = supabase.from('lineups').delete().eq('name', lineupName);

    if (raidType) {
      query = query.eq('raid_type', raidType);
    }

    const { error } = await query;

    if (error) throw error;
    return { success: true };
  }

  async toggleLineupCompleted(lineupName) {
    // Get current state
    const { data: lineup } = await supabase
      .from('lineups')
      .select('id, completed')
      .eq('name', lineupName)
      .single();

    if (!lineup) throw new Error('Lineup not found');

    // Toggle
    const { error } = await supabase
      .from('lineups')
      .update({ completed: !lineup.completed })
      .eq('id', lineup.id);

    if (error) throw error;
    return { success: true, completed: !lineup.completed };
  }

  // ============================================
  // WEEKLY RESET
  // ============================================

  async checkWeeklyReset(lastResetTimestamp) {
    // Get last cleanup time from metadata
    const { data: metadata } = await supabase
      .from('metadata')
      .select('value')
      .eq('key', 'last_weekly_cleanup')
      .single();

    const lastCleanup = parseInt(metadata?.value || '0', 10);

    if (lastCleanup >= lastResetTimestamp) {
      console.log('[Weekly Reset] Already cleaned up for this period');
      return { success: true, cleaned: false };
    }

    // Delete non-template lineups
    const { data: deleted, error: deleteError } = await supabase
      .from('lineups')
      .delete()
      .eq('is_template', false)
      .select('id');

    if (deleteError) throw deleteError;

    // Update metadata
    const { error: metaError } = await supabase
      .from('metadata')
      .upsert({
        key: 'last_weekly_cleanup',
        value: String(lastResetTimestamp)
      });

    if (metaError) throw metaError;

    console.log(`[Weekly Reset] Deleted ${deleted?.length || 0} non-template lineups`);
    return { success: true, cleaned: true, deletedCount: deleted?.length || 0 };
  }

  // ============================================
  // COMPLETION TRACKING
  // ============================================

  /**
   * Check if a completion timestamp is from the current weekly reset period
   */
  isCompletedThisWeek(timestamp) {
    if (!timestamp) return false;

    try {
      const completedDate = new Date(timestamp);
      const now = new Date();

      // Get the most recent Friday 5pm in Pacific Time
      const nowPT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const dayOfWeek = nowPT.getDay();

      let daysBack;
      if (dayOfWeek === 5) {
        daysBack = nowPT.getHours() >= 17 ? 0 : 7;
      } else if (dayOfWeek === 6) {
        daysBack = 1;
      } else if (dayOfWeek === 0) {
        daysBack = 2;
      } else {
        daysBack = dayOfWeek + 2;
      }

      const lastFridayPT = new Date(nowPT);
      lastFridayPT.setDate(lastFridayPT.getDate() - daysBack);
      lastFridayPT.setHours(17, 0, 0, 0);

      const completedPT = new Date(completedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

      return completedPT >= lastFridayPT;
    } catch (error) {
      console.error('Error parsing completion timestamp:', error);
      return false;
    }
  }

  playerNeedsRaid(player, raidType) {
    const timestamp = raidType === 'Hardcore' ? player.hardcoreCompleted : player.classicCompleted;
    return !this.isCompletedThisWeek(timestamp);
  }

  playerTicketUsed(player, raidType) {
    if (raidType !== 'Classic') return false;
    return this.isCompletedThisWeek(player.classicTicketUsed);
  }

  async markPlayersCompleted(playerNames, raidType, ticketPlayerNames = []) {
    const column = raidType === 'Hardcore' ? 'hardcore_completed' : 'classic_completed';
    const now = new Date().toISOString();

    // Update completion timestamp
    const { error } = await supabase
      .from('players')
      .update({ [column]: now })
      .in('name', playerNames);

    if (error) throw error;

    // Update ticket usage if applicable
    if (ticketPlayerNames.length > 0 && raidType === 'Classic') {
      const { error: ticketError } = await supabase
        .from('players')
        .update({ classic_ticket_used: now })
        .in('name', ticketPlayerNames);

      if (ticketError) throw ticketError;
    }

    return { success: true };
  }

  async unmarkPlayersCompleted(playerNames, raidType, excludeLineupName, ticketPlayerNames = []) {
    const column = raidType === 'Hardcore' ? 'hardcore_completed' : 'classic_completed';

    // Clear completion timestamp
    const { error } = await supabase
      .from('players')
      .update({ [column]: null })
      .in('name', playerNames);

    if (error) throw error;

    // Clear ticket usage if applicable
    if (ticketPlayerNames.length > 0 && raidType === 'Classic') {
      const { error: ticketError } = await supabase
        .from('players')
        .update({ classic_ticket_used: null })
        .in('name', ticketPlayerNames);

      if (ticketError) throw ticketError;
    }

    return { success: true };
  }

  // ============================================
  // SPENDING CONFIG
  // ============================================

  async getSpendingConfig() {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'spending_config')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      throw error;
    }

    return { success: true, config: data?.value || null };
  }

  async saveSpendingConfig(config) {
    const { error } = await supabase
      .from('app_config')
      .upsert({
        key: 'spending_config',
        value: config
      });

    if (error) throw error;
    return { success: true };
  }

  // ============================================
  // REAL-TIME SUBSCRIPTIONS (bonus feature!)
  // ============================================

  subscribeToPlayers(callback) {
    return supabase
      .channel('players-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, callback)
      .subscribe();
  }

  subscribeToLineups(callback) {
    return supabase
      .channel('lineups-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineups' }, callback)
      .subscribe();
  }

  unsubscribe(subscription) {
    supabase.removeChannel(subscription);
  }
}

export const dataService = new DataService();
