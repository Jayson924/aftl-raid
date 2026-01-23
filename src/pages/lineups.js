import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { authService } from '../auth.js';
import { modal } from '../modal.js';
import { EQUIPMENT_RARITIES, EQUIPMENT_ICONS, WEAPON_SUFFIXES } from '../constants.js';

export const LineupsPage = {
  currentRaidType: 'Hardcore',

  async render(container) {
    container.innerHTML = `
      <div class="lineups-page">
        <h1>Ready Raid Lineups</h1>
        <div class="raid-tabs">
          <button class="tab-button ${this.currentRaidType === 'Classic' ? 'active' : ''}" data-raid-type="Classic">GDN Classic</button>
          <button class="tab-button ${this.currentRaidType === 'Hardcore' ? 'active' : ''}" data-raid-type="Hardcore">GDN Hardcore</button>
        </div>
        <div class="tab-content-wrapper">
          <div id="lineups-list" class="lineups-list">
            <div class="loading">Loading lineups...</div>
          </div>
        </div>
      </div>
    `;

    this.setupTabHandlers();
    this.setupTouchHandlers();
    this.loadLineups();
  },

  setupTabHandlers() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const raidType = button.dataset.raidType;
        this.switchRaidType(raidType);
      });
    });
  },

  setupTouchHandlers() {
    const wrapper = document.querySelector('.tab-content-wrapper');
    let touchStartX = 0;
    let touchEndX = 0;

    wrapper.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    wrapper.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe(touchStartX, touchEndX);
    }, { passive: true });
  },

  handleSwipe(startX, endX) {
    const swipeThreshold = 50;
    const diff = startX - endX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        // Swiped left - switch to Hardcore
        this.switchRaidType('Hardcore');
      } else {
        // Swiped right - switch to Classic
        this.switchRaidType('Classic');
      }
    }
  },

  switchRaidType(raidType) {
    if (this.currentRaidType === raidType) return;

    this.currentRaidType = raidType;

    // Update active tab button
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      if (button.dataset.raidType === raidType) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });

    // Add transition effect
    const listElement = document.getElementById('lineups-list');
    listElement.classList.add('transitioning');

    setTimeout(() => {
      this.loadLineups();
      listElement.classList.remove('transitioning');
    }, 150);
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

      const readyLineups = lineups.filter(l => l.status === 'ready' && l.raidType === this.currentRaidType);

      if (readyLineups.length === 0) {
        listElement.innerHTML = `<div class="empty-state">No ${this.currentRaidType} lineups ready yet. GG talaga Barlito effect!</div>`;
        return;
      }

      const playerMap = new Map(players.map(p => [p.name, p]));
      const isAdmin = authService.isAdmin();

      listElement.innerHTML = readyLineups.map(lineup => {
        // Check if lineup is cleared (all players completed)
        const lineupPlayers = lineup.players.map(name => playerMap.get(name)).filter(p => p);
        const isCleared = lineupPlayers.length > 0 && lineupPlayers.every(p => p.completed);

        return `
        <div class="lineup-card ${isCleared ? 'cleared' : ''}">
          <div class="lineup-card-header">
            <h3>${lineup.name}</h3>
            ${isAdmin ? `<button class="btn btn-primary btn-cleared" data-lineup-name="${lineup.name}">${isCleared ? 'Not cleared' : 'Clear'}</button>` : ''}
          </div>
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

              const suffixDisplay = [];
              if (player.suffix1) {
                const suffix1Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix1);
                suffixDisplay.push(suffix1Obj?.label || player.suffix1);
              }
              if (player.suffix2) {
                const suffix2Obj = WEAPON_SUFFIXES.find(s => s.value === player.suffix2);
                suffixDisplay.push(suffix2Obj?.label || player.suffix2);
              }

              return `
              <div class="player-slot" style="${backgroundStyle}">
                <span class="slot-number">${idx + 1}</span>
                <div class="player-slot-info">
                  <span class="player-name">${playerName}</span>
                  ${player.role ? `<span class="player-role">${player.role}</span>` : ''}
                  ${equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
                  ${suffixDisplay.length > 0 ? `<div class="player-suffixes">Suffix: ${suffixDisplay.join(' + ')}</div>` : ''}
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
      `;
      }).join('');

      // Add click handlers for cleared buttons
      if (isAdmin) {
        document.querySelectorAll('.btn-cleared').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const lineupName = btn.dataset.lineupName;
            await this.handleClearedClick(lineupName, lineups);
          });
        });
      }
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
    }
  },

  async handleClearedClick(lineupName, lineups) {
    const lineup = lineups.find(l => l.name === lineupName);
    if (!lineup) {
      toast.error('Lineup not found');
      return;
    }

    const playerNames = lineup.players.filter(p => p);
    if (playerNames.length === 0) {
      toast.warning('??? Disconnected ba lahat ng naka clear?');
      return;
    }

    const confirmed = await modal.confirm(
      `Cleared na ba ${playerNames.length} characters sa <strong>${lineupName}</strong>?<br><br>
      <em>Click again to undo</em>`,
      {
        title: 'Toggle Raid Cleared Status',
        confirmText: 'Toggle Status',
        cancelText: 'Cancel'
      }
    );

    if (!confirmed) return;

    try {
      await dataService.toggleMultiplePlayersCompleted(playerNames);
      toast.success(`Updated cleared status ${playerNames.length} characters in ${lineupName}!`);
      // Reload the lineups to show updated cleared status
      await this.loadLineups();
    } catch (error) {
      toast.error(`Error: ${error.message}`);
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
