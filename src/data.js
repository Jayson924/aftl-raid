// Google Sheets API integration
class DataService {
  constructor() {
    // For local dev: Vite exposes env vars prefixed with VITE_
    this.apiKey = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY || '';
    this.spreadsheetId = '1gw1cD7I2IU_0lP-jinrjl7_jle5Yf6-2HC2W-lHUxbI';
    this.baseUrl = '/.netlify/functions/sheets-proxy'; // Use Netlify Function in production
    this.isDev = import.meta.env.DEV; // true when running with Vite dev server
    this.password = '';
    this.appsScriptUrl = 'https://script.google.com/macros/s/AKfycbx8E4Pw2WZIRgD3iJIcc-qmLzBTKS8nAO4IU_kTBeH73D9am09DumC9THBKpTrgR5RFJg/exec';
  }

  configure(spreadsheetId, password = '', appsScriptUrl = '') {
    this.spreadsheetId = spreadsheetId;
    this.password = password;
    this.appsScriptUrl = appsScriptUrl;
    localStorage.setItem('sheetConfig', JSON.stringify({ spreadsheetId, password, appsScriptUrl }));
  }

  loadConfig() {
    const config = localStorage.getItem('sheetConfig');
    if (config) {
      const { spreadsheetId, password, appsScriptUrl } = JSON.parse(config);
      this.spreadsheetId = spreadsheetId;
      this.password = password || '';
      this.appsScriptUrl = appsScriptUrl || '';
      return true;
    }
    return false;
  }

  isConfigured() {
    return !!this.spreadsheetId;
  }

  hasWriteAccess() {
    return !!this.appsScriptUrl;
  }

  checkPassword(inputPassword) {
    return !this.password || inputPassword === this.password;
  }

  async getRange(range) {
    if (!this.isConfigured()) throw new Error('Sheet not configured');

    let url;

    // In development mode, use Google Sheets API directly if we have an API key
    if (this.isDev && this.apiKey) {
      url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
    } else {
      // In production, use Netlify Function (keeps API key secure)
      url = `${this.baseUrl}?spreadsheetId=${encodeURIComponent(this.spreadsheetId)}&range=${encodeURIComponent(range)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    const data = await response.json();
    return data.values || [];
  }

  async updateRange(range, values) {
    if (!this.isConfigured()) throw new Error('Sheet not configured');

    console.warn('Update functionality requires Apps Script deployment');
    return values;
  }

  async callAppsScript(action, data) {
    if (!this.hasWriteAccess()) {
      throw new Error('Apps Script URL not configured');
    }

    const params = new URLSearchParams();
    params.append('action', action);
    params.append('password', this.password || '');

    Object.keys(data).forEach(key => {
      const value = data[key];
      if (typeof value === 'object') {
        params.append(key, JSON.stringify(value));
      } else if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });

    const url = `${this.appsScriptUrl}?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Operation failed');
    }

    return result;
  }

  async addPlayer(player) {
    return this.callAppsScript('addPlayer', { player });
  }

  async updatePlayer(player, oldName) {
    return this.callAppsScript('updatePlayer', { player, oldName });
  }

  async deletePlayer(playerName) {
    return this.callAppsScript('deletePlayer', { playerName });
  }

  async addLineup(lineup) {
    return this.callAppsScript('addLineup', { lineup });
  }

  async updateLineup(lineup, oldName) {
    return this.callAppsScript('updateLineup', { lineup, oldName });
  }

  async deleteLineup(lineupName, raidType) {
    return this.callAppsScript('deleteLineup', { lineupName, raidType });
  }

  async checkWeeklyReset(lastResetTimestamp) {
    return this.callAppsScript('checkWeeklyReset', { lastResetTimestamp });
  }

  async toggleLineupCompleted(lineupName) {
    return this.callAppsScript('toggleLineupCompleted', { lineupName });
  }

  cleanValue(value) {
    if (typeof value === 'string') {
      if (value.startsWith("'")) {
        return value.substring(1);
      }
      return value.trim();
    }
    return value || '';
  }

  parsePlayersFromSheet(rows) {
    if (rows.length === 0) return [];

    return rows.slice(1).map(row => ({
      name: this.cleanValue(row[0] || ''),
      role: this.cleanValue(row[1] || ''),
      notes: this.cleanValue(row[2] || ''),
      weapon: this.cleanValue(row[3] || ''),
      weaponEnhance: this.cleanValue(row[4] || ''),
      suffix1: this.cleanValue(row[5] || ''),
      suffix2: this.cleanValue(row[6] || ''),
      armor: this.cleanValue(row[7] || ''),
      armorEnhance: this.cleanValue(row[8] || ''),
      hardcoreCompleted: this.cleanValue(row[9] || ''),
      classicCompleted: this.cleanValue(row[10] || ''),
      classicTicketUsed: this.cleanValue(row[11] || '') // Column L: Classic ticket usage timestamp
    })).filter(player => player.name);
  }

