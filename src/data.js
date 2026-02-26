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

// Discord OAuth configuration
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const SESSION_KEY = 'aftl_discord_user';

class DataService {
  constructor() {
    this._user = null;
    this._userRole = null;
    this._authCallbacks = [];
  }

  // ============================================
  // CONFIGURATION (compatibility with old API)
  // ============================================

  configure() {
    // No-op for compatibility
  }

  loadConfig() {
    return true;
  }

  isConfigured() {
    return !!supabaseUrl && !!supabaseAnonKey;
  }

  hasWriteAccess() {
    return this._user !== null;
  }

  checkPassword() {
    return true;
  }

  // ============================================
  // DISCORD OAUTH (Custom - No Email)
  // ============================================

  /**
   * Redirect to Discord OAuth
   * Only requests 'identify' scope - no email access
   */
  signInWithDiscord() {
    const redirectUri = window.location.origin;
    const scope = 'identify'; // NO email scope

    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scope
    });

    window.location.href = `${DISCORD_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Handle OAuth callback - exchange code for user info
   */
  async handleOAuthCallback(code) {
    const redirectUri = window.location.origin;

    // Call our Netlify function to exchange code for user info
    const response = await fetch('/.netlify/functions/discord-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Authentication failed');
    }

    const { user } = await response.json();

    // Save user to localStorage
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    this._user = user;

    // Load or create user in database
    await this._loadOrCreateUser();

    // Notify listeners
    this._notifyAuthChange('SIGNED_IN');

    return user;
  }

  /**
   * Load existing session from localStorage
   */
  async loadSession() {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        this._user = JSON.parse(stored);
        await this._loadOrCreateUser();
        return this._user;
      } catch (e) {
        localStorage.removeItem(SESSION_KEY);
      }
    }
    return null;
  }

  /**
   * Sign out - clear local session
   */
  async signOut() {
    localStorage.removeItem(SESSION_KEY);
    this._user = null;
    this._userRole = null;
    this._notifyAuthChange('SIGNED_OUT');
  }

  /**
   * Load user from database or create if first login
   */
  async _loadOrCreateUser() {
    if (!this._user) {
      this._userRole = null;
      return;
    }

    const { data, error } = await supabase
      .from('app_users')
      .select('role')
      .eq('discord_id', this._user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // User doesn't exist, create them
      const { data: newUser, error: insertError } = await supabase
        .from('app_users')
        .insert({
          discord_id: this._user.id,
          username: this._user.username,
          display_name: this._user.displayName,
          avatar_url: this._user.avatar,
          role: 'player'
        })
        .select('role')
        .single();

      if (insertError) {
        console.error('Failed to create user:', insertError);
      }

      this._userRole = newUser?.role || 'player';
      return;
    }

    this._userRole = data?.role || 'player';
  }

  /**
   * Register auth state change callback
   */
  onAuthStateChange(callback) {
    this._authCallbacks.push(callback);
    return { unsubscribe: () => {
      this._authCallbacks = this._authCallbacks.filter(cb => cb !== callback);
    }};
  }

  _notifyAuthChange(event) {
    this._authCallbacks.forEach(cb => cb(event, this._user));
  }

  // ============================================
  // USER INFO
  // ============================================

  getUser() {
    return this._user;
  }

  getDisplayName() {
    return this._user?.displayName || this._user?.username || null;
  }

  getAvatarUrl() {
    return this._user?.avatar || null;
  }

  getUserRole() {
    return this._userRole;
  }

  isAuthenticated() {
    return this._user !== null;
  }

  isAdmin() {
    return this._userRole === 'admin';
  }

  isPlayer() {
    return this._userRole === 'player' || this._userRole === 'admin';
  }

  hasAccess(requiredRole) {
    if (!this._userRole) return false;

    if (requiredRole === 'admin') {
      return this._userRole === 'admin';
    } else if (requiredRole === 'player') {
      return this._userRole === 'admin' || this._userRole === 'player';
    }

    return false;
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
      classicTicketUsed: p.classic_ticket_used || '',
      discordId: p.discord_id || null,
      accountNumber: p.account_number || null
    }));
  }

  /**
   * Check if current user can edit a player
   */
  canEditPlayer(player) {
    if (!this._user) return false;
    if (this.isAdmin()) return true;
    return player.discordId === this._user.id;
  }

  /**
   * Get all Discord users (for admin assignment dropdown)
   */
  async getAppUsers() {
    const { data, error } = await supabase
      .from('app_users')
      .select('discord_id, username, display_name, avatar_url, role')
      .order('display_name');

    if (error) {
      console.error('Error fetching app users:', error);
      return [];
    }

    return data.map(u => ({
      discordId: u.discord_id,
      username: u.username,
      displayName: u.display_name || u.username,
      avatarUrl: u.avatar_url,
      role: u.role
    }));
  }

  /**
   * Assign a character to a Discord user (admin only)
   */
  async assignCharacterOwner(playerId, discordId) {
    if (!this.isAdmin()) {
      throw new Error('Only admins can assign character owners');
    }

    const { error } = await supabase
      .from('players')
      .update({ discord_id: discordId })
      .eq('id', playerId);

    if (error) throw error;
    return { success: true };
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
        classic_ticket_used: player.classicTicketUsed || null,
        account_number: player.accountNumber || null
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
      armor_enhance: player.armorEnhance,
      account_number: player.accountNumber || null
    });

    if (player.id) {
      query = query.eq('id', player.id);
    } else {
      query = query.eq('name', oldName || player.name);
    }

    const { error } = await query;

    if (error) throw error;
    return { success: true };
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

  /**
   * Toggle a single player's raid completion status
   * @param {string} playerId - Player's UUID
   * @param {string} raidType - 'Hardcore' or 'Classic'
   * @param {boolean} completed - Whether to mark as completed or not
   */
  async togglePlayerRaidCompletion(playerId, raidType, completed) {
    const column = raidType === 'Hardcore' ? 'hardcore_completed' : 'classic_completed';
    const value = completed ? new Date().toISOString() : null;

    const { error } = await supabase
      .from('players')
      .update({ [column]: value })
      .eq('id', playerId);

    if (error) throw error;

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
