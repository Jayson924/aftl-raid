import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { getClassSpriteStyle } from '../constants.js';
import { PlayersPage } from './players.jsx';

export const MyRaidsPage = {
  _myPlayers: [],
  _personalRaids: [],
  _editingRaidId: null,
  _editingRaidPlayerId: null,
  _lastAddedRaid: null, // { name, maxClears } - for pre-filling next add form

  async render(container) {
    if (!dataService.isAuthenticated()) {
      container.innerHTML = '<p>Please log in to view your raids.</p>';
      return;
    }

    container.innerHTML = `
      <div class="my-raids-page">
        <h1 class="page-title">My Raids</h1>

        <div class="section display-name-section">
          <h2>Display Name</h2>
          <div class="display-name-form">
            <input type="text" id="display-name-input" value="" maxlength="32" placeholder="Enter your display name">
            <button class="btn btn-primary" id="save-name-btn">Save</button>
          </div>
        </div>

        <div class="section my-characters-section">
          <div class="section-header">
            <h2>My Characters</h2>
            <div class="section-header-actions">
              <button class="btn btn-danger-outline" id="delete-raid-all-btn">Delete All Raids</button>
              <button class="btn btn-secondary" id="add-raid-all-btn">+ Add Raid to All</button>
              <button class="btn btn-primary" id="add-character-btn">+ Add Character</button>
            </div>
          </div>
          <div id="my-characters-list"></div>
        </div>
      </div>
    `;

    // Pre-fill display name
    const nameInput = document.getElementById('display-name-input');
    nameInput.value = dataService.getDisplayName() || '';

    this.setupDisplayNameHandlers();
    this.setupAddCharacterHandler();
    this.setupAddRaidToAllHandler();
    this.setupDeleteAllRaidsHandler();
    await this.loadMyCharacters();
  },

  destroy() {
    this._myPlayers = [];
    this._personalRaids = [];
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
    this._lastAddedRaid = null;
  },

  // ============================================
  // DISPLAY NAME
  // ============================================

  setupDisplayNameHandlers() {
    const input = document.getElementById('display-name-input');
    const saveBtn = document.getElementById('save-name-btn');

    saveBtn.addEventListener('click', () => this.saveDisplayName());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveDisplayName();
    });
  },

  async saveDisplayName() {
    const input = document.getElementById('display-name-input');
    const newName = input.value.trim();
    if (!newName) {
      toast.error('Display name cannot be empty');
      return;
    }

    try {
      await dataService.updateDisplayName(newName);
      toast.success('Display name updated!');
      // Dispatch event so main.js can re-render navigation with new name
      window.dispatchEvent(new CustomEvent('display-name-changed'));
    } catch (error) {
      toast.error(`Failed to update name: ${error.message}`);
    }
  },

  // ============================================
  // MY CHARACTERS
  // ============================================

  async loadMyCharacters() {
    const listEl = document.getElementById('my-characters-list');
    if (!listEl) return;

    try {
      const [allPlayers] = await Promise.all([
        dataService.getPlayers(),
        this.loadPersonalRaids()
      ]);
      const userId = dataService.getUser()?.id;
      this._myPlayers = allPlayers.filter(p => p.discordId === userId);

      if (this._myPlayers.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No characters assigned to your account.</p>';
        return;
      }

      // Group personal raids by player ID
      const raidsByPlayer = {};
      this._personalRaids.forEach(raid => {
        if (!raidsByPlayer[raid.playerId]) raidsByPlayer[raid.playerId] = [];
        raidsByPlayer[raid.playerId].push(raid);
      });

      // Group by account number
      const byAccount = {};
      this._myPlayers.forEach(p => {
        const acct = p.accountNumber || 1;
        if (!byAccount[acct]) byAccount[acct] = [];
        byAccount[acct].push(p);
      });

      const accountNumbers = Object.keys(byAccount).sort((a, b) => a - b);
      const multiAccount = accountNumbers.length > 1;

      let html = '';
      accountNumbers.forEach(acctNum => {
        const players = byAccount[acctNum];
        if (multiAccount) {
          html += `<div class="account-group">
            <div class="account-header">Account ${acctNum}</div>`;
        }
        html += '<div class="character-cards">';
        players.forEach(player => {
          const needsHardcore = dataService.playerNeedsRaid(player, 'Hardcore');
          const needsClassic = dataService.playerNeedsRaid(player, 'Classic');
          const iconStyle = getClassSpriteStyle(player.role);
          const playerRaids = raidsByPlayer[player.id] || [];

          html += `
            <div class="character-block" data-player-id="${player.id}">
              <div class="character-card">
                <div class="character-info">
                  ${iconStyle ? `<div class="class-sprite class-icon" style="${iconStyle}"></div>` : ''}
                  <div>
                    <span class="character-name-link" data-player-id="${player.id}">${player.name}<span class="edit-icon">✎</span></span>
                    <span class="character-class">${player.role}</span>
                  </div>
                </div>
                <div class="character-actions">
                  <span class="raid-badge raid-hardcore clickable ${!needsHardcore ? 'completed' : ''}"
                        data-player-id="${player.id}" data-raid-type="Hardcore" data-completed="${!needsHardcore}"
                        title="Click to toggle">
                    ${!needsHardcore ? '✓ ' : ''}HC
                  </span>
                  <span class="raid-badge raid-classic clickable ${!needsClassic ? 'completed' : ''}"
                        data-player-id="${player.id}" data-raid-type="Classic" data-completed="${!needsClassic}"
                        title="Click to toggle">
                    ${!needsClassic ? '✓ ' : ''}CL
                  </span>
                </div>
              </div>
              <div class="character-personal-raids">
                ${this.renderPlayerRaidsHTML(player.id, playerRaids)}
                <div class="add-raid-form-container" data-player-id="${player.id}"></div>
              </div>
            </div>
          `;
        });
        html += '</div>';
        if (multiAccount) {
          html += '</div>';
        }
      });

      listEl.innerHTML = html;
      this.setupRaidBadgeHandlers();
      this.setupEditCharacterHandlers();
      this.setupPersonalRaidHandlers();
      this.setupAddRaidHandlers();
    } catch (error) {
      console.error('Error loading characters:', error);
      listEl.innerHTML = '<p class="empty-state">Failed to load characters.</p>';
    }
  },

  setupRaidBadgeHandlers() {
    document.querySelectorAll('.my-characters-section .raid-badge.clickable').forEach(badge => {
      badge.addEventListener('click', async (e) => {
        const playerId = badge.dataset.playerId;
        const raidType = badge.dataset.raidType;
        const isCurrentlyCompleted = badge.dataset.completed === 'true';
        const newCompleted = !isCurrentlyCompleted;

        badge.style.opacity = '0.5';
        try {
          await dataService.togglePlayerRaidCompletion(playerId, raidType, newCompleted);
          toast.success(`${raidType} ${newCompleted ? 'marked as done' : 'marked as not done'}`);
          await this.loadMyCharacters();
        } catch (error) {
          badge.style.opacity = '1';
          toast.error(`Failed to update: ${error.message}`);
        }
      });
    });
  },

  setupEditCharacterHandlers() {
    document.querySelectorAll('.character-name-link').forEach(link => {
      link.addEventListener('click', async () => {
        const playerId = link.dataset.playerId;
        const player = this._myPlayers.find(p => p.id === playerId);
        if (!player) return;

        PlayersPage._allPlayers = this._myPlayers;
        if (dataService.isAdmin()) {
          PlayersPage._appUsers = await dataService.getAppUsers();
        }

        const originalLoadPlayers = PlayersPage.loadPlayers;
        PlayersPage.loadPlayers = () => {
          PlayersPage.loadPlayers = originalLoadPlayers;
          this.loadMyCharacters();
        };

        PlayersPage.showEditPlayerModal(player);
      });
    });
  },

  setupAddCharacterHandler() {
    document.getElementById('add-character-btn').addEventListener('click', async () => {
      // Set account data from already-loaded characters so account buttons work
      PlayersPage._allPlayers = this._myPlayers;

      // Admins need app users for the owner dropdown
      if (dataService.isAdmin()) {
        PlayersPage._appUsers = await dataService.getAppUsers();
      }

      // Temporarily patch loadPlayers so the modal refreshes our list on success
      const originalLoadPlayers = PlayersPage.loadPlayers;
      PlayersPage.loadPlayers = () => {
        PlayersPage.loadPlayers = originalLoadPlayers;
        this.loadMyCharacters();
      };

      PlayersPage.showAddPlayerModal();
    });
  },

  // ============================================
  // ADD RAID TO ALL CHARACTERS
  // ============================================

  setupAddRaidToAllHandler() {
    document.getElementById('add-raid-all-btn').addEventListener('click', () => {
      this.showAddRaidToAllModal();
    });
  },

  showAddRaidToAllModal() {
    if (this._myPlayers.length === 0) {
      toast.error('No characters to add raids to');
      return;
    }

    // Get unique raid names for autocomplete
    const uniqueRaidNames = [...new Set(this._personalRaids.map(r => r.name))].sort();
    const datalistOptions = uniqueRaidNames.map(name => `<option value="${name}">`).join('');

    const prefillMax = this._lastAddedRaid?.maxClears || 1;

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.innerHTML = `
      <div class="modal-content bulk-raid-modal">
        <h2>Add Raid to All Characters</h2>
        <div class="form-group">
          <label for="bulk-raid-name">Raid Name</label>
          <input type="text" id="bulk-raid-name" class="form-control" placeholder="e.g. Abyss Mire" maxlength="50" list="bulk-raid-suggestions" autocomplete="off">
          <datalist id="bulk-raid-suggestions">${datalistOptions}</datalist>
        </div>
        <div class="form-group">
          <label for="bulk-raid-max">Max Clears</label>
          <input type="number" id="bulk-raid-max" class="form-control" min="1" max="99" value="${prefillMax}">
        </div>
        <p class="bulk-raid-hint">Adds to all ${this._myPlayers.length} characters.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="bulk-raid-confirm">Add to All</button>
          <button type="button" class="btn btn-secondary" id="bulk-raid-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const nameInput = overlay.querySelector('#bulk-raid-name');
    const maxInput = overlay.querySelector('#bulk-raid-max');
    const confirmBtn = overlay.querySelector('#bulk-raid-confirm');
    const cancelBtn = overlay.querySelector('#bulk-raid-cancel');

    nameInput.focus();

    // When user picks from autocomplete, fill in max clears
    nameInput.addEventListener('input', () => {
      const existingRaid = this._personalRaids.find(r => r.name === nameInput.value);
      if (existingRaid) maxInput.value = existingRaid.maxClears;
    });

    const close = () => {
      document.removeEventListener('keydown', handleKey);
      if (overlay.parentNode) overlay.remove();
    };

    const submit = async () => {
      const name = nameInput.value.trim();
      const maxClears = parseInt(maxInput.value, 10);

      if (!name) { toast.error('Raid name cannot be empty'); return; }
      if (!maxClears || maxClears < 1) { toast.error('Max clears must be at least 1'); return; }

      const existingPlayerIds = new Set(
        this._personalRaids.filter(r => r.name === name).map(r => r.playerId)
      );
      const playersToAdd = this._myPlayers.filter(p => !existingPlayerIds.has(p.id));

      if (playersToAdd.length === 0) {
        toast.error('All characters already have this raid');
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Adding...';

      try {
        let added = 0;
        for (const player of playersToAdd) {
          await dataService.addPersonalRaid(player.id, name, maxClears);
          added++;
        }
        this._lastAddedRaid = { name, maxClears };
        const skipped = this._myPlayers.length - added;
        const msg = skipped > 0
          ? `Added "${name}" to ${added} characters (${skipped} skipped)`
          : `Added "${name}" to all ${added} characters`;
        toast.success(msg);
        close();
        await this.loadPersonalRaids();
        this.reloadAllPlayerRaids();
      } catch (error) {
        toast.error(`Failed: ${error.message}`);
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Add to All';
      }
    };

    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const handleKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', handleKey);
  },

  reloadAllPlayerRaids() {
    this._myPlayers.forEach(player => {
      this.refreshPlayerRaids(player.id);
    });
  },

  // ============================================
  // DELETE ALL RAIDS
  // ============================================

  setupDeleteAllRaidsHandler() {
    document.getElementById('delete-raid-all-btn').addEventListener('click', () => {
      this.deleteAllRaids();
    });
  },

  async deleteAllRaids() {
    if (this._personalRaids.length === 0) {
      toast.error('No personal raids to delete');
      return;
    }

    const confirmed = await modal.confirm(
      `Delete all ${this._personalRaids.length} personal raids across all your characters?`, {
        title: 'Delete All Personal Raids',
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        danger: true
      }
    );

    if (!confirmed) return;

    try {
      let deleted = 0;
      for (const raid of [...this._personalRaids]) {
        await dataService.deletePersonalRaid(raid.id);
        deleted++;
      }
      this._personalRaids = [];
      this.reloadAllPlayerRaids();
      toast.success(`Deleted ${deleted} raids`);
    } catch (error) {
      toast.error(`Failed: ${error.message}`);
      // Reload to get accurate state
      await this.loadPersonalRaids();
      this.reloadAllPlayerRaids();
    }
  },

  // ============================================
  // PERSONAL RAIDS
  // ============================================

  async loadPersonalRaids() {
    try {
      this._personalRaids = await dataService.getPersonalRaids();
    } catch (error) {
      console.error('Error loading personal raids:', error);
      this._personalRaids = [];
    }
  },

  renderPlayerRaidsHTML(playerId, raids) {
    let html = '';
    if (raids.length > 0) {
      html += '<div class="personal-raid-cards">';
      raids.forEach(raid => {
        const isComplete = raid.currentClears >= raid.maxClears;
        const progressPct = Math.min((raid.currentClears / raid.maxClears) * 100, 100);

        html += `
          <div class="personal-raid-card ${isComplete ? 'completed' : ''}" data-raid-id="${raid.id}">
            <div class="raid-card-body">
              <div class="raid-card-top">
                <span class="raid-name-link" data-raid-id="${raid.id}">${raid.name}<span class="edit-icon">✎</span></span>
                <span class="progress-text">${raid.currentClears}/${raid.maxClears}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${isComplete ? 'complete' : ''}" style="width: ${progressPct}%"></div>
              </div>
            </div>
            <div class="raid-counter-btns">
              <button class="btn-counter btn-decrement" data-raid-id="${raid.id}" ${raid.currentClears <= 0 ? 'disabled' : ''}>-</button>
              <button class="btn-counter btn-increment" data-raid-id="${raid.id}" ${isComplete ? 'disabled' : ''}>+</button>
            </div>
            <button class="btn-icon raid-delete-btn" data-raid-id="${raid.id}" title="Delete">&times;</button>
          </div>
        `;
      });
      html += '</div>';
    }
    html += `<button class="btn btn-add-raid" data-player-id="${playerId}">+ Add Raid</button>`;
    return html;
  },

  setupPersonalRaidHandlers() {
    // Increment
    document.querySelectorAll('.btn-increment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.incrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears++;
          this.refreshPlayerRaids(raid.playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    // Decrement
    document.querySelectorAll('.btn-decrement').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.decrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears--;
          this.refreshPlayerRaids(raid.playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    // Edit (clickable raid name)
    document.querySelectorAll('.raid-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const raidId = link.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (raid) this.showEditRaidForm(raid);
      });
    });

    // Delete
    document.querySelectorAll('.raid-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (!raid) return;

        const confirmed = await modal.confirm(`Delete "${raid.name}"?`, {
          title: 'Delete Personal Raid',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true
        });

        if (confirmed) {
          try {
            await dataService.deletePersonalRaid(raidId);
            const playerId = raid.playerId;
            this._personalRaids = this._personalRaids.filter(r => r.id !== raidId);
            this.refreshPlayerRaids(playerId);
            toast.success('Raid deleted');
          } catch (error) {
            toast.error(`Failed to delete: ${error.message}`);
          }
        }
      });
    });
  },

  setupAddRaidHandlers() {
    document.querySelectorAll('.btn-add-raid').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = btn.dataset.playerId;
        this.showAddRaidForm(playerId);
      });
    });
  },

  refreshPlayerRaids(playerId) {
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    const raidsContainer = block.querySelector('.character-personal-raids');
    if (!raidsContainer) return;

    const playerRaids = this._personalRaids.filter(r => r.playerId === playerId);
    raidsContainer.innerHTML = this.renderPlayerRaidsHTML(playerId, playerRaids)
      + `<div class="add-raid-form-container" data-player-id="${playerId}"></div>`;

    // Re-bind handlers for this character's raids
    raidsContainer.querySelectorAll('.btn-increment').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.incrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears++;
          this.refreshPlayerRaids(playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    raidsContainer.querySelectorAll('.btn-decrement').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        btn.disabled = true;
        try {
          await dataService.decrementPersonalRaid(raidId);
          const raid = this._personalRaids.find(r => r.id === raidId);
          if (raid) raid.currentClears--;
          this.refreshPlayerRaids(playerId);
        } catch (error) {
          toast.error(error.message);
          btn.disabled = false;
        }
      });
    });

    raidsContainer.querySelectorAll('.raid-name-link').forEach(link => {
      link.addEventListener('click', () => {
        const raidId = link.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (raid) this.showEditRaidForm(raid);
      });
    });

    raidsContainer.querySelectorAll('.raid-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const raidId = btn.dataset.raidId;
        const raid = this._personalRaids.find(r => r.id === raidId);
        if (!raid) return;

        const confirmed = await modal.confirm(`Delete "${raid.name}"?`, {
          title: 'Delete Personal Raid',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          danger: true
        });

        if (confirmed) {
          try {
            await dataService.deletePersonalRaid(raidId);
            this._personalRaids = this._personalRaids.filter(r => r.id !== raidId);
            this.refreshPlayerRaids(playerId);
            toast.success('Raid deleted');
          } catch (error) {
            toast.error(`Failed to delete: ${error.message}`);
          }
        }
      });
    });

    raidsContainer.querySelectorAll('.btn-add-raid').forEach(btn => {
      btn.addEventListener('click', () => {
        this.showAddRaidForm(playerId);
      });
    });
  },

  showAddRaidForm(playerId) {
    this._editingRaidId = null;
    this._editingRaidPlayerId = playerId;

    // Hide any other open forms first
    document.querySelectorAll('.personal-raid-card.adding').forEach(c => c.remove());
    document.querySelectorAll('.btn-add-raid').forEach(b => { b.style.display = ''; });

    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    // Hide the add button
    const addBtn = block.querySelector('.btn-add-raid');
    if (addBtn) addBtn.style.display = 'none';

    // Get unique raid names for autocomplete (excluding raids already on this character)
    const existingRaidsForPlayer = this._personalRaids
      .filter(r => r.playerId === playerId)
      .map(r => r.name);
    const uniqueRaidNames = [...new Set(this._personalRaids.map(r => r.name))]
      .filter(name => !existingRaidsForPlayer.includes(name))
      .sort();

    // Pre-fill values from last added raid
    const prefillName = this._lastAddedRaid?.name || '';
    const prefillMax = this._lastAddedRaid?.maxClears || 1;

    // Build datalist options
    const datalistOptions = uniqueRaidNames.map(name => `<option value="${name}">`).join('');

    // Insert the inline add form as a card
    const raidCards = block.querySelector('.personal-raid-cards');
    const addFormHTML = `
      <div class="personal-raid-card adding">
        <input type="text" class="raid-edit-name-input" placeholder="Raid name" maxlength="50"
               value="${prefillName}" list="raid-name-suggestions">
        <datalist id="raid-name-suggestions">${datalistOptions}</datalist>
        <div class="raid-edit-max">
          <span>Max</span>
          <input type="number" class="raid-edit-max-input" min="1" max="99" value="${prefillMax}">
        </div>
        <div class="raid-edit-actions">
          <button class="btn btn-small btn-secondary raid-add-cancel">Cancel</button>
          <button class="btn btn-small btn-primary raid-add-save">Add</button>
        </div>
      </div>
    `;

    if (raidCards) {
      raidCards.insertAdjacentHTML('beforeend', addFormHTML);
    } else {
      // No raids yet, create the container
      const raidsContainer = block.querySelector('.character-personal-raids');
      raidsContainer.insertAdjacentHTML('afterbegin', `<div class="personal-raid-cards">${addFormHTML}</div>`);
    }

    const addCard = block.querySelector('.personal-raid-card.adding');
    const nameInput = addCard.querySelector('.raid-edit-name-input');
    const maxInput = addCard.querySelector('.raid-edit-max-input');

    nameInput.focus();
    nameInput.select(); // Select pre-filled text for easy replacement

    addCard.querySelector('.raid-add-cancel').addEventListener('click', () => {
      this.hideAddForm(playerId);
    });

    addCard.querySelector('.raid-add-save').addEventListener('click', () => {
      this.saveNewRaid();
    });

    // When user picks from autocomplete, also fill in max clears from that raid
    nameInput.addEventListener('input', () => {
      const selectedName = nameInput.value;
      const existingRaid = this._personalRaids.find(r => r.name === selectedName);
      if (existingRaid) {
        maxInput.value = existingRaid.maxClears;
      }
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNewRaid();
      if (e.key === 'Escape') this.hideAddForm(playerId);
    });

    maxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveNewRaid();
      if (e.key === 'Escape') this.hideAddForm(playerId);
    });
  },

  hideAddForm(playerId) {
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (block) {
      const addCard = block.querySelector('.personal-raid-card.adding');
      if (addCard) addCard.remove();

      const addBtn = block.querySelector('.btn-add-raid');
      if (addBtn) addBtn.style.display = '';
    }
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
  },

  showEditRaidForm(raid) {
    this._editingRaidId = raid.id;
    this._editingRaidPlayerId = raid.playerId;

    // Find the raid card and replace it with inline edit form
    const raidCard = document.querySelector(`.personal-raid-card[data-raid-id="${raid.id}"]`);
    if (!raidCard) return;

    // Store original HTML to restore on cancel
    this._originalRaidCardHTML = raidCard.outerHTML;

    raidCard.outerHTML = `
      <div class="personal-raid-card editing" data-raid-id="${raid.id}">
        <input type="text" class="raid-edit-name-input" value="${raid.name}" maxlength="50" placeholder="Raid name">
        <div class="raid-edit-max">
          <span>Max:</span>
          <input type="number" class="raid-edit-max-input" min="1" max="99" value="${raid.maxClears}">
        </div>
        <div class="raid-edit-actions">
          <button class="btn btn-small btn-secondary raid-edit-cancel">Cancel</button>
          <button class="btn btn-small btn-primary raid-edit-save">Save</button>
        </div>
      </div>
    `;

    const editCard = document.querySelector(`.personal-raid-card[data-raid-id="${raid.id}"]`);
    const nameInput = editCard.querySelector('.raid-edit-name-input');
    const maxInput = editCard.querySelector('.raid-edit-max-input');

    nameInput.focus();
    nameInput.select();

    editCard.querySelector('.raid-edit-cancel').addEventListener('click', () => {
      this.cancelInlineEdit(raid);
    });

    editCard.querySelector('.raid-edit-save').addEventListener('click', () => {
      this.saveEditedRaid();
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveEditedRaid();
      if (e.key === 'Escape') this.cancelInlineEdit(raid);
    });

    maxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveEditedRaid();
      if (e.key === 'Escape') this.cancelInlineEdit(raid);
    });
  },

  cancelInlineEdit(raid) {
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
    this.refreshPlayerRaids(raid.playerId);
  },

  hideRaidForm(playerId) {
    const pid = playerId || this._editingRaidPlayerId;
    if (pid) {
      const container = document.querySelector(`.add-raid-form-container[data-player-id="${pid}"]`);
      if (container) container.innerHTML = '';
      const block = document.querySelector(`.character-block[data-player-id="${pid}"]`);
      if (block) {
        const addBtn = block.querySelector('.btn-add-raid');
        if (addBtn) addBtn.style.display = '';
      }
    }
    this._editingRaidId = null;
    this._editingRaidPlayerId = null;
  },

  async saveNewRaid() {
    const playerId = this._editingRaidPlayerId;
    const block = document.querySelector(`.character-block[data-player-id="${playerId}"]`);
    if (!block) return;

    const addCard = block.querySelector('.personal-raid-card.adding');
    if (!addCard) return;

    const nameInput = addCard.querySelector('.raid-edit-name-input');
    const maxInput = addCard.querySelector('.raid-edit-max-input');
    const name = nameInput.value.trim();
    const maxClears = parseInt(maxInput.value, 10);

    if (!name) {
      toast.error('Raid name cannot be empty');
      return;
    }
    if (!maxClears || maxClears < 1) {
      toast.error('Max clears must be at least 1');
      return;
    }
    if (!playerId) {
      toast.error('No character selected');
      return;
    }

    try {
      await dataService.addPersonalRaid(playerId, name, maxClears);
      // Remember for pre-filling next add form
      this._lastAddedRaid = { name, maxClears };
      this.hideAddForm(playerId);
      await this.loadPersonalRaids();
      this.refreshPlayerRaids(playerId);
      toast.success('Raid added!');
    } catch (error) {
      if (error.message?.includes('duplicate') || error.code === '23505') {
        toast.error('A raid with that name already exists for this character');
      } else {
        toast.error(`Failed to add raid: ${error.message}`);
      }
    }
  },

  async saveEditedRaid() {
    const editCard = document.querySelector(`.personal-raid-card[data-raid-id="${this._editingRaidId}"]`);
    if (!editCard) return;

    const nameInput = editCard.querySelector('.raid-edit-name-input');
    const maxInput = editCard.querySelector('.raid-edit-max-input');
    const name = nameInput.value.trim();
    const maxClears = parseInt(maxInput.value, 10);
    const playerId = this._editingRaidPlayerId;

    if (!name) {
      toast.error('Raid name cannot be empty');
      return;
    }
    if (!maxClears || maxClears < 1) {
      toast.error('Max clears must be at least 1');
      return;
    }

    try {
      await dataService.updatePersonalRaid(this._editingRaidId, { name, maxClears });
      const raid = this._personalRaids.find(r => r.id === this._editingRaidId);
      if (raid) {
        raid.name = name;
        raid.maxClears = maxClears;
      }
      this._editingRaidId = null;
      this._editingRaidPlayerId = null;
      this.refreshPlayerRaids(playerId);
      toast.success('Raid updated!');
    } catch (error) {
      if (error.message?.includes('duplicate') || error.code === '23505') {
        toast.error('A raid with that name already exists for this character');
      } else {
        toast.error(`Failed to update raid: ${error.message}`);
      }
    }
  }
};
