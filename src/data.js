// Google Sheets API integration
class DataService {
  constructor() {
    this.apiKey = 'AIzaSyD2Lldo3ZvtQ6eYqkr6tQrFP25yMh8wU8k';
    this.spreadsheetId = '1gw1cD7I2IU_0lP-jinrjl7_jle5Yf6-2HC2W-lHUxbI';
    this.baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
    this.password = '';
    this.appsScriptUrl = 'https://script.google.com/macros/s/AKfycbx8E4Pw2WZIRgD3iJIcc-qmLzBTKS8nAO4IU_kTBeH73D9am09DumC9THBKpTrgR5RFJg/exec';
  }

  configure(spreadsheetId, apiKey, password = '', appsScriptUrl = '') {
    this.spreadsheetId = spreadsheetId;
    this.apiKey = apiKey;
    this.password = password;
    this.appsScriptUrl = appsScriptUrl;
    localStorage.setItem('sheetConfig', JSON.stringify({ spreadsheetId, apiKey, password, appsScriptUrl }));
  }

  loadConfig() {
    const config = localStorage.getItem('sheetConfig');
    if (config) {
      const { spreadsheetId, apiKey, password, appsScriptUrl } = JSON.parse(config);
      this.spreadsheetId = spreadsheetId;
      this.apiKey = apiKey;
      this.password = password || '';
      this.appsScriptUrl = appsScriptUrl || '';
      return true;
    }
    return false;
  }

  isConfigured() {
    return !!this.spreadsheetId && !!this.apiKey;
  }

  hasWriteAccess() {
    return !!this.appsScriptUrl;
  }

  checkPassword(inputPassword) {
    return !this.password || inputPassword === this.password;
  }

  async getRange(range) {
    if (!this.isConfigured()) throw new Error('Sheet not configured');

    const url = `${this.baseUrl}/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
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

  async deleteLineup(lineupName) {
    return this.callAppsScript('deleteLineup', { lineupName });
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
      armorEnhance: this.cleanValue(row[8] || '')
    })).filter(player => player.name);
  }

  parseLineupsFromSheet(rows) {
    if (rows.length === 0) return [];

    return rows.slice(1).map(row => ({
      name: this.cleanValue(row[0] || ''),
      raidType: this.cleanValue(row[1] || '') || 'Hardcore', // Default to Hardcore if empty
      status: row[2] || 'draft',
      players: row.slice(3, 11).map(p => this.cleanValue(p || '')).filter(p => p),
      completed: row[11] === 'TRUE' || row[11] === 'Yes' || row[11] === true
    })).filter(lineup => lineup.name);
  }

  async getPlayers() {
    try {
      const rows = await this.getRange('Players!A:I');
      return this.parsePlayersFromSheet(rows);
    } catch (error) {
      console.error('Error fetching players:', error);
      return [];
    }
  }

  async getLineups() {
    try {
      const rows = await this.getRange('Lineups!A:L');
      return this.parseLineupsFromSheet(rows);
    } catch (error) {
      console.error('Error fetching lineups:', error);
      return [];
    }
  }
}

export const dataService = new DataService();
