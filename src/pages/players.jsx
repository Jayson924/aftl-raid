import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { inputValidator } from '../input-validator.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES } from '../constants.js';
import { modal } from '../modal.js';

export const PlayersPage = {
  // Cache for app users (for owner dropdown)
  _appUsers: [],

  // Check if current user can edit a player (using Discord-linked ownership)
  canEditCharacter(player) {
    return dataService.canEditPlayer(player);
  },

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
      listElement.innerHTML = '<div class="error">Please configure the database first.</div>';
      return;
    }

    try {
      // Load players and app users in parallel
      const [players, appUsers] = await Promise.all([
        dataService.getPlayers(),
        dataService.getAppUsers()
      ]);

      this._appUsers = appUsers;

      // Create lookup map for owners
      const userMap = {};
      appUsers.forEach(u => {
        userMap[u.discordId] = u;
      });

      if (players.length === 0) {
        listElement.innerHTML = '<div class="empty-state">No characters yet. Add your first character!</div>';
        return;
      }

      // Sort players alphabetically by name
      const sortedPlayers = players.sort((a, b) => a.name.localeCompare(b.name));

      const isAdmin = dataService.isAdmin();
      const hasAnyEditableCharacters = sortedPlayers.some(p => this.canEditCharacter(p));

      listElement.innerHTML = `
        <table class="players-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Class</th>
              <th>Weapon</th>
              <th>Armor</th>
              <th>Raids Needed</th>
              <th>Notes</th>
              ${hasAnyEditableCharacters ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${sortedPlayers.map(player => {
              const weaponRarity = EQUIPMENT_RARITIES.find(r => r.value === player.weapon);
              const armorRarity = EQUIPMENT_RARITIES.find(r => r.value === player.armor);

              // Check completion status for both raid types
              const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
              const needsClassic = dataService.playerNeedsRaid(player, 'Classic');

              const raidBadges = [];
              if (needsHardcore) {
                raidBadges.push('<span class="raid-badge raid-hardcore">HC</span>');
              }
              if (needsClassic) {
                raidBadges.push('<span class="raid-badge raid-classic">CL</span>');
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

              const canEdit = this.canEditCharacter(player);
              const owner = player.discordId ? userMap[player.discordId] : null;

              return `
              <tr>
                <td class="player-name" data-label="Name">${player.name}</td>
                <td class="player-owner" data-label="Owner">
                  ${owner ? `
                    <div class="owner-badge" title="${owner.displayName}">
                      ${owner.avatarUrl ? `<img src="${owner.avatarUrl}" alt="${owner.displayName}" class="owner-avatar">` : ''}
                      <span class="owner-name">${owner.displayName}</span>
                    </div>
                  ` : '<span class="no-owner">—</span>'}
                </td>
                <td data-label="Class">${player.role}</td>
                <td data-label="Weapon">
                  ${player.weapon ? `
                    <span class="equipment-item" style="color: ${weaponRarity?.color || 'inherit'}">
                      ${EQUIPMENT_ICONS.weapon} ${weaponRarity?.label || player.weapon}${player.weaponEnhance ? ' +' + player.weaponEnhance : ''}
                    </span>
                    ${suffixDisplay.length > 0 ? `<div class="player-suffixes">${suffixDisplay.join(' + ')}</div>` : ''}
                  ` : '-'}
                </td>
                <td data-label="Armor">
                  ${player.armor ? `
                    <span class="equipment-item" style="color: ${armorRarity?.color || 'inherit'}">
                      ${EQUIPMENT_ICONS.armor} ${armorRarity?.label || player.armor}${player.armorEnhance ? ' +' + player.armorEnhance : ''}
                    </span>
                  ` : '-'}
                </td>
                <td class="raids-needed" data-label="Raids Needed">
                  ${raidBadges.length > 0 ? raidBadges.join(' ') : '<span class="raid-complete">✓ All done</span>'}
                </td>
                <td class="notes" data-label="Notes">${player.notes}</td>
                ${hasAnyEditableCharacters ? `
                  <td class="actions">
                    ${canEdit ? `
                      <button class="btn-icon" title="Edit" data-action="edit" data-player-id="${player.id}">
                        ✏️
                      </button>
                    ` : ''}
                  </td>
                ` : ''}
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
      `;

      // Add event listeners for actions
      if (hasAnyEditableCharacters) {
        document.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const playerId = e.target.dataset.playerId;

            if (action === 'edit') {
              this.showEditPlayerModal(sortedPlayers.find(p => p.id === playerId));
            }
          });
        });
      }
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
              <select id="player-suffix1" class="equipment-select">
                ${WEAPON_SUFFIXES.map(suffix => `
                  <option value="${suffix.value}">${suffix.label}</option>
                `).join('')}
              </select>
              <select id="player-suffix2" class="equipment-select">
                ${WEAPON_SUFFIXES.map(suffix => `
                  <option value="${suffix.value}">${suffix.label}</option>
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
            <textarea id="player-notes" rows="3" maxlength="140"></textarea>
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
      const suffix1 = document.getElementById('player-suffix1').value;
      const suffix2 = document.getElementById('player-suffix2').value;
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
          suffix1,
          suffix2,
          armor,
          armorEnhance,
          notes
        });

        // Track this character as added by current player
        this.addMyCharacter(name);

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
    const isAdmin = dataService.isAdmin();
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
          ${isAdmin ? `
          <div class="form-group">
            <label for="edit-player-owner">Owner:</label>
            <select id="edit-player-owner">
              <option value="">No owner (unassigned)</option>
              ${this._appUsers.map(u => `
                <option value="${u.discordId}" ${player.discordId === u.discordId ? 'selected' : ''}>
                  ${u.displayName} (${u.username})
                </option>
              `).join('')}
            </select>
          </div>
          ` : ''}
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
              <select id="edit-player-suffix1" class="equipment-select">
                ${WEAPON_SUFFIXES.map(suffix => `
                  <option value="${suffix.value}" ${player.suffix1 === suffix.value ? 'selected' : ''}>${suffix.label}</option>
                `).join('')}
              </select>
              <select id="edit-player-suffix2" class="equipment-select">
                ${WEAPON_SUFFIXES.map(suffix => `
                  <option value="${suffix.value}" ${player.suffix2 === suffix.value ? 'selected' : ''}>${suffix.label}</option>
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
            <textarea id="edit-player-notes" rows="3" maxlength="140">${player.notes}</textarea>
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
      const suffix1 = document.getElementById('edit-player-suffix1').value;
      const suffix2 = document.getElementById('edit-player-suffix2').value;
      const armor = document.getElementById('edit-player-armor').value;
      const armorEnhance = document.getElementById('edit-player-armor-enhance').value;
      const notes = document.getElementById('edit-player-notes').value;

      // Get owner selection if admin
      const ownerSelect = document.getElementById('edit-player-owner');
      const newOwnerId = ownerSelect ? ownerSelect.value : null;

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to edit characters.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        await dataService.updatePlayer({
          id: player.id,
          name,
          role,
          weapon,
          weaponEnhance,
          suffix1,
          suffix2,
          armor,
          armorEnhance,
          notes
        }, player.name);

        // Update owner if admin changed it
        if (isAdmin && newOwnerId !== player.discordId) {
          await dataService.assignCharacterOwner(player.id, newOwnerId || null);
        }

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

    // Only show delete button for admins
    const deleteBtn = document.getElementById('delete-player-btn');
    if (!isAdmin && deleteBtn) {
      deleteBtn.style.display = 'none';
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!dataService.isAdmin()) {
          toast.error('Only admins can delete characters');
          return;
        }

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

        try {
          await dataService.deletePlayer(player.name);
          document.body.removeChild(modalElement);
          toast.success(`${player.name} deleted! Wala na!!`);
          this.loadPlayers();
        } catch (error) {
          toast.error(`Anong ginawa mo? Error: ${error.message}`);
        }
      });
    }

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
