import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { setFdTable } from '../constants.js';

export const AdminPage = {
  _users: [],
  _sortBy: 'name', // 'name' or 'date'
  _sortAsc: true,
  _activeTab: 'users',
  _fdTable: [],

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
        </div>
        <div class="admin-tab-content" id="admin-tab-users">
          <div class="section">
            <div class="admin-section-header">
              <h2>Users</h2>
              <div class="admin-sort-buttons">
                <button class="admin-sort-btn active" data-sort="name">Name</button>
                <button class="admin-sort-btn" data-sort="date">Date Joined</button>
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

    await this._loadUsers();
    this._renderUsers();
    this._loadFdTable();
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
  // USERS
  // ============================================

  async _loadUsers() {
    this._users = await dataService.getAppUsers();
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

  _renderUserList(container, users, emptyText) {
    if (!container) return;

    if (users.length === 0) {
      container.innerHTML = `<p class="empty-state">${emptyText}</p>`;
      return;
    }

    const currentUserId = dataService.getUser()?.id;

    const isOtherAdmin = (user) => user.role === 'admin' && user.discordId !== currentUserId;

    container.innerHTML = users.map(user => `
      <div class="admin-user-row" data-discord-id="${user.discordId}">
        <div class="admin-user-info">
          <img src="${user.avatarUrl || '/icons/avatar.svg'}" alt="" class="admin-user-avatar" onerror="this.src='/icons/avatar.svg'">
          <div class="admin-user-details">
            <span class="admin-user-name ${isOtherAdmin(user) ? 'not-editable' : ''}" data-discord-id="${user.discordId}" ${isOtherAdmin(user) ? '' : 'title="Click to edit name"'}>${user.displayName}</span>
            <span class="admin-user-username">${user.username}</span>
            ${user.createdAt ? `<span class="admin-user-joined">Joined ${this._formatDate(user.createdAt)}</span>` : ''}
          </div>
        </div>
        <div class="admin-user-actions">
          <label class="toggle-switch tooltip-wrap" data-tooltip="Exclude this user's characters from recruiting and dim them in the lineup pool">
            <input type="checkbox" class="admin-exclude-checkbox" data-discord-id="${user.discordId}" ${user.exclude ? 'checked' : ''} ${isOtherAdmin(user) ? 'disabled' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-label">Exclude</span>
          </label>
          <select class="admin-role-select" data-discord-id="${user.discordId}" ${user.discordId === currentUserId || isOtherAdmin(user) ? 'disabled' : ''}>
            <option value="guest" ${user.role === 'guest' ? 'selected' : ''}>Guest</option>
            <option value="guildmate" ${user.role === 'guildmate' ? 'selected' : ''}>Guildmate</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          ${user.role !== 'admin' ? `<button class="btn btn-danger btn-sm admin-delete-btn" data-discord-id="${user.discordId}">Delete</button>` : ''}
        </div>
        <div class="admin-exclude-fields" data-discord-id="${user.discordId}" style="display: ${user.exclude ? 'flex' : 'none'};">
          <input type="text" class="admin-exclude-label" data-discord-id="${user.discordId}" placeholder="Excluded" maxlength="20" value="${(user.excludeLabel || '').replace(/"/g, '&quot;')}">
          <input type="text" class="admin-exclude-reason" data-discord-id="${user.discordId}" placeholder="Just an alt in the guild" maxlength="120" value="${(user.excludeReason || '').replace(/"/g, '&quot;')}">
        </div>
      </div>
    `).join('');

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

    // Exclude label listeners — save on blur if changed
    container.querySelectorAll('.admin-exclude-label').forEach(input => {
      input.addEventListener('blur', async (e) => {
        const discordId = e.target.dataset.discordId;
        const user = this._users.find(u => u.discordId === discordId);
        const newLabel = e.target.value.trim();
        if (newLabel === (user.excludeLabel || '')) return;
        try {
          await dataService.updateUserExclude(discordId, user.exclude, { label: newLabel });
          user.excludeLabel = newLabel;
          toast.success('Badge label updated');
        } catch (err) {
          console.error('Failed to update label:', err);
          toast.error('Failed to update');
          e.target.value = user.excludeLabel || '';
        }
      });
    });

    // Exclude reason listeners — save on blur if changed
    container.querySelectorAll('.admin-exclude-reason').forEach(input => {
      input.addEventListener('blur', async (e) => {
        const discordId = e.target.dataset.discordId;
        const user = this._users.find(u => u.discordId === discordId);
        const newReason = e.target.value.trim();
        if (newReason === (user.excludeReason || '')) return;
        try {
          await dataService.updateUserExclude(discordId, user.exclude, { reason: newReason });
          user.excludeReason = newReason;
          toast.success('Reason updated');
        } catch (err) {
          console.error('Failed to update reason:', err);
          toast.error('Failed to update');
          e.target.value = user.excludeReason || '';
        }
      });
    });

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
        const confirmed = await modal.confirm(`Delete user "${user.displayName}"? This cannot be undone.`, {
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
