/**
 * Supabase Data Service
 *
 * All data operations go through Supabase (PostgreSQL).
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
 */

import { createClient } from '@supabase/supabase-js';
import { usesTickets } from './constants.js';
import { GAME_RAIDS, isThisGameWeek, markField, RAID_BY_TYPE, raidStatus } from './raid-clears.js';
import { guardClient, previewRole, previewDiscordId } from './dev-preview.js';
import { toast } from './toast.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

const supabase = guardClient(createClient(supabaseUrl || '', supabaseAnonKey || ''));

// Map a raid_type string to the players-table completion column it tracks.
// Returns null for raid types that don't track weekly completion.
function raidTypeToCompletionColumn(raidType) {
  return RAID_BY_TYPE[raidType]?.column || null;
}

const lootFromRow = (data) => ({
  id: data.id,
  item: data.item,
  sold: data.sold === true,
  price: Number(data.price) || 0,
  sortOrder: data.sort_order ?? 0,
  heldBy: data.held_by || '',
  source: data.source || 'web'
});

// Discord OAuth configuration
const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const SESSION_KEY = 'aftl_discord_user';
const SESSION_TOKEN_KEY = 'aftl_session';

class DataService {
  constructor() {
    this._user = null;
    this._userRole = null;
    this._authCallbacks = [];
    this._myAvailability = null;
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

    const { user, session } = await response.json();

    // Save user to localStorage
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    if (session) localStorage.setItem(SESSION_TOKEN_KEY, session);
    else localStorage.removeItem(SESSION_TOKEN_KEY);
    this._user = user;

    // Load or create user in database
    await this._loadOrCreateUser();

    // Notify listeners
    this._notifyAuthChange('SIGNED_IN');

    return user;
  }

  // The signed session from the last login, or null for sessions older than the feature.
  getSessionToken() {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  }

