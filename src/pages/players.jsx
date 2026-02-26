import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { inputValidator } from '../input-validator.js';
import { CLASSES, EQUIPMENT_RARITIES, EQUIPMENT_ICONS, ENHANCEMENT_LEVELS, WEAPON_SUFFIXES } from '../constants.js';
import { modal } from '../modal.js';

export const PlayersPage = {
  // Cache for app users (for owner dropdown)
  _appUsers: [],

  // Group by owner toggle state (persisted in localStorage)
  _groupByOwner: localStorage.getItem('playersGroupByOwner') === 'true',

  // Check if current user can edit a player (using Discord-linked ownership)
  canEditCharacter(player) {
    return dataService.canEditPlayer(player);
  },

  async render(container) {
    container.innerHTML = `
      <div class="players-page">
        <div class="page-header">
          <h1>Characters</h1>
          <div class="page-header-actions">
            <label class="toggle-switch">
              <input type="checkbox" id="group-by-owner-toggle" ${this._groupByOwner ? 'checked' : ''}>
              <span class="toggle-slider"></span>
              <span class="toggle-label">Group by owner</span>
            </label>
            <button id="add-player-btn" class="btn btn-primary">+ Add Character</button>
          </div>
        </div>
        <div id="players-list" class="players-list">
          <div class="loading">Loading characters...</div>
        </div>
      </div>
    `;

    document.getElementById('add-player-btn').addEventListener('click', () => {
      this.showAddPlayerModal();
    });

    document.getElementById('group-by-owner-toggle').addEventListener('change', (e) => {
      this._groupByOwner = e.target.checked;
      localStorage.setItem('playersGroupByOwner', this._groupByOwner);
      this.loadPlayers();
    });

    this.loadPlayers();
  },

  // Store collapsed state for owner groups
  _collapsedOwners: new Set(),

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
      this._allPlayers = players;

      // Create lookup map for owners
      const userMap = {};
      appUsers.forEach(u => {
        userMap[u.discordId] = u;
      });

      if (players.length === 0) {
        listElement.innerHTML = '<div class="empty-state">No characters yet. Add your first character!</div>';
        return;
      }

      const hasAnyEditableCharacters = players.some(p => this.canEditCharacter(p));

      // Render based on toggle state
      if (this._groupByOwner) {
        this.renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters);
      } else {
        this.renderFlatView(listElement, players, userMap, hasAnyEditableCharacters);
      }

      // Add event listeners for actions
      if (hasAnyEditableCharacters) {
        document.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const playerId = e.target.dataset.playerId;

            if (action === 'edit') {
              this.showEditPlayerModal(players.find(p => p.id === playerId));
            }
          });
        });
      }
    } catch (error) {
      listElement.innerHTML = `<div class="error">Error loading characters: ${error.message}</div>`;
    }
  },

  renderFlatView(listElement, players, userMap, hasAnyEditableCharacters) {
    // Sort players alphabetically by name
    const sortedPlayers = players.sort((a, b) => a.name.localeCompare(b.name));

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
  },

  renderGroupedView(listElement, players, userMap, hasAnyEditableCharacters) {
    // Group players by owner
    const groupedByOwner = {};
    const unassigned = [];

    players.forEach(player => {
      if (player.discordId) {
        if (!groupedByOwner[player.discordId]) {
          groupedByOwner[player.discordId] = [];
        }
        groupedByOwner[player.discordId].push(player);
      } else {
        unassigned.push(player);
      }
    });

    // Sort owners by display name
    const sortedOwnerIds = Object.keys(groupedByOwner).sort((a, b) => {
      const ownerA = userMap[a]?.displayName || '';
      const ownerB = userMap[b]?.displayName || '';
      return ownerA.localeCompare(ownerB);
    });

    // Build grouped HTML
    let html = '<div class="owner-groups">';

    // Render each owner group
    sortedOwnerIds.forEach(ownerId => {
      const owner = userMap[ownerId];
      const ownerPlayers = groupedByOwner[ownerId];
      const isCollapsed = this._collapsedOwners.has(ownerId);

      html += this.renderOwnerGroup(owner, ownerPlayers, ownerId, isCollapsed, hasAnyEditableCharacters, userMap);
    });

    // Render unassigned group
    if (unassigned.length > 0) {
      const isCollapsed = this._collapsedOwners.has('unassigned');
      html += this.renderOwnerGroup(null, unassigned, 'unassigned', isCollapsed, hasAnyEditableCharacters, userMap);
    }

    html += '</div>';
    listElement.innerHTML = html;

    // Add event listeners for collapse toggles
    document.querySelectorAll('.owner-group-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const ownerId = header.dataset.ownerId;
        if (this._collapsedOwners.has(ownerId)) {
          this._collapsedOwners.delete(ownerId);
        } else {
          this._collapsedOwners.add(ownerId);
        }
        this.loadPlayers();
      });
    });
  },

  renderOwnerGroup(owner, players, ownerId, isCollapsed, hasAnyEditableCharacters, userMap) {
    // Group players by account number within this owner (treat null/undefined as Account 1)
    const byAccount = {};

    players.forEach(player => {
      const accountNum = player.accountNumber || 1;
      if (!byAccount[accountNum]) {
        byAccount[accountNum] = [];
      }
      byAccount[accountNum].push(player);
    });

    // Sort account numbers
    const sortedAccountNums = Object.keys(byAccount).map(n => parseInt(n)).sort((a, b) => a - b);

    const ownerName = owner ? owner.displayName : 'Unassigned';
    const ownerAvatar = owner?.avatarUrl ? `<img src="${owner.avatarUrl}" alt="${ownerName}" class="owner-group-avatar">` : '';

    let html = `
      <div class="owner-group ${isCollapsed ? 'collapsed' : ''}">
        <div class="owner-group-header" data-owner-id="${ownerId}">
          <span class="collapse-icon">${isCollapsed ? '>' : 'v'}</span>
          ${ownerAvatar}
          <span class="owner-group-name">${ownerName}</span>
          <span class="owner-group-count">(${players.length} character${players.length !== 1 ? 's' : ''})</span>
        </div>
    `;

    if (!isCollapsed) {
      html += '<div class="owner-group-content">';

      // Render each account group
      sortedAccountNums.forEach((accountNum, index) => {
        const accountPlayers = byAccount[accountNum];
        // Only show account indicator if there are multiple accounts
        if (sortedAccountNums.length > 1) {
          html += `
            <div class="account-group" data-account="${accountNum}">
              <div class="account-divider"><span class="account-num" data-account="${accountNum}">${accountNum}</span></div>
              ${this.renderPlayersTable(accountPlayers, hasAnyEditableCharacters, userMap)}
            </div>
          `;
        } else {
          // Single account - no indicator needed
          html += this.renderPlayersTable(accountPlayers, hasAnyEditableCharacters, userMap);
        }
      });

      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  renderPlayersTable(players, hasAnyEditableCharacters, userMap, accountBadge = null) {
    // Sort players alphabetically
    const sortedPlayers = players.sort((a, b) => a.name.localeCompare(b.name));

    return `
      <table class="players-table">
        <thead>
          <tr>
            <th>Name</th>
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

            return `
            <tr>
              <td class="player-name" data-label="Name">${player.name}</td>
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
  },

  // Get the max account number for a given owner
  getMaxAccountForOwner(discordId) {
    if (!discordId || !this._allPlayers) return 0;

    let maxAccount = 0;
    this._allPlayers.forEach(p => {
      if (p.discordId === discordId && p.accountNumber) {
        maxAccount = Math.max(maxAccount, p.accountNumber);
      }
    });

    return maxAccount;
  },

  // Render account buttons row
  renderAccountButtons(containerId, selectedAccount = null, maxAccount = 1) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Ensure at least 1 account button, or up to maxAccount
    const numButtons = Math.max(1, maxAccount);

    let html = '<div class="account-buttons">';
    for (let i = 1; i <= numButtons; i++) {
      const isSelected = selectedAccount === i;
      html += `<button type="button" class="account-btn ${isSelected ? 'selected' : ''}" data-account="${i}">Acc ${i}</button>`;
    }
    html += `<button type="button" class="account-btn add-account-btn" title="Add account">+</button>`;
    html += '</div>';

    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('.account-btn:not(.add-account-btn)').forEach(btn => {
      btn.addEventListener('click', () => {
        // Toggle selection
        const wasSelected = btn.classList.contains('selected');
        container.querySelectorAll('.account-btn').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          btn.classList.add('selected');
        }
      });
    });

    container.querySelector('.add-account-btn').addEventListener('click', () => {
      const currentButtons = container.querySelectorAll('.account-btn:not(.add-account-btn)');
      const newAccountNum = currentButtons.length + 1;

      // Insert new button before the + button
      const addBtn = container.querySelector('.add-account-btn');
      const newBtn = document.createElement('button');
      newBtn.type = 'button';
      newBtn.className = 'account-btn';
      newBtn.dataset.account = newAccountNum;
      newBtn.textContent = `Acc ${newAccountNum}`;

      newBtn.addEventListener('click', () => {
        const wasSelected = newBtn.classList.contains('selected');
        container.querySelectorAll('.account-btn').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          newBtn.classList.add('selected');
        }
      });

      addBtn.parentNode.insertBefore(newBtn, addBtn);
    });
  },

  // Get currently selected account from buttons
  getSelectedAccount(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const selected = container.querySelector('.account-btn.selected');
    return selected ? parseInt(selected.dataset.account) : null;
  },

  showAddPlayerModal() {
    const isAdmin = dataService.isAdmin();
    const currentUser = dataService.getUser();

    // Get max account for current user (or first selected owner for admin)
    const initialOwnerId = isAdmin ? (this._appUsers[0]?.discordId || null) : (currentUser?.id || null);
    const maxAccount = initialOwnerId ? this.getMaxAccountForOwner(initialOwnerId) : 0;

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
          ${isAdmin ? `
          <div class="form-group">
            <label for="player-owner">Owner:</label>
            <select id="player-owner">
              <option value="">No owner (unassigned)</option>
              ${this._appUsers.map(u => `
                <option value="${u.discordId}" ${currentUser && u.discordId === currentUser.id ? 'selected' : ''}>
                  ${u.displayName} (${u.username})
                </option>
              `).join('')}
            </select>
          </div>
          ` : ''}
          <div class="form-group" id="account-group">
            <label>Account:</label>
            <div id="account-buttons-container"></div>
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

    // Initialize account buttons - default to Account 1 selected
    const selectedOwnerId = isAdmin
      ? (currentUser?.id || this._appUsers[0]?.discordId || null)
      : (currentUser?.id || null);
    const initialMax = selectedOwnerId ? Math.max(1, this.getMaxAccountForOwner(selectedOwnerId)) : 1;
    this.renderAccountButtons('account-buttons-container', 1, initialMax);

    // Update account buttons when owner changes (admin only)
    if (isAdmin) {
      const ownerSelect = document.getElementById('player-owner');

      ownerSelect.addEventListener('change', () => {
        const selectedOwner = ownerSelect.value;
        const ownerMax = selectedOwner ? Math.max(1, this.getMaxAccountForOwner(selectedOwner)) : 1;
        this.renderAccountButtons('account-buttons-container', null, ownerMax);
      });
    }

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
      const accountNumber = this.getSelectedAccount('account-buttons-container');

      if (!dataService.hasWriteAccess()) {
        toast.warning('Please log in to add characters.', 5000);
        document.body.removeChild(modalElement);
        return;
      }

      try {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        const result = await dataService.addPlayer({
          name,
          role,
          weapon,
          weaponEnhance,
          suffix1,
          suffix2,
          armor,
          armorEnhance,
          notes,
          accountNumber: accountNumber || 1
        });

        // If admin selected an owner, assign it
        if (isAdmin) {
          const selectedOwner = document.getElementById('player-owner')?.value;
          if (selectedOwner && result.data?.id) {
            await dataService.assignCharacterOwner(result.data.id, selectedOwner);
          }
        }

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

    // Get max account for this player's owner
    const maxAccount = player.discordId ? this.getMaxAccountForOwner(player.discordId) : 0;

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
          <div class="form-group" id="edit-account-group">
            <label>Account:</label>
            <div id="edit-account-buttons-container"></div>
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

    // Initialize account buttons with player's current account selected (default to 1 if not set)
    const editMaxAccount = player.discordId ? Math.max(1, maxAccount, player.accountNumber || 1) : 1;
    this.renderAccountButtons('edit-account-buttons-container', player.accountNumber || 1, editMaxAccount);

    // Update account buttons when owner changes (admin only)
    if (isAdmin) {
      const ownerSelect = document.getElementById('edit-player-owner');

      ownerSelect.addEventListener('change', () => {
        const selectedOwner = ownerSelect.value;
        const ownerMax = selectedOwner ? Math.max(1, this.getMaxAccountForOwner(selectedOwner)) : 1;
        this.renderAccountButtons('edit-account-buttons-container', null, ownerMax);
      });
    }

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
      const accountNumber = this.getSelectedAccount('edit-account-buttons-container');

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
          notes,
          accountNumber: accountNumber || 1
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
