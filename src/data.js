/**
 * Supabase Data Service
 *
 * All data operations go through Supabase (PostgreSQL).
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
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
  // CONFIGURATION
  // ============================================

  isConfigured() {
    return !!supabaseUrl && !!supabaseAnonKey;
  }

  hasWriteAccess() {
    return this._user !== null;
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
      this._customDisplayName = null;
      return;
    }

    const { data, error } = await supabase
      .from('app_users')
      .select('role, display_name, avatar_url')
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
          role: 'guest'
        })
        .select('role, display_name')
        .single();

      if (insertError) {
        console.error('Failed to create user:', insertError);
      }

      this._userRole = newUser?.role || 'guest';
      this._customDisplayName = null; // New user, no custom name yet
      return;
    }

    this._userRole = data?.role || 'guest';
    // Store custom display name if it differs from Discord name
    this._customDisplayName = data?.display_name !== this._user.displayName ? data?.display_name : null;

    // Sync avatar: if session has no avatar but DB does, use DB value
    // (covers case where user set avatar on Discord and logged in from another device)
    if (!this._user.avatar && data?.avatar_url) {
      this._user.avatar = data.avatar_url;
      localStorage.setItem(SESSION_KEY, JSON.stringify(this._user));
    }

    // Update avatar and username in DB in case they changed on Discord
    await supabase
      .from('app_users')
      .update({
        username: this._user.username,
        avatar_url: this._user.avatar
      })
      .eq('discord_id', this._user.id);
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
    return this._customDisplayName || this._user?.displayName || this._user?.username || null;
  }

  getAvatarUrl() {
    return this._user?.avatar || null;
  }

  getUserRole() {
    return this._userRole;
  }

  /**
   * Update the user's display name
   */
  async updateDisplayName(newName) {
    if (!this._user) {
      throw new Error('Not logged in');
    }

    const trimmedName = newName?.trim();
    if (!trimmedName) {
      throw new Error('Display name cannot be empty');
    }

    const { error } = await supabase
      .from('app_users')
      .update({ display_name: trimmedName })
      .eq('discord_id', this._user.id);

    if (error) throw error;

    this._customDisplayName = trimmedName !== this._user.displayName ? trimmedName : null;
    return { success: true };
  }

  isAuthenticated() {
    return this._user !== null;
  }

  isAdmin() {
    return this._userRole === 'admin';
  }

  isPlayer() {
    return this._userRole === 'guildmate' || this._userRole === 'admin';
  }

  isGuest() {
    return this._userRole === 'guest';
  }

  hasAccess(requiredRole) {
    if (!this._userRole) return false;

    if (requiredRole === 'admin') {
      return this._userRole === 'admin';
    } else if (requiredRole === 'guildmate') {
      return this._userRole === 'admin' || this._userRole === 'guildmate';
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

    // Transform to match frontend format
    return data.map(p => {
      const equip = p.equipment || {};
      // Backward compat: derive old fields from new equipment jsonb
      const mainWeapon = equip.mainWeapon || {};
      const helmet = equip.helmet || {};

      return {
        id: p.id,
        name: p.name,
        role: p.role || '',
        notes: p.notes || '',
        // New equipment jsonb
        equipment: equip,
        characterStats: p.character_stats || {},
        // Legacy fields (derived from equipment for backward compat)
        weapon: mainWeapon.rarity || p.weapon || '',
        weaponEnhance: mainWeapon.enhancement != null ? String(mainWeapon.enhancement) : (p.weapon_enhance || ''),
        suffix1: p.suffix1 || '',
        suffix2: p.suffix2 || '',
        armor: helmet.rarity || p.armor || '',
        armorEnhance: helmet.enhancement != null ? String(helmet.enhancement) : (p.armor_enhance || ''),
        weaponLevel: p.weapon_level || '',
        armorLevel: p.armor_level || '',
        hardcoreCompleted: p.hardcore_completed || '',
        classicCompleted: p.classic_completed || '',
        classicTicketUsed: p.classic_ticket_used || '',
        discordId: p.discord_id || null,
        accountNumber: p.account_number || null
      };
    });
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
      .select('discord_id, username, display_name, avatar_url, role, created_at')
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
      role: u.role,
      createdAt: u.created_at
    }));
  }

  /**
   * Update a user's role (admin only)
   */
  async updateUserRole(discordId, newRole) {
    if (!this.isAdmin()) throw new Error('Only admins can update roles');

    const { error } = await supabase
      .from('app_users')
      .update({ role: newRole })
      .eq('discord_id', discordId);

    if (error) throw error;
    return { success: true };
  }

  /**
   * Delete a user from app_users (admin only)
   */
  async deleteAppUser(discordId) {
    if (!this.isAdmin()) throw new Error('Only admins can delete users');

    const { error } = await supabase
      .from('app_users')
      .delete()
      .eq('discord_id', discordId);

    if (error) throw error;
    return { success: true };
  }

  /**
   * Update any user's display name (admin only)
   */
  async adminUpdateDisplayName(discordId, newName) {
    if (!this.isAdmin()) throw new Error('Only admins can update other users');

    const { error } = await supabase
      .from('app_users')
      .update({ display_name: newName })
      .eq('discord_id', discordId);

    if (error) throw error;
    return { success: true };
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
    const insertData = {
      name: player.name,
      role: player.role,
      notes: player.notes,
      // Legacy fields (kept for backward compat)
      weapon: player.weapon || '',
      weapon_enhance: player.weaponEnhance || '',
      suffix1: player.suffix1 || '',
      suffix2: player.suffix2 || '',
      armor: player.armor || '',
      armor_enhance: player.armorEnhance || '',
      // New jsonb columns
      equipment: player.equipment || {},
      character_stats: player.characterStats || {},
      hardcore_completed: player.hardcoreCompleted || null,
      classic_completed: player.classicCompleted || null,
      classic_ticket_used: player.classicTicketUsed || null,
      account_number: player.accountNumber || null,
      // Auto-assign to the logged-in user
      discord_id: this._user?.id || null
    };

    const { data, error } = await supabase
      .from('players')
      .insert(insertData)
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
      // Legacy fields
      weapon: player.weapon || '',
      weapon_enhance: player.weaponEnhance || '',
      suffix1: player.suffix1 || '',
      suffix2: player.suffix2 || '',
      armor: player.armor || '',
      armor_enhance: player.armorEnhance || '',
      // New jsonb columns
      equipment: player.equipment || {},
      character_stats: player.characterStats || {},
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
        isNextWeek: lineup.is_template,
        notes: lineup.notes || '',
        raidTime: lineup.raid_time || null,
        players,
        ticketPlayers,
        pilotPlayers
      };
    });
  }

  async addLineup(lineup) {
    return this._saveLineup(lineup, false);
  }

  async updateLineup(lineup) {
    return this._saveLineup(lineup, true);
  }

  async _saveLineup(lineup, isUpdate) {
    let lineupId = lineup.id;

    const lineupData = {
      name: lineup.name,
      raid_type: lineup.raidType,
      status: lineup.status || 'draft',
      completed: lineup.completed || false,
      is_template: lineup.isNextWeek || false,
      notes: lineup.notes || '',
      raid_time: lineup.raidTime || null
    };

    let savedLineup, error;

    if (isUpdate && lineupId) {
      // Update existing lineup by ID
      ({ data: savedLineup, error } = await supabase
        .from('lineups')
        .update(lineupData)
        .eq('id', lineupId)
        .select()
        .single());
    } else {
      // Insert new lineup
      ({ data: savedLineup, error } = await supabase
        .from('lineups')
        .insert(lineupData)
        .select()
        .single());
    }

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

  async deleteLineup(lineupId) {
    const { error } = await supabase
      .from('lineups')
      .delete()
      .eq('id', lineupId);

    if (error) throw error;
    return { success: true };
  }

  async updateLineupRaidType(lineupId, raidType) {
    const { error } = await supabase
      .from('lineups')
      .update({ raid_type: raidType })
      .eq('id', lineupId);

    if (error) throw error;
    return { success: true };
  }

  async toggleLineupCompleted(lineupId) {
    // Get current state with full lineup data
    const { data: lineup } = await supabase
      .from('lineups')
      .select(`
        id, completed, raid_type,
        lineup_players (
          player_name,
          uses_ticket
        )
      `)
      .eq('id', lineupId)
      .single();

    if (!lineup) throw new Error('Lineup not found');

    const newCompleted = !lineup.completed;

    // Toggle lineup completed status
    const { error } = await supabase
      .from('lineups')
      .update({ completed: newCompleted })
      .eq('id', lineup.id);

    if (error) throw error;

    // Handle player completion based on lineup completion status
    // Skip for Unspecified raid type - can't mark HC/CL completion without knowing which
    if (lineup.raid_type !== 'Unspecified' && lineup.lineup_players && lineup.lineup_players.length > 0) {
      const playerNames = lineup.lineup_players
        .map(lp => lp.player_name)
        .filter(name => name && name.trim() !== '');

      const ticketPlayerNames = lineup.lineup_players
        .filter(lp => lp.uses_ticket && lp.player_name)
        .map(lp => lp.player_name);

      if (newCompleted) {
        // Mark all players as completed
        if (playerNames.length > 0) {
          await this.markPlayersCompleted(playerNames, lineup.raid_type, ticketPlayerNames);
        }
      } else {
        // When unclearing, only unmark non-ticket players
        // (non-ticket players can only be in one lineup per raid type)
        // Ticket players are left alone - they may have completed in another lineup
        const nonTicketPlayerNames = lineup.lineup_players
          .filter(lp => !lp.uses_ticket && lp.player_name && lp.player_name.trim() !== '')
          .map(lp => lp.player_name);

        if (nonTicketPlayerNames.length > 0) {
          await this.unmarkPlayersCompleted(nonTicketPlayerNames, lineup.raid_type, null, []);
        }
      }
    }

    return { success: true, completed: newCompleted };
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

  async getAppConfig(key) {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data?.value || null;
  }

  async setAppConfig(key, value) {
    const { error } = await supabase
      .from('app_config')
      .upsert({ key, value });

    if (error) throw error;
    return { success: true };
  }

  // ============================================
  // PERSONAL RAIDS
  // ============================================

  async getPersonalRaids() {
    if (!this._user) return [];

    const { data, error } = await supabase
      .from('personal_raids')
      .select('*')
      .eq('discord_id', this._user.id)
      .order('sort_order')
      .order('created_at');

    if (error) {
      console.error('Error fetching personal raids:', error);
      return [];
    }

    return data.map(r => ({
      id: r.id,
      discordId: r.discord_id,
      playerId: r.player_id,
      name: r.name,
      maxClears: r.max_clears,
      currentClears: r.current_clears,
      sortOrder: r.sort_order
    }));
  }

  async addPersonalRaid(playerId, name, maxClears = 1) {
    if (!this._user) throw new Error('Not logged in');

    const { data: existing } = await supabase
      .from('personal_raids')
      .select('sort_order')
      .eq('player_id', playerId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { data, error } = await supabase
      .from('personal_raids')
      .insert({
        discord_id: this._user.id,
        player_id: playerId,
        name,
        max_clears: maxClears,
        current_clears: 0,
        sort_order: nextOrder
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  }

  async updatePersonalRaid(raidId, updates) {
    if (!this._user) throw new Error('Not logged in');

    const updateData = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.maxClears !== undefined) updateData.max_clears = updates.maxClears;
    if (updates.currentClears !== undefined) updateData.current_clears = updates.currentClears;
    if (updates.sortOrder !== undefined) updateData.sort_order = updates.sortOrder;

    const { error } = await supabase
      .from('personal_raids')
      .update(updateData)
      .eq('id', raidId)
      .eq('discord_id', this._user.id);

    if (error) throw error;
    return { success: true };
  }

  async deletePersonalRaid(raidId) {
    if (!this._user) throw new Error('Not logged in');

    const { error } = await supabase
      .from('personal_raids')
      .delete()
      .eq('id', raidId)
      .eq('discord_id', this._user.id);

    if (error) throw error;
    return { success: true };
  }

  async incrementPersonalRaid(raidId) {
    const { data, error: fetchError } = await supabase
      .from('personal_raids')
      .select('current_clears, max_clears')
      .eq('id', raidId)
      .single();

    if (fetchError) throw fetchError;
    if (data.current_clears >= data.max_clears) {
      throw new Error('Already at max clears');
    }

    const { error } = await supabase
      .from('personal_raids')
      .update({ current_clears: data.current_clears + 1 })
      .eq('id', raidId);

    if (error) throw error;
    return { success: true, newClears: data.current_clears + 1 };
  }

  async decrementPersonalRaid(raidId) {
    const { data, error: fetchError } = await supabase
      .from('personal_raids')
      .select('current_clears')
      .eq('id', raidId)
      .single();

    if (fetchError) throw fetchError;
    if (data.current_clears <= 0) {
      throw new Error('Already at zero');
    }

    const { error } = await supabase
      .from('personal_raids')
      .update({ current_clears: data.current_clears - 1 })
      .eq('id', raidId);

    if (error) throw error;
    return { success: true, newClears: data.current_clears - 1 };
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

  // ============================================
  // PRESENCE (who's viewing)
  // ============================================

  /**
   * Join a presence channel for a page
   * @param {string} pageName - The page identifier (e.g., 'lineups', 'lineup-editor')
   * @param {Function} onPresenceChange - Callback when presence changes, receives array of users
   * @returns {Object} The channel subscription
   */
  joinPresence(pageName, onPresenceChange) {
    if (!this._user) {
      console.log('[Presence] No user logged in, skipping presence');
      return null;
    }

    console.log('[Presence] Joining channel:', pageName);

    const channel = supabase.channel(`presence:${pageName}`, {
      config: {
        presence: {
          key: this._user.id
        }
      }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log('[Presence] Sync event, state:', state);
        const users = Object.values(state).flat().map(p => ({
          id: p.user_id,
          name: p.user_name,
          avatar: p.user_avatar
        }));
        // Filter out current user from the count
        const otherUsers = users.filter(u => u.id !== this._user.id);
        console.log('[Presence] Other users:', otherUsers);
        onPresenceChange(otherUsers);
      })
      .subscribe(async (status) => {
        console.log('[Presence] Subscribe status:', status);
        if (status === 'SUBSCRIBED') {
          const trackResult = await channel.track({
            user_id: this._user.id,
            user_name: this.getDisplayName(),
            user_avatar: this.getAvatarUrl(),
            online_at: new Date().toISOString()
          });
          console.log('[Presence] Track result:', trackResult);
        }
      });

    return channel;
  }

  /**
   * Leave a presence channel
   * @param {Object} channel - The channel to leave
   */
  leavePresence(channel) {
    if (channel) {
      channel.untrack();
      supabase.removeChannel(channel);
    }
  }
}

export const dataService = new DataService();
