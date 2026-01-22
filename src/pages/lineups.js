import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS } from '../constants.js';

export const LineupsPage = {
  async render(container) {
    container.innerHTML = `
      <div class="lineups-page">
        <h1>Ready Raid Lineups</h1>
        <div id="lineups-list" class="lineups-list">
          <div class="loading">Loading lineups...</div>
        </div>
      </div>
    `;

    this.loadLineups();
  },

  getEquipmentBackground(player) {
    if (!player) return '';

    const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
    const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

    const weaponColor = weaponRarity?.color || '';
    const armorColor = armorRarity?.color || '';

    if (!weaponColor && !armorColor) {
      return '';
    }

    if (weaponColor === armorColor || !weaponColor || !armorColor) {
      const color = weaponColor || armorColor;
      return `background: linear-gradient(135deg, ${color}22 0%, ${color}44 100%);`;
    }

    return `background: linear-gradient(180deg, ${weaponColor}33 0%, ${armorColor}33 100%);`;
  },

  async loadLineups() {
    const listElement = document.getElementById('lineups-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = `
        <div class="setup-message">
          <h2>Google Sheets Not Configured</h2>
          <p>Please set up your Google Sheet to get started.</p>
          <button id="setup-btn" class="btn btn-primary">Setup Google Sheets</button>
        </div>
      `;

      document.getElementById('setup-btn').addEventListener('click', () => {
        this.showSetupModal();
      });
      return;
    }

    try {
      const [lineups, players] = await Promise.all([
        dataService.getLineups(),
        dataService.getPlayers()
      ]);

      const readyLineups = lineups.filter(l => l.status === 'ready');

      if (readyLineups.length === 0) {
        listElement.innerHTML = '<div class="empty-state">No lineups ready. GG talaga Barlito effect!</div>';
        return;
      }

      const playerMap = new Map(players.map(p => [p.name, p]));

      listElement.innerHTML = readyLineups.map(lineup => `
        <div class="lineup-card">
          <h3>${lineup.name}</h3>
          <div class="lineup-players">
            ${lineup.players.map((playerName, idx) => {
              const player = playerMap.get(playerName);
              const backgroundStyle = this.getEquipmentBackground(player);

              if (!player) {
                return `
                  <div class="player-slot empty">
                    <span class="slot-number">${idx + 1}</span>
                    <span class="player-name">${playerName || 'Empty'}</span>
                  </div>
                `;
              }

              const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
              const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

              const equipmentDisplay = [];
              if (player.weapon) {
                const weaponText = `${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}`;
                equipmentDisplay.push(`<span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.weapon} ${weaponText}</span>`);
              }
              if (player.armor) {
                const armorText = `${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}`;
                equipmentDisplay.push(`<span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">${EQUIPMENT_ICONS.armor} ${armorText}</span>`);
              }

              return `
              <div class="player-slot" style="${backgroundStyle}">
                <span class="slot-number">${idx + 1}</span>
                <div class="player-slot-info">
                  <span class="player-name">${playerName}</span>
                  ${player.role ? `<span class="player-role">${player.role}</span>` : ''}
                  ${equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
                </div>
              </div>
            `;
            }).join('')}
            ${Array(8 - lineup.players.length).fill(0).map((_, idx) => `
              <div class="player-slot empty">
                <span class="slot-number">${lineup.players.length + idx + 1}</span>
                <span class="player-name">Empty</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
    }
  },

  showSetupModal() {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Google Sheets Setup</h2>
        <div class="setup-instructions">
          <h3>Instructions:</h3>
          <ol>
            <li>Create a new Google Sheet</li>
            <li>Create two sheets: "Players" and "Lineups"</li>
            <li>In Characters sheet, add headers: Name, Class, Notes, Weapon, WeaponEnhance, Armor, ArmorEnhance, Completed</li>
            <li>In Lineups sheet, add headers: Name, Status, Player1, Player2, Player3, Player4, Player5, Player6, Player7, Player8</li>
            <li>Get your Sheet ID from the URL (between /d/ and /edit)</li>
            <li>Create a Google Cloud project and enable Sheets API</li>
            <li>Create an API key with Sheets API access</li>
          </ol>
        </div>
        <form id="setup-form">
          <div class="form-group">
            <label for="sheet-id">Sheet ID:</label>
            <input type="text" id="sheet-id" required placeholder="1a2B3c4D5e6F7g8H9i0J">
          </div>
          <div class="form-group">
            <label for="api-key">API Key:</label>
            <input type="text" id="api-key" required placeholder="AIzaSy...">
          </div>
          <div class="form-group">
            <label for="password">Password (optional):</label>
            <input type="text" id="password" placeholder="Share this with editors">
          </div>
          <div class="form-group">
            <label for="apps-script-url">Apps Script URL (for write access):</label>
            <input type="text" id="apps-script-url" placeholder="https://script.google.com/macros/s/.../exec">
            <small style="color: #888;">Leave empty for read-only mode</small>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    document.getElementById('setup-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const sheetId = document.getElementById('sheet-id').value;
      const apiKey = document.getElementById('api-key').value;
      const password = document.getElementById('password').value;
      const appsScriptUrl = document.getElementById('apps-script-url').value;

      dataService.configure(sheetId, apiKey, password, appsScriptUrl);
      document.body.removeChild(modalElement);
      toast.success('Google Sheets configured successfully!');
      this.loadLineups();
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  }
};