  // Saves go through the site-write function; the browser itself can only read.
  async _write(action, args = {}) {
    const response = await fetch('/.netlify/functions/site-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this.getSessionToken(), action, ...args }),
    });
    const result = await response.json().catch(() => ({}));
    // Sessions last 30 days; an expired one signs out so the page stops offering edits.
    if (response.status === 401 && this._user) {
      toast.error('Your login expired. Log in again to save changes.');
      await this.signOut();
    }
    if (!response.ok) throw new Error(result.error || 'Could not save');
    return result;
  }

  /**
   * Load existing session from localStorage
   */
  async loadSession() {
    if (previewRole && previewDiscordId) {
      // Local dev preview: your own account, the chosen role, no session token.
      this._user = { id: previewDiscordId, username: 'dev-preview', displayName: 'Dev preview', avatar: null };
      await this._loadOrCreateUser();
      this._userRole = previewRole;
      return this._user;
    }
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
    localStorage.removeItem(SESSION_TOKEN_KEY);
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
      this._myAvailability = null;
      return;
    }

    const { data, error } = await supabase
      .from('app_users')
      .select('role, display_name, avatar_url, available_from, log_off_time, availability_timezone, available_anytime')
      .eq('discord_id', this._user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // Not created yet (discord-auth creates users at login): treat as a new guest.
      this._userRole = 'guest';
      this._customDisplayName = null; // New user, no custom name yet
      this._myAvailability = { availableFrom: null, logOffTime: null, timezone: null, anytime: false };
      return;
    }

    this._userRole = data?.role || 'guest';
    // Store custom display name if it differs from Discord name
    this._customDisplayName = data?.display_name !== this._user.displayName ? data?.display_name : null;
    this._myAvailability = {
      availableFrom: data?.available_from || null,
      logOffTime: data?.log_off_time || null,
      timezone: data?.availability_timezone || null,
      anytime: data?.available_anytime === true
    };

    // The dev preview has no real Discord session to save or sync.
    if (previewRole) {
      this._user.avatar = data?.avatar_url || null;
      return;
    }

    // Sync avatar: if session has no avatar but DB does, use DB value
    // (covers case where user set avatar on Discord and logged in from another device).
    // discord-auth refreshes the stored username and avatar at each login.
    if (!this._user.avatar && data?.avatar_url) {
      this._user.avatar = data.avatar_url;
      localStorage.setItem(SESSION_KEY, JSON.stringify(this._user));
    }
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

    await this._write('user.updateSelf', { fields: { display_name: trimmedName } });

    this._customDisplayName = trimmedName !== this._user.displayName ? trimmedName : null;
    return { success: true };
  }

  getMyAvailability() {
    return this._myAvailability || { availableFrom: null, logOffTime: null, timezone: null, anytime: false };
  }

  /**
   * Update the user's daily availability window.
   * Pass null values to clear. `timezone` should be an IANA name (e.g. America/Los_Angeles).
   * `anytime: true` flags the user as having an open schedule.
   */
  async updateAvailability({ availableFrom, logOffTime, timezone, anytime }) {
    if (!this._user) throw new Error('Not logged in');

    const update = {
      available_from: availableFrom || null,
      log_off_time: logOffTime || null,
      availability_timezone: timezone || null,
      available_anytime: anytime === true
    };

    await this._write('user.updateSelf', { fields: update });

    this._myAvailability = {
      availableFrom: update.available_from,
      logOffTime: update.log_off_time,
      timezone: update.availability_timezone,
      anytime: update.available_anytime
    };
    return { success: true };
  }

  isAuthenticated() {
    return this._user !== null;
  }

  isAdmin() {
    return this._userRole === 'admin';
  }

  // Guild members: guildmate, editor or admin.
  isPlayer() {
    return this._userRole === 'guildmate' || this._userRole === 'admin' || this._userRole === 'editor';
  }

  // Raids with the guild: a part-time "friend" or any guild member.
  isFriend() {
    return this._userRole === 'friend' || this.isPlayer();
  }

  isGuest() {
    return this._userRole === 'guest';
  }

  // Can the current user create/edit/delete lineups in the lineup editor?
  // Admins plus the dedicated "editor" role.
  canEditLineups() {
    return this._userRole === 'admin' || this._userRole === 'editor';
  }

  hasAccess(requiredRole) {
    if (!this._userRole) return false;

    if (requiredRole === 'admin') {
      return this._userRole === 'admin';
    } else if (requiredRole === 'guildmate') {
      return this.isPlayer();
    } else if (requiredRole === 'friend') {
      return this.isFriend();
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
        // Synced from the meter (Afterlight Sync)
        build: p.build || null,
        panel: p.panel || null,
        syncedAt: p.synced_at || null,
        weeklyClears: p.weekly_clears || null,
        weeklyClearsAt: p.weekly_clears_at || null,
        raidMarks: p.raid_marks || {},
        handSetWins: !!p.overrides?.hand_set_wins,
        handStats: p.overrides?.hand_stats || null,
        // Legacy fields (derived from equipment for backward compat)
        weapon: mainWeapon.rarity || p.weapon || '',
        weaponEnhance: mainWeapon.enhancement != null ? String(mainWeapon.enhancement) : (p.weapon_enhance || ''),
        suffix1: p.suffix1 || '',
        suffix2: p.suffix2 || '',
        armor: helmet.rarity || p.armor || '',
        armorEnhance: helmet.enhancement != null ? String(helmet.enhancement) : (p.armor_enhance || ''),
        ddnHardcoreCompleted: p.ddn_hardcore_completed || '',
        ddnClassicCompleted: p.ddn_classic_completed || '',
        ddnNormalCompleted: p.ddn_normal_completed || '',
        bdnClassicCompleted: p.bdn_classic_completed || '',
        ...Object.fromEntries(GAME_RAIDS.filter((r) => r.column).map(({ column }) => [markField(column), p[column] || ''])),
        ticketsUsed: p.tickets_used || {},
        discordId: p.discord_id || null,
        accountNumber: p.account_number || null,
        accountName: p.account_name || '',
        groupId: p.group_id || null,
        sortOrder: p.sort_order ?? 0,
        exclude: p.exclude === true,
        excludeLabel: p.exclude_label || '',
        excludeReason: p.exclude_reason || '',
        whitelisted: p.whitelisted === true,
        whitelistIgnored: p.whitelist_ignored === true
      };
    });
  }

  // Characters of the logged-in user that the meter has synced (they carry a build).
  async getMySyncedCharacters() {
    if (!this._user) return [];
    const { data, error } = await supabase
      .from('players')
      .select('id, name, role, build, panel, synced_at, overrides')
      .eq('discord_id', this._user.id)
      .not('build', 'is', null)
      .order('synced_at', { ascending: false });
    if (error) {
      console.error('Error fetching synced characters:', error);
      return [];
    }
    return data;
  }

  // Save a synced character's hand-set fields (title, card mastery, collection, engravings, buffs).
  async saveCharacterOverrides(playerId, build, handSetWins) {
    const response = await fetch('/.netlify/functions/character-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this.getSessionToken(), player_id: playerId, build, hand_set_wins: handSetWins }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save to the character');
    return result;
  }

  // Empty a synced character's cards; the sync then ignores that same set until new cards arrive.
  async clearCharacterCards(playerId) {
    const response = await fetch('/.netlify/functions/character-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this.getSessionToken(), player_id: playerId, clear_cards: true }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not clear the cards');
    return result;
  }

  async getSavedBuilds() {
    if (!this._user) return [];
    const { data, error } = await supabase
      .from('saved_builds')
      .select('id, name, build, updated_at')
      .eq('discord_id', this._user.id)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('Error fetching saved builds:', error);
      return [];
    }
    return data;
  }

  async saveBuild(name, build, id = null) {
    if (!this._user) throw new Error('Log in first');
    return (await this._write('builds.save', { id, name, build })).data;
  }

  async deleteSavedBuild(id) {
    if (!this._user) throw new Error('Log in first');
    await this._write('builds.delete', { id });
  }

  // Guest characters, without custom_raids until supabase/guest-custom-raids.sql has run.
  async _selectGuestCharacters(columns, filter) {
    const query = (cols) => filter(supabase.from('guest_characters').select(cols)).order('sort_order');
    const result = await query(`${columns}, custom_raids`);
    return result.error?.code === '42703' ? query(columns) : result;
  }

  async getGuestCharacters() {
    if (!this._user) return [];
    const { data, error } = await this._selectGuestCharacters('id, name, marks, sort_order', (q) => q.eq('discord_id', this._user.id));
    if (error) throw error;
    return data;
  }

  async addGuestCharacter() {
    return (await this._write('guestChars.add')).data;
  }

  async renameGuestCharacter(id, name) {
    await this._write('guestChars.rename', { id, name });
  }

  async deleteGuestCharacter(id) {
    await this._write('guestChars.delete', { id });
  }

  async markGuestRaid(id, raidType, done) {
    return (await this._write('guestChars.mark', { id, raid_type: raidType, done })).marks;
  }

  async addGuestCustomRaid(id, name, maxClears) {
    return (await this._write('guestChars.addRaid', { id, name, max_clears: maxClears })).data;
  }

  async updateGuestCustomRaid(id, raidId, name, maxClears) {
    return (await this._write('guestChars.updateRaid', { id, raid_id: raidId, name, max_clears: maxClears })).data;
  }

  async stepGuestCustomRaid(id, raidId, delta) {
    return (await this._write('guestChars.stepRaid', { id, raid_id: raidId, delta })).data;
  }

  async removeGuestCustomRaid(id, raidId) {
    await this._write('guestChars.removeRaid', { id, raid_id: raidId });
  }

  // Admin view of what guest accounts keep: their saved builds and raid-tracker characters.
  async getGuestAccountData(discordIds) {
    if (!discordIds.length) return { builds: [], characters: [] };
    const [builds, characters] = await Promise.all([
      supabase.from('saved_builds').select('id, discord_id, name, build, updated_at').in('discord_id', discordIds).order('updated_at', { ascending: false }),
      this._selectGuestCharacters('id, discord_id, name, marks, sort_order', (q) => q.in('discord_id', discordIds)),
    ]);
    if (builds.error) throw builds.error;
    if (characters.error) console.error('Error fetching guest characters:', characters.error);
    return { builds: builds.data, characters: characters.data || [] };
  }

  async adminDeleteSavedBuild(id) {
    await this._write('admin.deleteSavedBuild', { id });
  }

  async adminDeleteGuestCharacter(id) {
    await this._write('admin.deleteGuestCharacter', { id });
  }

  /**
   * Canonical "is this character allowed to use guild-only features?" check.
   * Currently gates the card collection; designed to gate more later.
   * A character must be both whitelisted (in our guild) AND not excluded.
   */
  isPlayerWhitelisted(player) {
    return !!player && player.exclude !== true && player.whitelisted === true;
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
   * Strict ownership check — does NOT grant admins permission.
   * Use this for character-personal data the owner alone should curate
   * (e.g., the extras list on the Characters page).
   */
  isPlayerOwner(player) {
    if (!this._user || !player) return false;
    return player.discordId === this._user.id;
  }

  /**
   * Get all Discord users (for admin assignment dropdown)
   */
  async getAppUsers() {
    const { data, error } = await supabase
      .from('app_users')
      .select('discord_id, username, display_name, avatar_url, role, exclude, exclude_label, exclude_reason, created_at, available_from, log_off_time, availability_timezone, available_anytime')
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
      exclude: u.exclude === true,
      excludeLabel: u.exclude_label || '',
      excludeReason: u.exclude_reason || '',
      createdAt: u.created_at,
      availableFrom: u.available_from || null,
      logOffTime: u.log_off_time || null,
      availabilityTimezone: u.availability_timezone || null,
      availableAnytime: u.available_anytime === true
    }));
  }

  /**
   * Toggle exclude flag on a user (admin only)
   */
  async updateUserExclude(discordId, exclude, { label, reason } = {}) {
    if (!this.isAdmin()) throw new Error('Only admins can update user exclude flag');

    const fields = { exclude: !!exclude };
    if (label !== undefined) fields.exclude_label = label?.trim() || null;
    if (reason !== undefined) fields.exclude_reason = reason?.trim() || null;
    await this._write('admin.updateUser', { discord_id: discordId, fields });
    return { success: true };
  }

  /**
   * Update a user's role (admin only)
   */
  async updateUserRole(discordId, newRole) {
    if (!this.isAdmin()) throw new Error('Only admins can update roles');
    await this._write('admin.updateUser', { discord_id: discordId, fields: { role: newRole } });
    return { success: true };
  }

  // What deleting a user would remove: counts per kind and the lineups that lose a slot.
  async previewUserDelete(discordId) {
    const response = await fetch(`/.netlify/functions/admin-delete-user?discord_id=${encodeURIComponent(discordId)}`, {
      headers: { 'X-Session': this.getSessionToken() || '' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not check what would be deleted');
    return result;
  }

  // Gearscore reference builds, choices and assumptions (admin only, server-side).
  async getAdminReferences() {
    const response = await fetch('/.netlify/functions/admin-reference', {
      headers: { 'X-Session': this.getSessionToken() || '' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not load the references');
    return result;
  }

  // Delete a user with their characters, cards, raids, lists and lineup slots (admin only, server-side).
  async deleteAppUser(discordId) {
    if (!this.isAdmin()) throw new Error('Only admins can delete users');
    const response = await fetch('/.netlify/functions/admin-delete-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: this.getSessionToken(), discord_id: discordId, confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not delete the user');
    return result;
  }

  /**
   * Update any user's display name (admin only)
   */
  async adminUpdateDisplayName(discordId, newName) {
    if (!this.isAdmin()) throw new Error('Only admins can update other users');
    await this._write('admin.updateUser', { discord_id: discordId, fields: { display_name: newName } });
    return { success: true };
  }

  /**
   * Assign a character to a Discord user (admin only)
   */
  async assignCharacterOwner(playerId, discordId) {
    if (!this.isAdmin()) {
      throw new Error('Only admins can assign character owners');
    }
    await this._write('player.adminFlags', { id: playerId, fields: { discord_id: discordId } });
    return { success: true };
  }

  async addPlayer(player) {
    const fields = {
      name: player.name || '',
      role: player.role || '',
      notes: player.notes || '',
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
      ddn_hardcore_completed: player.ddnHardcoreCompleted || null,
      ddn_classic_completed: player.ddnClassicCompleted || null,
      ddn_normal_completed: player.ddnNormalCompleted || null,
      bdn_classic_completed: player.bdnClassicCompleted || null,
      account_number: player.accountNumber || null,
      exclude: player.exclude === true,
      exclude_label: player.excludeLabel?.trim() || null,
      exclude_reason: player.excludeReason?.trim() || null
    };
    // The server makes the logged-in user the owner; a build from the simulator window sets gear and stats.
    const { data } = await this._write('player.add', { fields, build: player.build, hand_stats: player.handStats });
    return { success: true, data };
  }

  async updatePlayer(player) {
    // The server keeps class, gear and stats of a synced character.
    const fields = {
      name: player.name || '',
      notes: player.notes || '',
      account_number: player.accountNumber || null,
      exclude: player.exclude === true,
      exclude_label: player.excludeLabel?.trim() || null,
      exclude_reason: player.excludeReason?.trim() || null,
      role: player.role || '',
      // Legacy fields
      weapon: player.weapon || '',
      weapon_enhance: player.weaponEnhance || '',
      suffix1: player.suffix1 || '',
      suffix2: player.suffix2 || '',
      armor: player.armor || '',
      armor_enhance: player.armorEnhance || '',
      // New jsonb columns
      equipment: player.equipment || {},
      character_stats: player.characterStats || {}
    };
    await this._write('player.update', { id: player.id, fields, build: player.build, hand_stats: player.handStats });
    return { success: true };
  }

  async togglePlayerExclude(playerId, exclude) {
    if (!this.isAdmin()) throw new Error('Only admins can toggle exclude');
    await this._write('player.adminFlags', { id: playerId, fields: { exclude: !!exclude } });
    return { success: true };
  }

  async togglePlayerWhitelist(playerId, whitelisted) {
    if (!this.isAdmin()) throw new Error('Only admins can toggle whitelist');
    await this._write('player.adminFlags', { id: playerId, fields: { whitelisted: !!whitelisted } });
    return { success: true };
  }

  // Dismiss a character from the admin "New Characters" review queue without
  // whitelisting or excluding it — just clears it from the list.
  async dismissPlayerReview(playerId) {
    if (!this.isAdmin()) throw new Error('Only admins can dismiss reviews');
    await this._write('player.adminFlags', { id: playerId, fields: { whitelist_ignored: true } });
    return { success: true };
  }

  async deletePlayer(playerId) {
    await this._write('player.delete', { id: playerId });
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
        ),
        lineup_loot (
          id,
          item,
          sold,
          price,
          sort_order,
          held_by,
          source
        )
      `)
      .order('name');

    if (error) {
      console.error('Error fetching lineups:', error);
      return [];
    }

    // Transform to match old format
    const result = data.map(lineup => {
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

      const loot = (lineup.lineup_loot || [])
        .map(l => ({
          id: l.id,
          item: l.item,
          sold: l.sold === true,
          price: Number(l.price) || 0,
          sortOrder: l.sort_order ?? 0,
          heldBy: l.held_by || '',
          source: l.source || 'web'
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        id: lineup.id,
        name: lineup.name,
        raidType: lineup.raid_type,
        status: lineup.status,
        completed: lineup.completed,
        isNextWeek: lineup.is_template,
        isStatic: lineup.is_static || false,
        notes: lineup.notes || '',
        raidTime: lineup.raid_time || null,
        clearedAt: lineup.cleared_at || null,
        threadId: lineup.thread_id || null,
        players,
        ticketPlayers,
        pilotPlayers,
        loot,
        payouts: []
      };
    });

    // Attach gold-share payouts via a SEPARATE query (not a nested embed) so a
    // missing lineup_payouts table (before the migration is applied) degrades to
    // empty payouts instead of erroring the whole lineups fetch.
    const { data: payoutRows, error: payoutErr } = await supabase
      .from('lineup_payouts')
      .select('lineup_id, member_name, discord_id, source, amount');
    if (!payoutErr && payoutRows) {
      const byLineup = new Map();
      for (const p of payoutRows) {
        if (!byLineup.has(p.lineup_id)) byLineup.set(p.lineup_id, []);
        byLineup.get(p.lineup_id).push({
          memberName: p.member_name,
          discordId: p.discord_id || null,
          source: p.source || 'web',
          amount: Number(p.amount) || 0
        });
      }
      for (const l of result) l.payouts = byLineup.get(l.id) || [];
    }

    return result;
  }

  async addLineup(lineup) {
    return this._saveLineup(lineup, false);
  }

  async updateLineup(lineup) {
    return this._saveLineup(lineup, true);
  }

  async _saveLineup(lineup, isUpdate) {
    const fields = {
      name: lineup.name,
      raid_type: lineup.raidType,
      status: lineup.status || 'draft',
      completed: lineup.completed || false,
      is_template: lineup.isNextWeek || false,
      is_static: lineup.isStatic || false,
      notes: lineup.notes || '',
      raid_time: lineup.raidTime || null
    };
    const slots = (lineup.players || []).map((name, idx) => name ? {
      player_name: name,
      slot_position: idx + 1,
      uses_ticket: lineup.ticketPlayers?.[idx] || false,
      pilot_name: lineup.pilotPlayers?.[idx] || null
    } : null).filter(Boolean);
    const { data } = await this._write('lineups.save', { id: isUpdate ? lineup.id : null, fields, slots });
    return { success: true, data };
  }

  async deleteLineup(lineupId) {
    await this._write('lineups.delete', { id: lineupId });
    return { success: true };
  }

  async updateLineupRaidType(lineupId, raidType) {
    await this._write('lineups.update', { id: lineupId, fields: { raid_type: raidType } });
    return { success: true };
  }

  // The server flips the lineup and marks its members (and ticket runs) to match.
  async toggleLineupCompleted(lineupId) {
    const { completed } = await this._write('lineups.toggleCompleted', { id: lineupId });
    return { success: true, completed };
  }

  /**
   * Set a lineup's "Next Week" flag (is_template) — a lightweight single-column
   * update used by the "Keep for next week" toggle on cleared cards. A kept
   * lineup survives the weekly cleanup; its cleared status is reset then so it's
   * runnable again next week (see weekly-cleanup-cron.sql).
   */
  async setLineupNextWeek(lineupId, value) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to edit lineups');
    if (!lineupId) throw new Error('lineupId is required');
    await this._write('lineups.update', { id: lineupId, fields: { is_template: !!value } });
    return { success: true, isNextWeek: !!value };
  }

  // ============================================
  // LINEUP LOOT (per-lineup item + gold log)
  // ============================================

  /**
   * Fetch the loot entries for a single lineup, sorted by sort_order.
   * Returns [] on error. (getLineups already embeds loot for the page;
   * this is for targeted refreshes.)
   */
  async getLineupLoot(lineupId) {
    if (!lineupId) return [];

    const { data, error } = await supabase
      .from('lineup_loot')
      .select('id, item, sold, price, sort_order, held_by, source')
      .eq('lineup_id', lineupId)
      .order('sort_order');

    if (error) {
      console.error('Error fetching lineup loot:', error);
      return [];
    }

    return data.map(l => ({
      id: l.id,
      item: l.item,
      sold: l.sold === true,
      price: Number(l.price) || 0,
      sortOrder: l.sort_order ?? 0,
      heldBy: l.held_by || '',
      source: l.source || 'web'
    }));
  }

  // New loot starts unsold (no gold yet); price is set later when it sells.
  // `parent` is { lineupId } for a live lineup or { recordId } for an archived
  // loot record (see loot-records.sql). Exactly one is set.
  async _insertLoot(parent, item, heldBy = '') {
    if (!this.canEditLineups()) throw new Error('You do not have permission to edit loot');
    const parentId = parent.recordId || parent.lineupId;
    if (!parentId) throw new Error('a lineupId or recordId is required');
    const trimmed = (item || '').trim();
    if (!trimmed) throw new Error('Item name cannot be empty');
    const { data } = await this._write('loot.add', {
      lineup_id: parent.lineupId || null, record_id: parent.recordId || null, item: trimmed, held_by: heldBy
    });
    return lootFromRow(data);
  }

  async addLineupLoot(lineupId, item, heldBy = '') {
    if (!lineupId) throw new Error('lineupId is required');
    return this._insertLoot({ lineupId }, item, heldBy);
  }

  // Add an item to an archived loot record (Loot Log page).
  async addLootRecordItem(recordId, item, heldBy = '') {
    if (!recordId) throw new Error('recordId is required');
    return this._insertLoot({ recordId }, item, heldBy);
  }

  async updateLineupLoot(lootId, updates) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to edit loot');
    if (!lootId) throw new Error('lootId is required');

    const fields = {};
    if (updates.item !== undefined) {
      const trimmed = (updates.item || '').trim();
      if (!trimmed) throw new Error('Item name cannot be empty');
      fields.item = trimmed;
    }
    if (updates.sold !== undefined) {
      fields.sold = !!updates.sold;
      // Reverting to unsold clears the price unless one is explicitly provided
      if (!updates.sold && updates.price === undefined) fields.price = 0;
    }
    if (updates.price !== undefined) fields.price = updates.price;
    if (updates.heldBy !== undefined) fields.held_by = (updates.heldBy || '').trim() || null;
    if (updates.sortOrder !== undefined) fields.sort_order = updates.sortOrder;
    await this._write('loot.update', { id: lootId, fields });
    return { success: true };
  }

  async deleteLineupLoot(lootId) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to edit loot');
    if (!lootId) throw new Error('lootId is required');
    await this._write('loot.delete', { id: lootId });
    return { success: true };
  }

  // ============================================
  // LINEUP PAYOUTS (who's received their gold share)
  // ============================================

  /**
   * Fetch which party members have confirmed receiving their gold share, for a
   * single lineup. Returns [{ memberName, discordId, source }]. [] on error.
   */
  async getLineupPayouts(lineupId) {
    if (!lineupId) return [];

    const { data, error } = await supabase
      .from('lineup_payouts')
      .select('member_name, discord_id, source, amount')
      .eq('lineup_id', lineupId);

    if (error) {
      console.error('Error fetching lineup payouts:', error);
      return [];
    }

    return (data || []).map(p => ({
      memberName: p.member_name,
      discordId: p.discord_id || null,
      source: p.source || 'web',
      amount: Number(p.amount) || 0
    }));
  }

  // `parent` is { lineupId } for a live lineup or { recordId } for an archived loot record.
  // The server checks the caller owns or piloted the member, or is an editor.
  async _markShare(parent, memberName, ownerDiscordId = null, amount = 0) {
    if (!(parent.recordId || parent.lineupId) || !memberName) throw new Error('a lineupId or recordId and memberName are required');
    await this._write('payouts.mark', { lineup_id: parent.lineupId || null, record_id: parent.recordId || null, member_name: memberName, amount });
    return { success: true };
  }

  async _unmarkShare(parent, memberName, ownerDiscordId = null) {
    if (!(parent.recordId || parent.lineupId) || !memberName) throw new Error('a lineupId or recordId and memberName are required');
    await this._write('payouts.unmark', { lineup_id: parent.lineupId || null, record_id: parent.recordId || null, member_name: memberName });
    return { success: true };
  }

  async markShareReceived(lineupId, memberName, ownerDiscordId = null, amount = 0) {
    return this._markShare({ lineupId }, memberName, ownerDiscordId, amount);
  }

  async unmarkShareReceived(lineupId, memberName, ownerDiscordId = null) {
    return this._unmarkShare({ lineupId }, memberName, ownerDiscordId);
  }

  // Loot Log (archived record) variants.
  async markRecordShareReceived(recordId, memberName, ownerDiscordId = null, amount = 0) {
    return this._markShare({ recordId }, memberName, ownerDiscordId, amount);
  }

  async unmarkRecordShareReceived(recordId, memberName, ownerDiscordId = null) {
    return this._unmarkShare({ recordId }, memberName, ownerDiscordId);
  }

  // ============================================
  // LOOT RECORDS (persistent loot that outlives its lineup — /loot-log page)
  // ============================================

  /**
   * Archive a lineup's loot into a standalone loot record and delete the lineup
   * (freeing its members for new teams). The loot + payout rows are moved onto the
   * record so they survive. Atomic (Postgres fn). Returns the new record id.
   */
  async archiveLineupLoot(lineupId) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to archive loot');
    if (!lineupId) throw new Error('lineupId is required');
    return (await this._write('records.archive', { lineup_id: lineupId })).id; // new loot_records.id
  }

  /**
   * Fetch all loot records (newest first), each shaped like a lineup so the loot
   * UI helpers work: `players`/`roster` = frozen member names, plus `loot` and
   * `payouts` arrays. Payouts come via a SEPARATE query so a pre-migration DB
   * degrades to empty instead of erroring. Returns [] on error.
   */
  async getLootRecords() {
    const { data, error } = await supabase
      .from('loot_records')
      .select(`
        id, lineup_name, raid_type, roster, pilots, raid_time, cleared_at,
        loot_thread_id, loot_message_id, payout_message_id, loot_close_at, loot_closed,
        lineup_loot ( id, item, sold, price, sort_order, held_by, source )
      `)
      .order('cleared_at', { ascending: false });

    if (error) {
      console.error('Error fetching loot records:', error);
      return [];
    }

    const result = (data || []).map(r => {
      const roster = Array.isArray(r.roster) ? r.roster : [];
      const loot = (r.lineup_loot || [])
        .map(l => ({
          id: l.id,
          item: l.item,
          sold: l.sold === true,
          price: Number(l.price) || 0,
          sortOrder: l.sort_order ?? 0,
          heldBy: l.held_by || '',
          source: l.source || 'web'
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        id: r.id,
        name: r.lineup_name,
        raidType: r.raid_type,
        roster,
        players: roster,             // loot helpers read `players` for the roster
        pilots: (r.pilots && typeof r.pilots === 'object') ? r.pilots : {}, // member name → pilot name
        raidTime: r.raid_time || null,
        clearedAt: r.cleared_at || null,
        threadId: r.loot_thread_id || null,
        lootClosed: r.loot_closed === true,
        loot,
        payouts: [],
        isRecord: true
      };
    });

    // Attach payouts via a separate query (degrade-safe), keyed by record_id.
    const { data: payoutRows, error: payoutErr } = await supabase
      .from('lineup_payouts')
      .select('record_id, member_name, discord_id, source, amount')
      .not('record_id', 'is', null);
    if (!payoutErr && payoutRows) {
      const byRecord = new Map();
      for (const p of payoutRows) {
        if (!byRecord.has(p.record_id)) byRecord.set(p.record_id, []);
        byRecord.get(p.record_id).push({
          memberName: p.member_name,
          discordId: p.discord_id || null,
          source: p.source || 'web',
          amount: Number(p.amount) || 0
        });
      }
      for (const rec of result) rec.payouts = byRecord.get(rec.id) || [];
    }

    return result;
  }

  /**
   * Permanently delete a loot record and its loot + payout rows (ON DELETE CASCADE).
   */
  async deleteLootRecord(recordId) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to delete loot records');
    if (!recordId) throw new Error('recordId is required');
    await this._write('records.delete', { id: recordId });
    return { success: true };
  }

  /**
   * Subscribe to loot_records changes (e.g. bot marks a thread closed). Loot-row
   * and payout-row changes on records also fire via subscribeToLineupLoot /
   * subscribeToLineupPayouts (those listen table-wide).
   */
  subscribeToLootRecords(callback) {
    const subscription = supabase
      .channel('loot-records-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loot_records' }, callback)
      .subscribe();
    return subscription;
  }

  // ============================================
  // COMPLETION TRACKING
  // ============================================

  // Marks count from the game's weekly reset (Saturday 09:00 SEA), the same week as the synced clears.
  isCompletedThisWeek(timestamp) {
    return isThisGameWeek(timestamp);
  }

  // Raids with no weekly tracking (4-man, Unspecified, retired types) are always needed.
  playerNeedsRaid(player, raidType) {
    return !raidStatus(player, raidType).done;
  }

  playerTicketUsed(player, raidType) {
    if (!usesTickets(raidType)) return false;
    return this.isCompletedThisWeek(player.ticketsUsed?.[raidType]);
  }

  // Sets or clears one raid's entry in players.tickets_used (see add-classic-tickets.sql).
  async setTicketsUsed(playerNames, raidType, used) {
    if (!usesTickets(raidType) || playerNames.length === 0) return;
    await this._write('players.ticketUsed', { names: playerNames, raid: raidType, used });
  }

  async markPlayersCompleted(playerNames, raidType, ticketPlayerNames = []) {
    const column = raidTypeToCompletionColumn(raidType);
    if (!column) return { success: true };
    await this._write('players.lineupCompletion', { names: playerNames, column, completed: true });
    await this.setTicketsUsed(ticketPlayerNames, raidType, true);
    return { success: true };
  }

  async unmarkPlayersCompleted(playerNames, raidType, excludeLineupName, ticketPlayerNames = []) {
    const column = raidTypeToCompletionColumn(raidType);
    if (!column) return { success: true };
    await this._write('players.lineupCompletion', { names: playerNames, column, completed: false });
    await this.setTicketsUsed(ticketPlayerNames, raidType, false);
    return { success: true };
  }

  /**
   * Toggle a single player's raid completion status
   * @param {string} playerId - Player's UUID
   * @param {string} raidType - e.g. 'BDN Classic', 'DDN Hardcore'
   * @param {boolean} completed - Whether to mark as completed or not
   */
  // A raid, stage ("BDN Memoria#II") or synced stage raid ("stage-14600") marked by hand on My Characters.
  async setPlayerRaidMark(playerId, key, done) {
    await this._write('player.raidMark', { id: playerId, key, done: !!done });
  }

  async togglePlayerRaidCompletion(playerId, raidType, completed) {
    const column = raidTypeToCompletionColumn(raidType);
    if (!column) return { success: true };
    await this._write('player.raidCompletion', { id: playerId, column, completed: !!completed });
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
    await this._write('config.set', { key: 'spending_config', value: config });
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
    await this._write('config.set', { key, value });
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

  // Everyone's personal raids, for the guild-wide tracker (the table is public read).
  async getAllPersonalRaids() {
    const rows = await this._fetchAllRows('personal_raids', 'player_id,sort_order,id');
    return rows.map(r => ({
      id: r.id,
      discordId: r.discord_id,
      playerId: r.player_id,
      name: r.name,
      maxClears: r.max_clears,
      currentClears: r.current_clears
    }));
  }

  async addPersonalRaid(playerId, name, maxClears = 1) {
    if (!this._user) throw new Error('Not logged in');
    const { data } = await this._write('raids.add', { player_id: playerId, name, max_clears: maxClears });
    return { success: true, data };
  }

  async updatePersonalRaid(raidId, updates) {
    if (!this._user) throw new Error('Not logged in');

    const fields = {};
    if (updates.name !== undefined) fields.name = updates.name;
    if (updates.maxClears !== undefined) fields.max_clears = updates.maxClears;
    if (updates.currentClears !== undefined) fields.current_clears = updates.currentClears;
    if (updates.sortOrder !== undefined) fields.sort_order = updates.sortOrder;
    await this._write('raids.update', { id: raidId, fields });
    return { success: true };
  }

  async deletePersonalRaid(raidId) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('raids.delete', { id: raidId });
    return { success: true };
  }

  async incrementPersonalRaid(raidId) {
    const { newClears } = await this._write('raids.step', { id: raidId, delta: 1 });
    return { success: true, newClears };
  }

  async decrementPersonalRaid(raidId) {
    const { newClears } = await this._write('raids.step', { id: raidId, delta: -1 });
    return { success: true, newClears };
  }

  // ============================================
  // CHARACTER GROUPS (per-user, per-account folders)
  // ============================================

  async getCharacterGroups() {
    if (!this._user) return [];

    const { data, error } = await supabase
      .from('character_groups')
      .select('*')
      .eq('discord_id', this._user.id)
      .order('account_number')
      .order('sort_order')
      .order('created_at');

    if (error) {
      console.error('Error fetching character groups:', error);
      return [];
    }

    return data.map(g => ({
      id: g.id,
      discordId: g.discord_id,
      accountNumber: g.account_number || 1,
      name: g.name,
      sortOrder: g.sort_order
    }));
  }

  async addCharacterGroup(accountNumber, name) {
    if (!this._user) throw new Error('Not logged in');
    const { data } = await this._write('groups.add', { account_number: accountNumber, name });
    return {
      id: data.id,
      discordId: data.discord_id,
      accountNumber: data.account_number || 1,
      name: data.name,
      sortOrder: data.sort_order
    };
  }

  async renameCharacterGroup(groupId, name) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('groups.rename', { id: groupId, name });
    return { success: true };
  }

  async deleteCharacterGroup(groupId) {
    if (!this._user) throw new Error('Not logged in');
    // Members' group_id is cleared automatically (ON DELETE SET NULL).
    await this._write('groups.delete', { id: groupId });
    return { success: true };
  }

  async reorderCharacterGroups(orderedGroupIds) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('groups.reorder', { ids: orderedGroupIds });
    return { success: true };
  }

  async setCharacterGroup(playerId, groupId) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('player.setGroup', { id: playerId, group_id: groupId });
    return { success: true };
  }

  /**
   * Persist a whole bucket's order after a drag/move.
   * entries: [{ id, groupId, sortOrder }] — groupId may be null (ungrouped).
   */
  async saveCharacterOrder(entries) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('player.saveOrder', { entries: entries.map(e => ({ id: e.id, group_id: e.groupId ?? null, sort_order: e.sortOrder })) });
    return { success: true };
  }

  // ============================================
  // SHOPPING LIST (per-character want list)
  // ============================================

  async getShoppingList() {
    if (!this._user) return [];

    const { data, error } = await supabase
      .from('shopping_list')
      .select('*')
      .eq('discord_id', this._user.id)
      .order('sort_order')
      .order('created_at');

    if (error) {
      console.error('Error fetching shopping list:', error);
      return [];
    }

    return data.map(i => ({
      id: i.id,
      discordId: i.discord_id,
      playerId: i.player_id,
      item: i.item,
      bought: i.bought,
      price: Number(i.price) || 0,
      sortOrder: i.sort_order
    }));
  }

  async addShoppingItem(playerId, item, price = 0) {
    if (!this._user) throw new Error('Not logged in');
    const { data } = await this._write('shopping.add', { player_id: playerId, item, price });
    return { success: true, data };
  }

  async updateShoppingItem(itemId, updates) {
    if (!this._user) throw new Error('Not logged in');

    const fields = {};
    if (updates.item !== undefined) fields.item = updates.item;
    if (updates.bought !== undefined) fields.bought = updates.bought;
    if (updates.price !== undefined) fields.price = Number(updates.price) || 0;
    if (updates.sortOrder !== undefined) fields.sort_order = updates.sortOrder;
    await this._write('shopping.update', { id: itemId, fields });
    return { success: true };
  }

  async deleteShoppingItem(itemId) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('shopping.delete', { id: itemId });
    return { success: true };
  }

  // ============================================
  // PLAYER CARDS (monster card collection)
  // ============================================

  /**
   * Select every row of a table, paging past PostgREST's 1000-row response cap.
   * A stable sort is required or ranges can skip/repeat rows between requests.
   *
   * @param {string} table
   * @param {string} orderBy - comma-separated columns forming a unique-enough sort
   * @param {(query: any) => any} [applyFilters]
   */
  async _fetchAllRows(table, orderBy, applyFilters = q => q) {
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50; // runaway guard; 50k rows is far past anything here
    const columns = orderBy.split(',').map(c => c.trim()).filter(Boolean);
    const all = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = applyFilters(supabase.from(table).select('*'));
      columns.forEach(col => { query = query.order(col, { ascending: true }); });

      const { data, error } = await query.range(all.length, all.length + PAGE_SIZE - 1);
      if (error) {
        console.error(`Error fetching ${table}:`, error);
        return all;
      }

      // Advance by what actually came back, so a server cap below PAGE_SIZE
      // still pages through instead of stopping short.
      if (!data?.length) return all;
      all.push(...data);
    }

    console.warn(`_fetchAllRows(${table}) hit the page guard — results may be incomplete`);
    return all;
  }

  /**
   * @param {string|string[]|null} playerId - one id, a list of ids, or null for every character.
   *
   * PostgREST caps a single response at 1000 rows (db-max-rows) and truncates
   * SILENTLY, so an unfiltered fetch used to drop the newest rows — which read
   * as "the last card page won't save". Always paged; never a bare select.
   */
  async getPlayerCards(playerId = null) {
    const rows = await this._fetchAllRows('player_cards', 'player_id,slot_index', q => {
      if (Array.isArray(playerId)) return q.in('player_id', playerId);
      if (playerId) return q.eq('player_id', playerId);
      return q;
    });

    return rows.map(c => ({
      id: c.id,
      playerId: c.player_id,
      slotIndex: c.slot_index,
      rarity: c.rarity
    }));
  }

  async setPlayerCard(playerId, slotIndex, rarity) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('cards.set', { player_id: playerId, entries: [{ slot_index: slotIndex, rarity: rarity || null }] });
    return { success: true };
  }

  async removePlayerCard(playerId, slotIndex) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('cards.set', { player_id: playerId, entries: [{ slot_index: slotIndex, rarity: null }] });
    return { success: true };
  }

  async bulkSetPlayerCards(playerId, entries) {
    if (!this._user) throw new Error('Not logged in');
    if (!entries?.length) return { success: true };
    await this._write('cards.set', { player_id: playerId, entries: entries.map(e => ({ slot_index: e.slotIndex, rarity: e.rarity || null })) });
    return { success: true };
  }

  // ============================================
  // PLAYER EXTRA CARDS (duplicates / stash, by name+rarity+amount)
  // ============================================

  /** @param {string|string[]|null} playerId - see getPlayerCards; same 1000-row paging. */
  async getExtraCards(playerId = null) {
    const rows = await this._fetchAllRows('player_extra_cards', 'player_id,card_name,rarity', q => {
      if (Array.isArray(playerId)) return q.in('player_id', playerId);
      if (playerId) return q.eq('player_id', playerId);
      return q;
    });

    return (rows || []).map(e => ({
      id: e.id,
      playerId: e.player_id,
      cardName: e.card_name,
      rarity: e.rarity,
      amount: e.amount,
    }));
  }

  /**
   * Adds (or increments) an extra-card entry. If (player, name, rarity) already
   * exists, the amount is added on top of the existing row's amount.
   */
  async addExtraCard(playerId, cardName, rarity, amount = 1) {
    if (!this._user) throw new Error('Not logged in');
    if (!playerId || !cardName || !rarity) throw new Error('Missing fields');
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Amount must be at least 1');
    const { id, amount: total } = await this._write('extras.add', { player_id: playerId, card_name: cardName, rarity, amount });
    return { success: true, id, amount: total };
  }

  async setExtraCardAmount(extraId, amount) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('extras.setAmount', { id: extraId, amount });
    return { success: true };
  }

  async removeExtraCard(extraId) {
    if (!this._user) throw new Error('Not logged in');
    await this._write('extras.setAmount', { id: extraId, amount: 0 });
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

  /**
   * Subscribe to lineup_loot changes (loot logged from the site or the Discord
   * bot). Payload's new/old row carries `lineup_id`. Requires the lineup_loot
   * table to be in the supabase_realtime publication (it is, via lineup-loot.sql).
   */
  subscribeToLineupLoot(callback) {
    return supabase
      .channel('lineup-loot-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineup_loot' }, callback)
      .subscribe();
  }

  /**
   * Subscribe to lineup_payouts changes (gold shares marked received on the site
   * or via a Discord ✅ reaction). Payload's new/old row carries `lineup_id`.
   * Requires lineup_payouts in the supabase_realtime publication (lineup-payouts.sql).
   */
  subscribeToLineupPayouts(callback) {
    return supabase
      .channel('lineup-payouts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lineup_payouts' }, callback)
      .subscribe();
  }

  unsubscribe(subscription) {
    supabase.removeChannel(subscription);
  }

  // ============================================
  // DISCORD THREAD REQUESTS
  // ============================================

  /**
   * Request the Discord bot to create a thread for a lineup.
   * Inserts a row into thread_requests; the bot subscribes via Realtime and processes it.
   * @param {string} lineupId - UUID of the lineup
   * @param {string} [channelId] - Optional override channel (defaults to server-side default)
   * @returns {Promise<{ id: string }>} the inserted request row
   */
  async requestDiscordThread(lineupId, channelId = '1496954808324587680') {
    if (!this.canEditLineups()) throw new Error('You do not have permission to create Discord threads');
    if (!lineupId) throw new Error('lineupId is required');
    return (await this._write('threads.request', { lineup_id: lineupId, kind: 'create', channel_id: channelId })).data;
  }

  /**
   * Request the Discord bot to sync an existing thread with the latest lineup state.
   * Bot will edit the roster embed in place, rename the thread if the time changed,
   * and ping any newly added players.
   * @param {string} lineupId
   * @returns {Promise<{ id: string }>} the inserted request row
   */
  async requestDiscordThreadUpdate(lineupId) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to update Discord threads');
    if (!lineupId) throw new Error('lineupId is required');
    return (await this._write('threads.request', { lineup_id: lineupId, kind: 'update' })).data;
  }

  /**
   * Request the Discord bot to mark a lineup's thread as cleared: apply the
   * Cleared forum tag and create the loot thread. The web app has already set
   * lineups.completed + player completions, so the bot only does the Discord side.
   * Fire-and-forget; no-op on the bot if the lineup has no thread.
   * @param {string} lineupId
   * @returns {Promise<{ id: string }>} the inserted request row
   */
  async requestDiscordThreadClear(lineupId) {
    if (!this.canEditLineups()) throw new Error('You do not have permission to clear Discord threads');
    if (!lineupId) throw new Error('lineupId is required');
    return (await this._write('threads.request', { lineup_id: lineupId, kind: 'clear' })).data;
  }

  /**
   * Subscribe to status updates for a specific thread request.
   * @param {string} requestId
   * @param {(row: Object) => void} callback - Called with the updated row on each change
   * @returns {Object} subscription channel (pass to unsubscribe())
   */
  subscribeToThreadRequest(requestId, callback) {
    return supabase
      .channel(`thread-request:${requestId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'thread_requests', filter: `id=eq.${requestId}` },
        (payload) => callback(payload.new)
      )
      .subscribe();
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
