import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS } from '../constants.js';
import { modal } from '../modal.js';

export const LineupEditorPage = {
  players: [],
  currentLineup: {
    name: '',
    status: 'draft',
    players: []
  },

  async render(container) {
    container.innerHTML = `
      <div class="lineup-editor-page">
        <div class="page-header">
          <h1>Lineup Editor</h1>
        </div>

        <div class="editor-container">
          <div class="lineup-info">
            <div class="form-group">
              <label for="lineup-name">Lineup Name:</label>
              <input type="text" id="lineup-name" placeholder="Enter lineup name...">
            </div>
            <div class="form-group">
              <label for="lineup-status">Status:</label>
              <select id="lineup-status">
                <option value="draft">Draft</option>
                <option value="ready">Ready</option>
              </select>
            </div>
          </div>

          <div class="editor-main">
            <div class="lineup-slots">
              <h3>Raid Lineup (8 characters)</h3>
              <div id="lineup-slots-container" class="slots-container">
                ${Array(8).fill(0).map((_, idx) => `
                  <div class="slot" data-slot="${idx}">
                    <span class="slot-number">${idx + 1}</span>
                    <div class="slot-content">
                      <div class="empty-slot">Drop or click</div>
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="lineup-actions">
                <button id="save-lineup-btn" class="btn btn-primary">Save Lineup</button>
                <button id="clear-lineup-btn" class="btn btn-secondary">Clear All</button>
              </div>
              <div class="existing-lineups-section">
                <h3>Existing Lineups</h3>
                <div id="existing-lineups-container" class="existing-lineups-container">
                  <div class="loading">Loading lineups...</div>
                </div>
              </div>
            </div>

            <div class="available-players">
              <h3>Available Characters <span style="font-size: 0.85rem; color: #888; font-weight: normal;">(Drag & drop or click slots)</span></h3>
              <div class="player-filter">
                <input type="text" id="player-search" placeholder="Search characters...">
                <select id="class-filter">
                  <option value="">All Classes</option>
                  ${CLASSES.map(cls => `<option value="${cls}">${cls}</option>`).join('')}
                </select>
                <label class="checkbox-label">
                  <input type="checkbox" id="hide-completed">
                  Hide completed
                </label>
              </div>
              <div id="available-players-list" class="players-list">
                <div class="loading">Loading players...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
    this.loadPlayers();
  },

  attachEventListeners() {
    document.getElementById('lineup-name').addEventListener('input', (e) => {
      this.currentLineup.name = e.target.value;
    });

    document.getElementById('lineup-status').addEventListener('change', (e) => {
      this.currentLineup.status = e.target.value;
    });

    document.querySelectorAll('.slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const slotIndex = parseInt(e.currentTarget.dataset.slot);
        this.showPlayerSelector(slotIndex);
      });
    });

    this.setupDragAndDrop();

    document.getElementById('player-search').addEventListener('input', () => {
      this.filterPlayers();
    });

    document.getElementById('class-filter').addEventListener('change', () => {
      this.filterPlayers();
    });

    document.getElementById('hide-completed').addEventListener('change', () => {
      this.filterPlayers();
    });

    document.getElementById('save-lineup-btn').addEventListener('click', () => {
      this.saveLineup();
    });

    document.getElementById('clear-lineup-btn').addEventListener('click', () => {
      this.clearLineup();
    });
  },

  async loadPlayers() {
    const listElement = document.getElementById('available-players-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = '<div class="error">Please configure Google Sheets first.</div>';
      return;
    }

    try {
      this.players = await dataService.getPlayers();
      this.renderAvailablePlayers();
      this.loadExistingLineups();
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading players: ${error.message}</div>`;
    }
  },

  async loadExistingLineups() {
    const container = document.getElementById('existing-lineups-container');

    try {
      const lineups = await dataService.getLineups();

      if (lineups.length === 0) {
        container.innerHTML = '<div class="empty-state">No lineups yet</div>';
        return;
      }

      const playerMap = new Map(this.players.map(p => [p.name, p]));

      container.innerHTML = lineups.map(lineup => {
        const statusClass = lineup.status === 'ready' ? 'ready' : 'draft';

        // Create 8 mini player cards in 2x4 grid
        const playerCards = Array(8).fill(0).map((_, idx) => {
          const playerName = lineup.players[idx];
          const player = playerName ? playerMap.get(playerName) : null;

          if (!player) {
            return `
              <div class="mini-player-card empty">
                <div class="mini-player-empty">Empty</div>
              </div>
            `;
          }

          const backgroundStyle = this.getEquipmentBackground(player);

          return `
            <div class="mini-player-card" style="${backgroundStyle}">
              <div class="mini-player-info">
                <div class="mini-player-name">${player.name}</div>
                <div class="mini-player-role">${player.role}</div>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="mini-lineup-card ${statusClass}" data-lineup-name="${lineup.name}">
            <div class="mini-lineup-header">
              <span class="mini-lineup-name">${lineup.name}</span>
              <div class="mini-lineup-header-actions">
                <span class="mini-lineup-status status-badge ${statusClass}">${lineup.status}</span>
                <button class="mini-delete-btn" data-lineup-name="${lineup.name}" title="Delete lineup">×</button>
              </div>
            </div>
            <div class="mini-lineup-grid">
              ${playerCards}
            </div>
          </div>
        `;
      }).join('');

      // Add click handlers to load lineups
      container.querySelectorAll('.mini-lineup-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          // Don't load if clicking delete button
          if (e.target.classList.contains('mini-delete-btn')) return;

          const lineupName = card.dataset.lineupName;
          const lineups = await dataService.getLineups();
          const lineup = lineups.find(l => l.name === lineupName);
          if (lineup) {
            this.loadLineup(lineup);
          }
        });
      });

      // Add delete button handlers
      container.querySelectorAll('.mini-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const lineupName = btn.dataset.lineupName;
          await this.deleteLineup(lineupName);
        });
      });
    } catch (error) {
      container.innerHTML = `<div class="error">Error loading lineups: ${error.message}</div>`;
    }
  },

  renderAvailablePlayers() {
    const listElement = document.getElementById('available-players-list');

    if (this.players.length === 0) {
      listElement.innerHTML = '<div class="empty-state">No characters available. Add characters first!</div>';
      return;
    }

    const filteredPlayers = this.getFilteredPlayers();

    listElement.innerHTML = filteredPlayers.map(player => {
      const isInLineup = this.currentLineup.players.includes(player.name);
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
        <div class="player-card ${player.completed ? 'completed' : ''} ${isInLineup ? 'in-lineup' : ''}"
             data-player-name="${player.name}"
             draggable="true">
          <div class="player-info">
            <div class="player-name">${player.name}</div>
            <div class="player-role">${player.role}</div>
            ${equipmentDisplay.length > 0 ? `<div class="player-equipment">${equipmentDisplay.join(' ')}</div>` : ''}
          </div>
          ${player.completed ? '<span class="completed-badge">✓</span>' : ''}
          ${isInLineup ? '<span class="in-lineup-badge">Added</span>' : ''}
        </div>
      `;
    }).join('');

    this.setupPlayerDragHandlers();
  },

  getFilteredPlayers() {
    const searchTerm = document.getElementById('player-search').value.toLowerCase();
    const classFilter = document.getElementById('class-filter').value;
    const hideCompleted = document.getElementById('hide-completed').checked;

    return this.players.filter(player => {
      const matchesSearch = player.name.toLowerCase().includes(searchTerm) ||
                          player.role.toLowerCase().includes(searchTerm);
      const matchesClass = !classFilter || player.role === classFilter;
      const matchesCompleted = !hideCompleted || !player.completed;

      return matchesSearch && matchesClass && matchesCompleted;
    });
  },

  filterPlayers() {
    this.renderAvailablePlayers();
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

  showPlayerSelector(slotIndex) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Select Player for Slot ${slotIndex + 1}</h2>
        <div class="player-selector-list">
          ${this.players.map(player => {
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
            <div class="player-option" data-player-name="${player.name}">
              <div class="player-info">
                <div class="player-name">${player.name}</div>
                <div class="player-role">${player.role}</div>
                ${equipmentDisplay.length > 0 ? `<div class="player-equipment">${equipmentDisplay.join(' ')}</div>` : ''}
              </div>
              ${player.completed ? '<span class="completed-badge">✓</span>' : ''}
            </div>
          `;
          }).join('')}
        </div>
        <button class="btn btn-secondary" id="remove-player-btn">Remove Player</button>
        <button class="btn btn-secondary" id="cancel-selector-btn">Cancel</button>
      </div>
    `;

    document.body.appendChild(modalElement);

    modalElement.querySelectorAll('.player-option').forEach(option => {
      option.addEventListener('click', () => {
        const playerName = option.dataset.playerName;
        this.assignPlayerToSlot(slotIndex, playerName);
        document.body.removeChild(modalElement);
      });
    });

    document.getElementById('remove-player-btn').addEventListener('click', () => {
      this.removePlayerFromSlot(slotIndex);
      document.body.removeChild(modalElement);
    });

    document.getElementById('cancel-selector-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  assignPlayerToSlot(slotIndex, playerName) {
    const player = this.players.find(p => p.name === playerName);
    this.currentLineup.players[slotIndex] = playerName;

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

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

    slotContent.innerHTML = `
      <div class="assigned-player">
        <div class="player-name">${player.name}</div>
        <div class="player-role">${player.role}</div>
        ${equipmentDisplay.length > 0 ? `<div class="player-equipment-compact">${equipmentDisplay.join(' ')}</div>` : ''}
      </div>
    `;

    const backgroundStyle = this.getEquipmentBackground(player);
    if (backgroundStyle) {
      slotElement.style.cssText = backgroundStyle;
    } else {
      slotElement.style.cssText = '';
    }

    this.renderAvailablePlayers();
  },

  removePlayerFromSlot(slotIndex) {
    this.currentLineup.players[slotIndex] = null;

    const slotElement = document.querySelector(`[data-slot="${slotIndex}"]`);
    const slotContent = slotElement.querySelector('.slot-content');

    slotContent.innerHTML = '<div class="empty-slot">Drop or click</div>';

    slotElement.style.cssText = '';

    this.renderAvailablePlayers();
  },

  async clearLineup() {
    const confirmed = await modal.confirm(
      'Are you sure you want to clear all slots? This will remove all characters from the lineup.',
      {
        title: 'Clear Lineup',
        confirmText: 'Clear All',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    this.currentLineup = {
      name: '',
      status: 'draft',
      players: []
    };

    document.getElementById('lineup-name').value = '';
    document.getElementById('lineup-status').value = 'draft';

    document.querySelectorAll('.slot').forEach(slotElement => {
      slotElement.querySelector('.slot-content').innerHTML = '<div class="empty-slot">Drop or click</div>';
      slotElement.style.cssText = '';
    });

    this.renderAvailablePlayers();
  },

  async saveLineup() {
    if (!this.currentLineup.name) {
      toast.warning('Please enter a lineup name');
      return;
    }

    const filledSlots = this.currentLineup.players.filter(p => p).length;

    if (filledSlots === 0) {
      toast.warning('Please add at least one character to the lineup');
      return;
    }

    if (!dataService.hasWriteAccess()) {
      toast.warning(`Write access not configured. Please add lineup manually to Google Sheet (${filledSlots}/8 players) or configure Apps Script URL.`, 5000);
      return;
    }

    try {
      const saveBtn = document.getElementById('save-lineup-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const players = Array(8).fill('').map((_, idx) => this.currentLineup.players[idx] || '');

      // Check if lineup with this name already exists
      const existingLineups = await dataService.getLineups();
      const existingLineup = existingLineups.find(l => l.name === this.currentLineup.name);

      if (existingLineup) {
        // Update existing lineup
        await dataService.updateLineup({
          name: this.currentLineup.name,
          status: this.currentLineup.status,
          players
        }, this.currentLineup.name);
        toast.success(`Lineup "${this.currentLineup.name}" updated successfully!`);
      } else {
        // Add new lineup
        await dataService.addLineup({
          name: this.currentLineup.name,
          status: this.currentLineup.status,
          players
        });
        toast.success(`Lineup "${this.currentLineup.name}" saved successfully!`);
      }

      this.loadExistingLineups(); // Refresh the lineup list

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    } catch (error) {
      toast.error(`Error saving lineup: ${error.message}`);
      const saveBtn = document.getElementById('save-lineup-btn');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Lineup';
    }
  },

  async deleteLineup(lineupName) {
    const confirmed = await modal.confirm(
      `Are you sure you want to delete the lineup "${lineupName}"?`,
      {
        title: 'Delete Lineup',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    try {
      await dataService.deleteLineup(lineupName);
      toast.success(`Lineup "${lineupName}" deleted successfully!`);
      this.loadExistingLineups(); // Refresh the lineup list
    } catch (error) {
      toast.error(`Error deleting lineup: ${error.message}`);
    }
  },

  loadLineup(lineup) {
    this.currentLineup = {
      name: lineup.name,
      status: lineup.status,
      players: [...lineup.players]
    };

    document.getElementById('lineup-name').value = lineup.name;
    document.getElementById('lineup-status').value = lineup.status;

    document.querySelectorAll('.slot').forEach(slotElement => {
      slotElement.querySelector('.slot-content').innerHTML = '<div class="empty-slot">Drop or click</div>';
      slotElement.style.cssText = '';
    });

    // Assign players
    lineup.players.forEach((playerName, idx) => {
      if (playerName && idx < 8) {
        const player = this.players.find(p => p.name === playerName);
        if (player) {
          this.assignPlayerToSlot(idx, playerName);
        }
      }
    });

    toast.info(`Loaded lineup: ${lineup.name}`);
  },

  setupPlayerDragHandlers() {
    const playerCards = document.querySelectorAll('.player-card');

    playerCards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', card.dataset.playerName);
        card.classList.add('dragging');
      });

      card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
      });
    });
  },

  setupDragAndDrop() {
    const slots = document.querySelectorAll('.slot');

    slots.forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        slot.classList.add('drag-over');
      });

      slot.addEventListener('dragleave', (e) => {
        slot.classList.remove('drag-over');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');

        const playerName = e.dataTransfer.getData('text/plain');
        const slotIndex = parseInt(slot.dataset.slot);

        if (playerName) {
          this.assignPlayerToSlot(slotIndex, playerName);
          toast.success(`Assigned ${playerName} to slot ${slotIndex + 1}`);
        }
      });
    });
  }
};
