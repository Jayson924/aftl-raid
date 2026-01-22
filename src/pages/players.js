import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { inputValidator } from '../input-validator.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS } from '../constants.js';
import { modal } from '../modal.js';

export const PlayersPage = {
  async render(container) {
    container.innerHTML = `
      <div class="players-page">
        <div class="page-header">
          <h1>Characters</h1>
          <button id="add-player-btn" class="btn btn-primary">+ Add Character</button>
        </div>
        <div id="players-list" class="players-list">
          <div class="loading">Loading characters...</div>
        </div>
      </div>
    `;

    document.getElementById('add-player-btn').addEventListener('click', () => {
      this.showAddPlayerModal();
    });

    this.loadPlayers();
  },

  async loadPlayers() {
    const listElement = document.getElementById('players-list');

    if (!dataService.isConfigured()) {
      listElement.innerHTML = '<div class="error">Please configure Google Sheets first from the Lineups page.</div>';
      return;
    }

    try {
      const players = await dataService.getPlayers();

      if (players.length === 0) {
        listElement.innerHTML = '<div class="empty-state">No characters yet. Add your first character!</div>';
        return;
      }

      // Sort players alphabetically by name
      const sortedPlayers = players.sort((a, b) => a.name.localeCompare(b.name));

      listElement.innerHTML = `
        <table class="players-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Class</th>
              <th>Weapon</th>
              <th>Armor</th>
              <th>Notes</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${sortedPlayers.map(player => {
              const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
              const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

              return `
              <tr class="${player.completed ? 'completed' : ''}">
                <td class="player-name" data-label="Name">${player.name}</td>
                <td data-label="Class">${player.role}</td>
                <td data-label="Weapon">
                  ${player.weapon ? `
                    <span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">
                      ${EQUIPMENT_ICONS.weapon} ${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}
                    </span>
                  ` : '-'}
                </td>
                <td data-label="Armor">
                  ${player.armor ? `
                    <span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">
                      ${EQUIPMENT_ICONS.armor} ${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}
                    </span>
                  ` : '-'}
                </td>
                <td class="notes" data-label="Notes">${player.notes}</td>
                <td data-label="Status">
                  <span class="status-badge ${player.completed ? 'completed' : 'pending'}">
                    ${player.completed ? 'Completed' : 'Pending'}
                  </span>
                </td>
                <td class="actions">
                  <button class="btn-icon" title="Edit" data-action="edit" data-player="${player.name}">
                    ✏️
                  </button>
                  <button class="btn-icon" title="Toggle Completed" data-action="toggle" data-player="${player.name}">
                    ${player.completed ? '↩️' : '✅'}
                  </button>
                </td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      `;

      // Add event listeners for actions
      document.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.target.dataset.action;
          const playerName = e.target.dataset.player;

          if (action === 'edit') {
            this.showEditPlayerModal(players.find(p => p.name === playerName));
          } else if (action === 'toggle') {
            this.togglePlayerCompleted(playerName);
          }
        });
      });
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading characters: ${error.message}</div>`;
    }
  },

  showAddPlayerModal() {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Add New Character</h2>
        <form id="add-player-form">
          <div class="form-group">
            <label for="player-name">Name: *</label>
            <input type="text" id="player-name" required>
          </div>
          <div class="form-group">
            <label for="player-class">Class:</label>
            <select id="player-class">
              <option value="">Select a class...</option>
              ${CLASSES.map(cls => `<option value="${cls}">${cls}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="player-weapon">
              <span class="equipment-label">${EQUIPMENT_ICONS.weapon} Weapon:</span>
            </label>
            <div class="equipment-row">
              <select id="player-weapon" class="equipment-select">
                ${EQUIPMENT_RARITIES.map(rarity => `
                  <option value="${rarity.value}" ${rarity.color ? `data-color="${rarity.color}"` : ''}>
                    ${rarity.label}
                  </option>
                `).join('')}
              </select>
              <select id="player-weapon-enhance" class="equipment-select enhancement-select">
                ${ENHANCEMENT_LEVELS.map(level => `
                  <option value="${level.value}">${level.label}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="player-armor">
              <span class="equipment-label">${EQUIPMENT_ICONS.armor} Armor:</span>
            </label>
            <div class="equipment-row">
              <select id="player-armor" class="equipment-select">
                ${EQUIPMENT_RARITIES.map(rarity => `
                  <option value="${rarity.value}" ${rarity.color ? `data-color="${rarity.color}"` : ''}>
                    ${rarity.label}
                  </option>
                `).join('')}
              </select>
              <select id="player-armor-enhance" class="equipment-select enhancement-select">
                ${ENHANCEMENT_LEVELS.map(level => `
                  <option value="${level.value}">${level.label}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="player-notes">Notes:</label>
            <textarea id="player-notes" rows="3"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Add Character</button>
            <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    document.getElementById('add-player-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('player-name').value;
      const role = document.getElementById('player-class').value;
      const weapon = document.getElementById('player-weapon').value;
      const weaponEnhance = document.getElementById('player-weapon-enhance').value;
      const armor = document.getElementById('player-armor').value;
      const armorEnhance = document.getElementById('player-armor-enhance').value;
      const notes = document.getElementById('player-notes').value;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Write access not configured. Please add player manually to Google Sheet or configure Apps Script URL.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        await dataService.addPlayer({
          name,
          role,
          weapon,
          weaponEnhance,
          armor,
          armorEnhance,
          notes,
          completed: false
        });

        document.body.removeChild(modalElement);
        toast.success(`Character "${name}" added successfully!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Error adding player: ${error.message}`);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Character';
      }
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  showEditPlayerModal(player) {
    const modalElement = document.createElement('div');
    modalElement.className = 'modal';
    modalElement.innerHTML = `
      <div class="modal-content">
        <h2>Edit Character</h2>
        <form id="edit-player-form">
          <div class="form-group">
            <label for="edit-player-name">Name: *</label>
            <input type="text" id="edit-player-name" required value="${player.name}">
          </div>
          <div class="form-group">
            <label for="edit-player-class">Class:</label>
            <select id="edit-player-class">
              <option value="">Select a class...</option>
              ${CLASSES.map(cls => `<option value="${cls}" ${player.role === cls ? 'selected' : ''}>${cls}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="edit-player-weapon">
              <span class="equipment-label">${EQUIPMENT_ICONS.weapon} Weapon:</span>
            </label>
            <div class="equipment-row">
              <select id="edit-player-weapon" class="equipment-select">
                ${EQUIPMENT_RARITIES.map(rarity => `
                  <option value="${rarity.value}" ${player.weapon === rarity.value ? 'selected' : ''} ${rarity.color ? `data-color="${rarity.color}"` : ''}>
                    ${rarity.label}
                  </option>
                `).join('')}
              </select>
              <select id="edit-player-weapon-enhance" class="equipment-select enhancement-select">
                ${ENHANCEMENT_LEVELS.map(level => `
                  <option value="${level.value}" ${player.weaponEnhance === level.value ? 'selected' : ''}>${level.label}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-player-armor">
              <span class="equipment-label">${EQUIPMENT_ICONS.armor} Armor:</span>
            </label>
            <div class="equipment-row">
              <select id="edit-player-armor" class="equipment-select">
                ${EQUIPMENT_RARITIES.map(rarity => `
                  <option value="${rarity.value}" ${player.armor === rarity.value ? 'selected' : ''} ${rarity.color ? `data-color="${rarity.color}"` : ''}>
                    ${rarity.label}
                  </option>
                `).join('')}
              </select>
              <select id="edit-player-armor-enhance" class="equipment-select enhancement-select">
                ${ENHANCEMENT_LEVELS.map(level => `
                  <option value="${level.value}" ${player.armorEnhance === level.value ? 'selected' : ''}>${level.label}</option>
                `).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label for="edit-player-notes">Notes:</label>
            <textarea id="edit-player-notes" rows="3">${player.notes}</textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <button type="button" class="btn btn-secondary" id="cancel-edit-btn">Cancel</button>
            <button type="button" class="btn" style="background-color: #dc3545; color: white;" id="delete-player-btn">Delete</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalElement);

    document.getElementById('edit-player-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('edit-player-name').value;
      const role = document.getElementById('edit-player-class').value;
      const weapon = document.getElementById('edit-player-weapon').value;
      const weaponEnhance = document.getElementById('edit-player-weapon-enhance').value;
      const armor = document.getElementById('edit-player-armor').value;
      const armorEnhance = document.getElementById('edit-player-armor-enhance').value;
      const notes = document.getElementById('edit-player-notes').value;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Write access not configured. Please update player manually in Google Sheet or configure Apps Script URL.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        await dataService.updatePlayer({
          name,
          role,
          weapon,
          weaponEnhance,
          armor,
          armorEnhance,
          notes,
          completed: player.completed
        }, player.name);

        document.body.removeChild(modalElement);
        toast.success(`Character "${name}" updated successfully!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Error updating player: ${error.message}`);
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
      }
    });

    document.getElementById('delete-player-btn').addEventListener('click', async () => {
      const confirmed = await modal.confirm(
        `Are you sure you want to delete ${player.name}? This action cannot be undone.`,
        {
          title: 'Delete Character',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true
        }
      );

      if (!confirmed) return;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Write access not configured. Please delete player manually from Google Sheet or configure Apps Script URL.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        await dataService.deletePlayer(player.name);
        document.body.removeChild(modalElement);
        toast.success(`${player.name} deleted! Wala na!!`);
        this.loadPlayers();
      } catch (error) {
        toast.error(`Anong ginawa mo? Error: ${error.message}`);
      }
    });

    document.getElementById('cancel-edit-btn').addEventListener('click', () => {
      document.body.removeChild(modalElement);
    });

    modalElement.addEventListener('click', (e) => {
      if (e.target === modalElement) {
        document.body.removeChild(modalElement);
      }
    });
  },

  async togglePlayerCompleted(playerName) {
    if (!dataService.hasWriteAccess()) {
      toast.warning('Write access not configured. Please update player manually in Google Sheet or configure Apps Script URL.', 5000);
      return;
    }

    try {
      await dataService.togglePlayerCompleted(playerName);
      toast.success(`Updated ${playerName}`);
      this.loadPlayers();
    } catch (error) {
      toast.error(`??? Hala ano yan error: ${error.message}`);
    }
  }
};
