import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import {
  setFdTable,
  CARDS_PER_PAGE,
  DEFAULT_CARD_PAGES,
  MAX_CARD_PAGES,
  getClassSpriteStyle
} from '../constants.js';
import { renderPagination, bindPagination } from '../pagination.js';

// Escape user-controlled values before interpolating into innerHTML.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const AdminPage = {
  _users: [],
  _sortBy: 'date', // 'name' or 'date' — default to date so newly joined users surface at the top
  _sortAsc: false, // date desc = newest first
  _activeTab: 'users',
  _fdTable: [],
  _cardNames: {},        // slotIndex -> name
  _cardPageCount: DEFAULT_CARD_PAGES,
  _cardMapPage: 1,       // currently-viewed page in editor
  _cardMapLoaded: false,

  async render(container) {
    if (!dataService.isAdmin()) {
      container.innerHTML = '<p>Admin access required.</p>';
      return;
    }

    container.innerHTML = `
      <div class="admin-page">
        <h1 class="page-title">Admin</h1>
        <div class="admin-tabs">
          <button class="admin-tab active" data-tab="users">Users</button>
          <button class="admin-tab" data-tab="discord-bot">Discord Bot</button>
          <button class="admin-tab" data-tab="card-map">Card Map</button>
        </div>
        <div class="admin-tab-content" id="admin-tab-users">
          <div class="admin-subtabs">
            <button class="admin-subtab active" data-subtab="users-list">Users</button>
            <button class="admin-subtab" data-subtab="new-characters">New Characters <span class="admin-pending-count" id="admin-whitelist-count"></span></button>
          </div>
          <div class="admin-subtab-content" id="admin-subtab-new-characters" style="display:none">
            <div class="section" id="admin-whitelist-section">
              <p class="admin-fd-desc">Characters that haven't been confirmed as in-guild. Mark as in-guild to grant access to in-guild features (or if guild friend, kayo na bahala :) pang incentivise lang naman natin na ipasok mga characters sa guild)</p>
              <div id="admin-whitelist-list" class="admin-whitelist-list">
                <p class="loading">Loading...</p>
              </div>
            </div>
          </div>
          <div class="admin-subtab-content" id="admin-subtab-users-list">
            <div class="section">
              <div class="admin-section-header">
                <h2>Users</h2>
                <div class="admin-sort-buttons">
                  <button class="admin-sort-btn" data-sort="name">Name</button>
                  <button class="admin-sort-btn active" data-sort="date">Date Joined</button>
                </div>
              </div>
              <div id="admin-users-list" class="admin-users-list">
                <p class="loading">Loading users...</p>
              </div>
            </div>
            <div class="section">
              <h2>Admins</h2>
              <div id="admin-admins-list" class="admin-users-list">
                <p class="loading">Loading admins...</p>
              </div>
            </div>
          </div>
        </div>
        <div class="admin-tab-content" id="admin-tab-discord-bot" style="display:none">
          <div class="section">
            <div class="admin-section-header">
              <h2>FD Breakpoints</h2>
              <div class="admin-fd-actions">
                <button class="btn btn-sm admin-fd-add-btn">+ Add Value</button>
                <button class="btn btn-sm btn-primary admin-fd-save-btn">Save</button>
              </div>
            </div>
            <p class="admin-fd-desc">Final Damage breakpoint table, also used for gearscore calculation.</p>
            <div id="admin-fd-table" class="admin-fd-table">
              <p class="loading">Loading...</p>
            </div>
          </div>
        </div>
        <div class="admin-tab-content" id="admin-tab-card-map" style="display:none">
          <div class="section">
            <div class="admin-section-header">
              <h2>Card Map</h2>
              <div class="admin-card-map-actions">
                <button class="btn btn-sm admin-card-remove-page-btn" title="Remove the last page">− Remove Page</button>
                <button class="btn btn-sm admin-card-add-page-btn" title="Add a new page (up to ${MAX_CARD_PAGES})">+ Add Page</button>
                <button class="btn btn-sm btn-primary admin-card-save-btn">Save Names</button>
              </div>
            </div>
            <p class="admin-fd-desc"></p>
            <div id="admin-card-map" class="admin-card-map">
              <p class="loading">Loading…</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Tab listeners
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._activeTab = tab.dataset.tab;
        document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
        document.getElementById(`admin-tab-${tab.dataset.tab}`).style.display = '';
        if (tab.dataset.tab === 'card-map') this._loadCardMap();
      });
    });

    // Sub-tab listeners (within Users tab)
    document.querySelectorAll('.admin-subtab').forEach(subtab => {
      subtab.addEventListener('click', () => {
        document.querySelectorAll('.admin-subtab').forEach(t => t.classList.remove('active'));
        subtab.classList.add('active');
        document.querySelectorAll('.admin-subtab-content').forEach(c => c.style.display = 'none');
        document.getElementById(`admin-subtab-${subtab.dataset.subtab}`).style.display = '';
      });
    });

    // Sort button listeners
    document.querySelectorAll('.admin-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sort = btn.dataset.sort;
        if (this._sortBy === sort) {
          this._sortAsc = !this._sortAsc;
        } else {
          this._sortBy = sort;
          this._sortAsc = sort === 'name';
        }
        document.querySelectorAll('.admin-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        btn.dataset.dir = this._sortAsc ? 'asc' : 'desc';
        this._renderUsers();
      });
    });

    // FD table actions
    document.querySelector('.admin-fd-add-btn').addEventListener('click', () => this._addFdRow());
    document.querySelector('.admin-fd-save-btn').addEventListener('click', () => this._saveFdTable());

    // Card Map actions
    document.querySelector('.admin-card-add-page-btn').addEventListener('click', () => this._addCardPage());
    document.querySelector('.admin-card-remove-page-btn').addEventListener('click', () => this._removeCardPage());
    document.querySelector('.admin-card-save-btn').addEventListener('click', () => this._saveCardMap());

    await this._loadUsers();
    await this._loadPlayers();
    this._renderUsers();
    this._loadFdTable();
    this._loadWhitelistQueue();
  },

  // ============================================
  // FD TABLE
  // ============================================

  async _loadFdTable() {
    try {
      const saved = await dataService.getAppConfig('fd_table');
      this._fdTable = saved && saved.length > 0 ? [...saved] : [];
    } catch {
      this._fdTable = [];
    }
    this._renderFdTable();
  },

  _renderFdTable() {
    const container = document.getElementById('admin-fd-table');
    if (!container) return;

    if (this._fdTable.length === 0) {
      container.innerHTML = '<p class="empty-state">No FD breakpoints configured.</p>';
      return;
    }

    const rows = Math.ceil(this._fdTable.length / 3);
    container.innerHTML = `
      <div class="fd-table-grid" style="--fd-rows: ${rows}">
        ${this._fdTable.map((row, i) => `
          <div class="fd-table-row" data-index="${i}">
            <input type="number" class="fd-input fd-input-pct" data-field="pct" data-index="${i}" value="${row.pct}" min="0" max="100" step="1" />
            <span class="fd-row-separator">%</span>
            <input type="number" class="fd-input fd-input-fd" data-field="fd" data-index="${i}" value="${row.fd}" min="0" step="1" />
            <button class="fd-row-delete" data-index="${i}" title="Remove row">&times;</button>
          </div>
        `).join('')}
      </div>
    `;

    // Input change listeners
    container.querySelectorAll('.fd-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const field = e.target.dataset.field;
        this._fdTable[idx][field] = parseInt(e.target.value) || 0;
      });
    });

    // Delete row listeners
    container.querySelectorAll('.fd-row-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        this._fdTable.splice(idx, 1);
        this._renderFdTable();
      });
    });
  },

  _addFdRow() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.innerHTML = `
        <div class="modal-content confirmation-modal">
          <h2>Add FD Breakpoint</h2>
          <div class="form-group">
            <label>Damage %</label>
            <input type="number" id="fd-add-pct" placeholder="e.g. 57" min="0" max="100" />
          </div>
          <div class="form-group">
            <label>FD Value</label>
            <input type="number" id="fd-add-fd" placeholder="e.g. 2453" min="0" />
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-primary" id="fd-add-confirm">Add</button>
            <button type="button" class="btn btn-secondary" id="fd-add-cancel">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const pctInput = document.getElementById('fd-add-pct');
      const fdInput = document.getElementById('fd-add-fd');
      pctInput.focus();

      const cleanup = () => {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', handleKey);
      };

      const submit = () => {
        const pct = parseInt(pctInput.value);
        const fd = parseInt(fdInput.value);
        if (isNaN(pct) || isNaN(fd)) {
          toast.error('Enter both values');
          return;
        }
        if (this._fdTable.some(r => r.pct === pct)) {
          toast.error(`${pct}% already exists`);
          return;
        }
        this._fdTable.push({ pct, fd });
        this._fdTable.sort((a, b) => a.pct - b.pct);
        this._renderFdTable();
        cleanup();
        resolve();
      };

      document.getElementById('fd-add-confirm').addEventListener('click', submit);
      document.getElementById('fd-add-cancel').addEventListener('click', () => { cleanup(); resolve(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(); } });

      const handleKey = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(); }
        if (e.key === 'Enter') submit();
      };
      document.addEventListener('keydown', handleKey);
    });
  },

  async _saveFdTable() {
    // Validate: sort by pct, check for duplicates
    this._fdTable.sort((a, b) => a.pct - b.pct);
    const dupes = this._fdTable.some((r, i) => i > 0 && r.pct === this._fdTable[i - 1].pct);
    if (dupes) {
      toast.error('Duplicate percentage values found. Please fix before saving.');
      return;
    }

    try {
      await dataService.setAppConfig('fd_table', this._fdTable);
      setFdTable(this._fdTable);
      toast.success('FD table saved');
      this._renderFdTable();
    } catch (err) {
      console.error('Failed to save FD table:', err);
      toast.error('Failed to save FD table');
    }
  },

  // ============================================
  // WHITELIST REVIEW QUEUE
  // ============================================

  async _loadWhitelistQueue() {
    try {
      const all = (this._players && this._players.length)
        ? this._players
        : await dataService.getPlayers();
      // Pending = not whitelisted yet AND not excluded AND not dismissed.
      // (excluded/ignored characters are out of the review queue regardless.)
      this._pendingWhitelist = all.filter(p => !p.whitelisted && !p.exclude && !p.whitelistIgnored);
    } catch (err) {
      console.error('Failed to load whitelist queue:', err);
      this._pendingWhitelist = [];
    }
    this._renderWhitelistQueue();
  },

  _renderWhitelistQueue() {
    const list = document.getElementById('admin-whitelist-list');
    const countEl = document.getElementById('admin-whitelist-count');
    if (!list) return;

    const pending = this._pendingWhitelist || [];
    if (countEl) countEl.textContent = pending.length ? `(${pending.length})` : '';

    if (pending.length === 0) {
      list.innerHTML = '<p class="empty-state">No new characters to review 🎉</p>';
      return;
    }

    const usersById = {};
    (this._users || []).forEach(u => { usersById[u.discordId] = u; });

    // Group by owner for easier review
    const sorted = [...pending].sort((a, b) => {
      const ownerA = (usersById[a.discordId]?.displayName || '~').toLowerCase();
      const ownerB = (usersById[b.discordId]?.displayName || '~').toLowerCase();
      if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
      return (a.name || '').localeCompare(b.name || '');
    });

    list.innerHTML = sorted.map(p => {
      const owner = usersById[p.discordId];
      const ownerName = escapeHtml(owner?.displayName || 'Unknown');
      const ownerAvatar = escapeHtml(owner?.avatarUrl || '/icons/avatar.svg');
      const acctTag = p.accountNumber > 1 ? ` <span class="acct-tag">Acct ${p.accountNumber}</span>` : '';
      return `
        <div class="admin-whitelist-row" data-player-id="${escapeHtml(p.id)}">
          <div class="admin-whitelist-info">
            <img src="${ownerAvatar}" alt="" class="admin-user-avatar" onerror="this.src='/icons/avatar.svg'">
            <div class="admin-whitelist-details">
              <span class="admin-whitelist-char">${escapeHtml(p.name)}${acctTag}</span>
              <span class="admin-whitelist-meta">${escapeHtml(p.role || '')} · Owner: ${ownerName}</span>
            </div>
          </div>
          <div class="admin-whitelist-actions">
            <button class="btn btn-sm btn-primary admin-whitelist-approve" data-player-id="${escapeHtml(p.id)}">In-Guild</button>
            <button class="btn btn-sm btn-secondary admin-whitelist-ignore" data-player-id="${escapeHtml(p.id)}">Dismiss</button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.admin-whitelist-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.playerId;
        btn.disabled = true;
        try {
          await dataService.togglePlayerWhitelist(id, true);
          const player = (this._pendingWhitelist || []).find(p => p.id === id);
          toast.success(`${player?.name || 'Character'} whitelisted`);
          this._pendingWhitelist = (this._pendingWhitelist || []).filter(p => p.id !== id);
          this._renderWhitelistQueue();
        } catch (err) {
          btn.disabled = false;
          toast.error(`Failed: ${err.message}`);
        }
      });
    });

    list.querySelectorAll('.admin-whitelist-ignore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.playerId;
        btn.disabled = true;
        try {
          await dataService.dismissPlayerReview(id);
          const player = (this._pendingWhitelist || []).find(p => p.id === id);
          toast.success(`${player?.name || 'Character'} dismissed`);
          this._pendingWhitelist = (this._pendingWhitelist || []).filter(p => p.id !== id);
          this._renderWhitelistQueue();
        } catch (err) {
          btn.disabled = false;
          toast.error(`Failed: ${err.message}`);
        }
      });
    });
  },

  // ============================================
  // CARD MAP
  // ============================================

  async _loadCardMap() {
    if (this._cardMapLoaded) {
      this._renderCardMap();
      return;
    }
    try {
      const [names, pageCount] = await Promise.all([
        dataService.getCardSlotNames(),
        dataService.getCardPageCount()
      ]);
      this._cardNames = names || {};
      this._cardPageCount = pageCount || DEFAULT_CARD_PAGES;
      this._cardMapLoaded = true;
    } catch (err) {
      console.error('Failed to load card map:', err);
      toast.error('Failed to load card map');
    }
    this._renderCardMap();
  },

  _renderCardMap() {
    const container = document.getElementById('admin-card-map');
    if (!container) return;

    const page = this._cardMapPage;
    const startIdx = (page - 1) * CARDS_PER_PAGE;

    let slotsHtml = '';
    for (let i = 0; i < CARDS_PER_PAGE; i++) {
      const slotIndex = startIdx + i;
      const name = this._cardNames[slotIndex] || '';
      slotsHtml += `
        <div class="admin-card-slot" data-slot-index="${slotIndex}">
          <span class="admin-card-slot-index">#${slotIndex + 1}</span>
          <input type="text" class="admin-card-slot-input" data-slot-index="${slotIndex}"
                 value="${escapeHtml(name)}" placeholder="Slot ${slotIndex + 1}" maxlength="40">
        </div>
      `;
    }

    container.innerHTML = `
      <div class="admin-card-slot-grid">${slotsHtml}</div>
      <div class="admin-card-pagination">
        ${renderPagination(page, this._cardPageCount)}
      </div>
    `;

    // Page switching — persist current inputs into _cardNames before switching
    bindPagination(container.querySelector('.pagination'), page, this._cardPageCount, (newPage) => {
      this._collectCardMapInputs();
      this._cardMapPage = newPage;
      this._renderCardMap();
    });

    // Live-update _cardNames on input so Save captures everything across pages
    container.querySelectorAll('.admin-card-slot-input').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.slotIndex, 10);
        const val = input.value.trim();
        if (val) this._cardNames[idx] = val;
        else delete this._cardNames[idx];
      });
    });

    // Disable remove button when on minimum
    const removeBtn = document.querySelector('.admin-card-remove-page-btn');
    if (removeBtn) removeBtn.disabled = this._cardPageCount <= 1;
    const addBtn = document.querySelector('.admin-card-add-page-btn');
    if (addBtn) addBtn.disabled = this._cardPageCount >= MAX_CARD_PAGES;
  },

  _collectCardMapInputs() {
    document.querySelectorAll('.admin-card-slot-input').forEach(input => {
      const idx = parseInt(input.dataset.slotIndex, 10);
      const val = input.value.trim();
      if (val) this._cardNames[idx] = val;
      else delete this._cardNames[idx];
    });
  },

  async _addCardPage() {
    if (this._cardPageCount >= MAX_CARD_PAGES) {
      toast.error(`Maximum ${MAX_CARD_PAGES} pages`);
      return;
    }
    this._collectCardMapInputs();
    const newCount = this._cardPageCount + 1;
    try {
      await dataService.saveCardPageCount(newCount);
      this._cardPageCount = newCount;
      this._cardMapPage = newCount; // jump to the new page
      toast.success(`Page ${newCount} added`);
      this._renderCardMap();
    } catch (err) {
      toast.error(`Failed to add page: ${err.message}`);
    }
  },

  async _removeCardPage() {
    if (this._cardPageCount <= 1) return;

    const pageToRemove = this._cardPageCount;
    const startIdx = (pageToRemove - 1) * CARDS_PER_PAGE;
    const endIdx = pageToRemove * CARDS_PER_PAGE;

    const confirmed = await modal.confirm(
      `Removing page ${pageToRemove} will delete its 16 slot names and every character's rarity data on those slots. This cannot be undone. Continue?`,
      {
        title: `Remove Card Page ${pageToRemove}`,
        confirmText: 'Remove Page',
        cancelText: 'Cancel',
        danger: true
      }
    );
    if (!confirmed) return;

    this._collectCardMapInputs();

    // Drop the names for the removed range
    const newNames = { ...this._cardNames };
    for (let i = startIdx; i < endIdx; i++) delete newNames[i];

    try {
      await Promise.all([
        dataService.deletePlayerCardsInRange(startIdx, endIdx),
        dataService.saveCardSlotNames(newNames),
        dataService.saveCardPageCount(pageToRemove - 1)
      ]);
      this._cardNames = newNames;
      this._cardPageCount = pageToRemove - 1;
      if (this._cardMapPage > this._cardPageCount) this._cardMapPage = this._cardPageCount;
      toast.success(`Page ${pageToRemove} removed`);
      this._renderCardMap();
    } catch (err) {
      toast.error(`Failed to remove page: ${err.message}`);
    }
  },

  async _saveCardMap() {
    this._collectCardMapInputs();
    try {
      await dataService.saveCardSlotNames(this._cardNames);
      toast.success('Card names saved');
    } catch (err) {
      toast.error(`Failed to save: ${err.message}`);
    }
  },

  // ============================================
  // USERS
  // ============================================

  async _loadUsers() {
    this._users = await dataService.getAppUsers();
  },

  async _loadPlayers() {
    try {
      this._players = await dataService.getPlayers();
    } catch (err) {
      console.error('Failed to load players:', err);
      this._players = [];
    }
  },

  // Characters owned by a user, ordered by account then name (for the avatar tooltip).
  _charactersForUser(discordId) {
    return (this._players || [])
      .filter(p => p.discordId === discordId)
      .sort((a, b) =>
        (a.accountNumber || 1) - (b.accountNumber || 1) ||
        (a.name || '').localeCompare(b.name || ''));
  },

  // Hover tooltip markup listing a user's characters (class icon + name).
  // Returns '' when the user has no characters so no empty box shows.
  _renderCharTooltip(discordId) {
    const chars = this._charactersForUser(discordId);
    if (chars.length === 0) return '';

    const renderRow = (c) => {
      const icon = c.role
        ? `<span class="admin-char-icon"><div class="class-sprite" style="${getClassSpriteStyle(c.role)}"></div></span>`
        : '<span class="admin-char-icon"></span>';
      return `<li class="admin-char-row">${icon}<span class="admin-char-name">${escapeHtml(c.name)}</span></li>`;
    };

    // Distinct accounts (already sorted by account in _charactersForUser).
    const accounts = [...new Set(chars.map(c => c.accountNumber || 1))];

    // Group under "Acct N" headers only when the user actually has more than one
    // account; otherwise keep a clean flat list with no labels.
    let body;
    if (accounts.length > 1) {
      body = accounts.map(acct => {
        const group = chars.filter(c => (c.accountNumber || 1) === acct);
        return `
          <div class="admin-char-acct-group">
            <div class="admin-char-acct-header">Acct ${acct}</div>
            <ul class="admin-char-tooltip-list">${group.map(renderRow).join('')}</ul>
          </div>`;
      }).join('');
    } else {
      body = `<ul class="admin-char-tooltip-list">${chars.map(renderRow).join('')}</ul>`;
    }

    return `
      <div class="admin-char-tooltip">
        <div class="admin-char-tooltip-title">${chars.length} character${chars.length === 1 ? '' : 's'}</div>
        ${body}
      </div>
    `;
  },

  _sortUsers(users) {
    return [...users].sort((a, b) => {
      let cmp;
      if (this._sortBy === 'date') {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        cmp = da - db;
      } else {
        cmp = (a.displayName || '').localeCompare(b.displayName || '');
      }
      return this._sortAsc ? cmp : -cmp;
    });
  },

  // A user counts as "new" if they joined within the last 7 days.
  _isNewUser(user) {
    if (!user.createdAt) return false;
    const days = (Date.now() - new Date(user.createdAt).getTime()) / 86400000;
    return days >= 0 && days <= 7;
  },

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  _renderUsers() {
    const nonAdmins = this._sortUsers(this._users.filter(u => u.role !== 'admin'));
    const admins = this._sortUsers(this._users.filter(u => u.role === 'admin'));

    const usersList = document.getElementById('admin-users-list');
    const adminsList = document.getElementById('admin-admins-list');

    this._renderUserList(usersList, nonAdmins, 'No users found.');
    this._renderUserList(adminsList, admins, 'No admins found.');
  },

  // Save an exclude sub-field (label / reason) on blur when its value changed.
  // optionKey is what updateUserExclude expects; userProp is the local cache field.
  _bindExcludeFieldSave(container, selector, optionKey, userProp, successMsg) {
    container.querySelectorAll(selector).forEach(input => {
      input.addEventListener('blur', async (e) => {
        const discordId = e.target.dataset.discordId;
        const user = this._users.find(u => u.discordId === discordId);
        const newValue = e.target.value.trim();
        if (newValue === (user[userProp] || '')) return;
        try {
          await dataService.updateUserExclude(discordId, user.exclude, { [optionKey]: newValue });
          user[userProp] = newValue;
          toast.success(successMsg);
        } catch (err) {
          console.error(`Failed to update ${optionKey}:`, err);
          toast.error('Failed to update');
          e.target.value = user[userProp] || '';
        }
      });
    });
  },

  _renderUserList(container, users, emptyText) {
    if (!container) return;

    if (users.length === 0) {
      container.innerHTML = `<p class="empty-state">${emptyText}</p>`;
      return;
    }

    const currentUserId = dataService.getUser()?.id;

    const isOtherAdmin = (user) => user.role === 'admin' && user.discordId !== currentUserId;

    container.innerHTML = users.map(user => {
      const discordId = escapeHtml(user.discordId);
      return `
      <div class="admin-user-row" data-discord-id="${discordId}">
        <div class="admin-user-info">
          <div class="admin-user-avatar-wrap">
            <img src="${escapeHtml(user.avatarUrl || '/icons/avatar.svg')}" alt="" class="admin-user-avatar" onerror="this.src='/icons/avatar.svg'">
            ${this._renderCharTooltip(user.discordId)}
          </div>
          <div class="admin-user-details">
            <div class="admin-user-name-row">
              <span class="admin-user-name ${isOtherAdmin(user) ? 'not-editable' : ''}" data-discord-id="${discordId}" ${isOtherAdmin(user) ? '' : 'title="Click to edit name"'}>${escapeHtml(user.displayName)}</span>
              ${this._isNewUser(user) ? '<span class="admin-user-new-badge">NEW</span>' : ''}
            </div>
            <span class="admin-user-username">${escapeHtml(user.username)}</span>
            ${user.createdAt ? `<span class="admin-user-joined">Joined ${this._formatDate(user.createdAt)}</span>` : ''}
          </div>
        </div>
        <div class="admin-user-actions">
          <label class="toggle-switch tooltip-wrap" data-tooltip="Exclude this user's characters from recruiting and dim them in the lineup pool">
            <input type="checkbox" class="admin-exclude-checkbox" data-discord-id="${discordId}" ${user.exclude ? 'checked' : ''} ${isOtherAdmin(user) ? 'disabled' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-label">Exclude</span>
          </label>
          <select class="admin-role-select" data-discord-id="${discordId}" ${user.discordId === currentUserId || isOtherAdmin(user) ? 'disabled' : ''}>
            <option value="guest" ${user.role === 'guest' ? 'selected' : ''}>Guest</option>
            <option value="guildmate" ${user.role === 'guildmate' ? 'selected' : ''}>Guildmate</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          ${user.role !== 'admin' ? `<button class="btn btn-danger btn-sm admin-delete-btn" data-discord-id="${discordId}">Delete</button>` : ''}
        </div>
        <div class="admin-exclude-fields" data-discord-id="${discordId}" style="display: ${user.exclude ? 'flex' : 'none'};">
          <input type="text" class="admin-exclude-label" data-discord-id="${discordId}" placeholder="Excluded" maxlength="20" value="${escapeHtml(user.excludeLabel || '')}">
          <input type="text" class="admin-exclude-reason" data-discord-id="${discordId}" placeholder="Just an alt in the guild" maxlength="120" value="${escapeHtml(user.excludeReason || '')}">
        </div>
      </div>
    `;
    }).join('');

    // Exclude toggle listeners
    container.querySelectorAll('.admin-exclude-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', async (e) => {
        const discordId = e.target.dataset.discordId;
        const exclude = e.target.checked;
        const user = this._users.find(u => u.discordId === discordId);
        const fields = container.querySelector(`.admin-exclude-fields[data-discord-id="${discordId}"]`);
        if (fields) fields.style.display = exclude ? 'flex' : 'none';
        try {
          await dataService.updateUserExclude(discordId, exclude);
          user.exclude = exclude;
          toast.success(`${user.displayName} ${exclude ? 'excluded' : 'included'}`);
        } catch (err) {
          console.error('Failed to update exclude:', err);
          toast.error('Failed to update');
          e.target.checked = !exclude;
          if (fields) fields.style.display = !exclude ? 'flex' : 'none';
        }
      });
    });

    // Exclude label / reason listeners — save on blur if changed
    this._bindExcludeFieldSave(container, '.admin-exclude-label', 'label', 'excludeLabel', 'Badge label updated');
    this._bindExcludeFieldSave(container, '.admin-exclude-reason', 'reason', 'excludeReason', 'Reason updated');

    // Role change listeners
    container.querySelectorAll('.admin-role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const discordId = e.target.dataset.discordId;
        const newRole = e.target.value;
        const user = this._users.find(u => u.discordId === discordId);
        try {
          await dataService.updateUserRole(discordId, newRole);
          user.role = newRole;
          toast.success(`${user.displayName} is now ${newRole}`);
          this._renderUsers();
        } catch (err) {
          console.error('Failed to update role:', err);
          toast.error('Failed to update role');
          e.target.value = user.role;
        }
      });
    });

    // Delete listeners
    container.querySelectorAll('.admin-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const discordId = btn.dataset.discordId;
        const user = this._users.find(u => u.discordId === discordId);
        const confirmed = await modal.confirm(`Delete user "${user.displayName}"? This also deletes all of their characters and cannot be undone.`, {
          title: 'Delete User',
          confirmText: 'Delete',
          danger: true
        });
        if (!confirmed) return;

        try {
          await dataService.deleteAppUser(discordId);
          toast.success(`Deleted ${user.displayName}`);
          this._users = this._users.filter(u => u.discordId !== discordId);
          this._renderUsers();
        } catch (err) {
          console.error('Failed to delete user:', err);
          toast.error('Failed to delete user');
        }
      });
    });

    // Name edit listeners
    container.querySelectorAll('.admin-user-name').forEach(span => {
      span.addEventListener('click', (e) => {
        const discordId = e.target.dataset.discordId;
        const user = this._users.find(u => u.discordId === discordId);
        if (user.role === 'admin' && user.discordId !== currentUserId) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'admin-name-input';
        input.value = user.displayName;
        input.maxLength = 32;
        span.replaceWith(input);
        input.focus();
        input.select();

        const save = async () => {
          const newName = input.value.trim();
          if (!newName || newName === user.displayName) {
            this._renderUsers();
            return;
          }
          try {
            await dataService.adminUpdateDisplayName(discordId, newName);
            user.displayName = newName;
            toast.success(`Renamed to ${newName}`);
            this._renderUsers();
          } catch (err) {
            console.error('Failed to update name:', err);
            toast.error('Failed to update name');
            this._renderUsers();
          }
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') input.blur();
          if (ev.key === 'Escape') { input.value = user.displayName; input.blur(); }
        });
      });
    });
  }
};