  parseLineupsFromSheet(rows) {
    if (rows.length === 0) return [];

    return rows.slice(1).map(row => {
      // Parse player names and extract ticket status
      const rawPlayers = row.slice(3, 11).map(p => this.cleanValue(p || ''));
      const players = [];
      const ticketPlayers = [];

      rawPlayers.forEach(playerName => {
        if (!playerName) return;

        // Check for [T] suffix indicating ticket usage
        if (playerName.endsWith('[T]')) {
          players.push(playerName.slice(0, -3)); // Remove [T] suffix
          ticketPlayers.push(true);
        } else {
          players.push(playerName);
          ticketPlayers.push(false);
        }
      });

      return {
        name: this.cleanValue(row[0] || ''),
        raidType: this.cleanValue(row[1] || '') || 'Hardcore', // Default to Hardcore if empty
        status: row[2] || 'draft',
        players,
        ticketPlayers, // Array of booleans matching players array
        completed: row[11] === 'TRUE' || row[11] === 'Yes' || row[11] === true,
        isTemplate: row[12] === 'TRUE' || row[12] === 'Yes' || row[12] === true
      };
    }).filter(lineup => lineup.name);
  }

  async getPlayers() {
    try {
      const rows = await this.getRange('Players!A:L'); // Extended to include ClassicTicketUsed column
      return this.parsePlayersFromSheet(rows);
    } catch (error) {
      console.error('Error fetching players:', error);
      return [];
    }
  }

  async getLineups() {
    try {
      const rows = await this.getRange('Lineups!A:M');
      return this.parseLineupsFromSheet(rows);
    } catch (error) {
      console.error('Error fetching lineups:', error);
      return [];
    }
  }

  /**
   * Check if a completion timestamp is from the current weekly reset period
   * Reset period: Friday 5pm PT to next Friday 5pm PT
   * @param {string} timestamp - ISO 8601 timestamp or empty string
   * @returns {boolean} - true if completed this week
   */
  isCompletedThisWeek(timestamp) {
    if (!timestamp) return false;

    try {
      const completedDate = new Date(timestamp);
      const now = new Date();

      // Get the most recent Friday 5pm in Pacific Time (handles DST automatically)
      const nowPT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

      // Determine current day of week in PT (0=Sun, 5=Fri, 6=Sat)
      const dayOfWeek = nowPT.getDay();

      // Calculate how many days back to last Friday 5pm PT
      let daysBack;
      if (dayOfWeek === 5) { // Friday
        // Check if we're past 5pm PT
        if (nowPT.getHours() >= 17) {
          daysBack = 0; // Use this Friday
        } else {
          daysBack = 7; // Use last Friday
        }
      } else if (dayOfWeek === 6) { // Saturday
        daysBack = 1;
      } else if (dayOfWeek === 0) { // Sunday
        daysBack = 2;
      } else { // Mon-Thu (1-4)
        daysBack = dayOfWeek + 2;
      }

      const lastFridayPT = new Date(nowPT);
      lastFridayPT.setDate(lastFridayPT.getDate() - daysBack);
      lastFridayPT.setHours(17, 0, 0, 0);

      // Convert completion date to PT for comparison
      const completedPT = new Date(completedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

      // Check if completion date is on or after last Friday 5pm PT
      return completedPT >= lastFridayPT;
    } catch (error) {
      console.error('Error parsing completion timestamp:', error);
      return false;
    }
  }

  /**
   * Get player completion status for a specific raid type
   * @param {object} player - Player object with completion timestamps
   * @param {string} raidType - 'Hardcore' or 'Classic'
   * @returns {boolean} - true if player completed this raid type this week
   */
  playerNeedsRaid(player, raidType) {
    const timestamp = raidType === 'Hardcore' ? player.hardcoreCompleted : player.classicCompleted;
    return !this.isCompletedThisWeek(timestamp);
  }

  /**
   * Check if player has already used their ticket this week
   * Currently only Classic raid has tickets
   * @param {object} player - Player object with ticket usage timestamp
   * @param {string} raidType - 'Hardcore' or 'Classic'
   * @returns {boolean} - true if player has used their ticket this week
   */
  playerTicketUsed(player, raidType) {
    // Currently only Classic has tickets
    if (raidType !== 'Classic') return false;
    return this.isCompletedThisWeek(player.classicTicketUsed);
  }

  async markPlayersCompleted(playerNames, raidType, ticketPlayerNames = []) {
    return this.callAppsScript('markPlayersCompleted', {
      playerNames: playerNames,
      raidType: raidType,
      ticketPlayerNames: ticketPlayerNames
    });
  }

  async unmarkPlayersCompleted(playerNames, raidType, excludeLineupName, ticketPlayerNames = []) {
    return this.callAppsScript('unmarkPlayersCompleted', {
      playerNames: playerNames,
      raidType: raidType,
      excludeLineupName: excludeLineupName,
      ticketPlayerNames: ticketPlayerNames
    });
  }

  async getSpendingConfig() {
    return this.callAppsScript('getSpendingConfig', {});
  }

  async saveSpendingConfig(config) {
    return this.callAppsScript('saveSpendingConfig', { config });
  }
}

export const dataService = new DataService();
