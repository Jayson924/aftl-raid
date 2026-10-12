import { dataService } from '../data.js';
import { toast } from '../toast.js';
import { modal } from '../modal.js';
import { setPowerIndexMax, POWER_INDEX_MAX_DEFAULT, getClassSpriteStyle, calculateGearscore, getGearscoreTier } from '../constants.js';
import { renderChipTipBody, initChipTooltip } from '../chip-tooltip.js';

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

  async render(container) {
    if (!dataService.isAdmin()) {
      container.innerHTML = '<p>Admin access required.</p>';
      return;
    }

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-header">
          <h1 class="page-title">Admin</h1>
          <nav class="admin-tabs">
            <button class="admin-tab active" data-tab="users">Users</button>
            <button class="admin-tab" data-tab="new-characters">New Characters <span class="admin-pending-count" id="admin-whitelist-count"></span></button>
            <button class="admin-tab" data-tab="settings">Settings</button>
          </nav>
        </div>

        <div class="admin-tab-content" id="admin-tab-users">
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

        <div class="admin-tab-content" id="admin-tab-new-characters" style="display:none">
          <div class="section" id="admin-whitelist-section">
            <p class="admin-fd-desc">Characters that haven't been confirmed as in-guild. Mark as in-guild to grant access to in-guild features (or if guild friend, kayo na bahala :) pang incentivise lang naman natin na ipasok mga characters sa guild)</p>
            <div id="admin-whitelist-list" class="admin-whitelist-list">
              <p class="loading">Loading...</p>
            </div>
          </div>
        </div>

        <div class="admin-tab-content" id="admin-tab-settings" style="display:none">
          <div class="section">
            <h2>Power Index</h2>
            <p class="admin-fd-desc">Raw power (ATK × FD × crit × element) that counts as 100 on the power index. Set it a little above the strongest character.</p>
            <div class="admin-power-row">
              <input type="number" id="admin-power-max" min="1" step="1000" placeholder="${POWER_INDEX_MAX_DEFAULT}" />
              <button class="btn btn-accent admin-power-save-btn">Save</button>
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

    document.querySelector('.admin-power-save-btn').addEventListener('click', () => this._savePowerIndexMax());

    await this._loadUsers();
    await this._loadPlayers();
    this._renderUsers();
    initChipTooltip();
    this._loadPowerIndexMax();
    this._loadWhitelistQueue();
  },

  // ============================================
  // POWER INDEX
  // ============================================

  async _loadPowerIndexMax() {
    try {
      const saved = await dataService.getAppConfig('power_index_max');
      const input = document.getElementById('admin-power-max');
      if (input && saved) input.value = saved;
    } catch (err) {
      console.error('Failed to load power index max:', err);
    }
  },

  async _savePowerIndexMax() {
    const value = parseInt(document.getElementById('admin-power-max')?.value, 10);
    if (!value || value <= 0) {
      toast.error('Enter a positive number');
      return;
    }
    try {
      await dataService.setAppConfig('power_index_max', value);
      setPowerIndexMax(value);
      toast.success('Power index max saved');
    } catch (err) {
      console.error('Failed to save power index max:', err);
      toast.error('Failed to save power index max');
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
            <button class="btn btn-sm btn-accent admin-whitelist-approve" data-player-id="${escapeHtml(p.id)}">In-Guild</button>
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

  // A user's characters as chips: class icon and name; hovering shows class, gear score and gear.
  _renderCharChips(discordId) {
    const chars = this._charactersForUser(discordId);
    if (chars.length === 0) return '<p class="admin-user-nochars">No characters</p>';
    const multiAccount = new Set(chars.map(c => c.accountNumber || 1)).size > 1;
    return `<div class="admin-char-chips">${chars.map(c => {
      const gs = calculateGearscore(c);
      const tier = getGearscoreTier(gs);
      const acct = multiAccount ? `Acct ${c.accountNumber || 1}` : '';
      const head = `
        <div class="chip-tip__head">
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.role || 'No class')}${acct ? ` · ${acct}` : ''}</span>
          <span class="gs-inline" style="color: ${tier.color}; background: ${tier.bg};">${gs}</span>
        </div>`;
      const tip = (head + renderChipTipBody(c)).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `
        <span class="admin-char-chip has-chip-tip" data-chip-tip-html="${tip}">
          <span class="admin-char-icon">${c.role ? `<span class="class-sprite" style="${getClassSpriteStyle(c.role)}"></span>` : ''}</span>
          <span class="admin-char-name">${escapeHtml(c.name)}</span>
          ${acct ? `<span class="admin-char-acct">${c.accountNumber}</span>` : ''}
        </span>`;
    }).join('')}</div>`;
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

    // Other admins are locked, except for the site owner, who can change their role.
    const isOwner = !!currentUserId && currentUserId === import.meta.env.VITE_OWNER_DISCORD_ID;
    const isOtherAdmin = (user) => user.role === 'admin' && user.discordId !== currentUserId && !isOwner;

    container.innerHTML = users.map(user => {
      const discordId = escapeHtml(user.discordId);
      return `
      <div class="admin-user-row" data-discord-id="${discordId}">
        <div class="admin-user-info">
          <img src="${escapeHtml(user.avatarUrl || '/icons/avatar.svg')}" alt="" class="admin-user-avatar" onerror="this.src='/icons/avatar.svg'">
          <div class="admin-user-details">
            <div class="admin-user-name-row">
              <span class="admin-user-name ${isOtherAdmin(user) ? 'not-editable' : ''}" data-discord-id="${discordId}" ${isOtherAdmin(user) ? '' : 'title="Click to edit name"'}>${escapeHtml(user.displayName)}</span>
              ${this._isNewUser(user) ? '<span class="admin-user-new-badge">NEW</span>' : ''}
            </div>
            <span class="admin-user-username">${escapeHtml(user.username)}</span>
            ${user.createdAt ? `<span class="admin-user-joined">Joined ${this._formatDate(user.createdAt)}</span>` : ''}
          </div>
        </div>
        ${this._renderCharChips(user.discordId)}
        <div class="admin-user-actions">
          <label class="toggle-switch tooltip-wrap" data-tooltip="Exclude this user's characters from recruiting and dim them in the lineup pool">
            <input type="checkbox" class="admin-exclude-checkbox" data-discord-id="${discordId}" ${user.exclude ? 'checked' : ''} ${isOtherAdmin(user) ? 'disabled' : ''}>
            <span class="toggle-slider"></span>
            <span class="toggle-label">Exclude</span>
          </label>
          <select class="admin-role-select" data-discord-id="${discordId}" ${user.discordId === currentUserId || isOtherAdmin(user) ? 'disabled' : ''}>
            <option value="guest" ${user.role === 'guest' ? 'selected' : ''}>Guest</option>
            <option value="guildmate" ${user.role === 'guildmate' ? 'selected' : ''}>Guildmate</option>
            <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          ${user.role !== 'admin' ? `<button class="btn btn-danger-ghost btn-sm admin-delete-btn" data-discord-id="${discordId}">Delete</button>` : ''}
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
        if (user.role === 'admin') {
          const ok = await modal.confirm(`Remove admin from ${escapeHtml(user.displayName)}? They become ${newRole}.`, { title: 'Remove Admin', confirmText: 'Remove admin', danger: true });
          if (!ok) { e.target.value = user.role; return; }
        }
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
        let preview;
        try {
          preview = await dataService.previewUserDelete(discordId);
        } catch (err) {
          toast.error(err.message);
          return;
        }

        // Show exactly what goes, then make the admin type the name.
        const c = preview.counts;
        const lines = [
          [c.characters, 'character'], [c.cards, 'card'], [c.personalRaids, 'personal raid'],
          [c.shoppingList, 'shopping-list item'], [c.savedBuilds, 'saved build'], [c.meterLinks, 'meter link'],
          [c.characterGroups, 'character group'], [c.lineupSlots, 'lineup slot']
        ].filter(([n]) => n > 0).map(([n, label]) => `<span class="admin-delete-item">${n} ${label}${n === 1 ? '' : 's'}</span>`).join('');
        const name = user.displayName;
        const summary = `
          <span class="admin-delete-summary">
            Deletes <strong>${escapeHtml(name)}</strong>${preview.characters.length ? ` (${preview.characters.map(escapeHtml).join(', ')})` : ''} and:
          </span>
          ${lines ? `<span class="admin-delete-list">${lines}</span>` : '<span class="admin-delete-summary">Nothing else is linked to them.</span>'}
          ${preview.lineups.length ? `<span class="admin-delete-summary">Lineups losing a slot: ${preview.lineups.map(escapeHtml).join(', ')}</span>` : ''}
          <span class="admin-delete-summary">Loot history is kept. This cannot be undone.</span>`;
        // The site owner confirms with one click; other admins type the name.
        if (dataService.getUser()?.id === import.meta.env.VITE_OWNER_DISCORD_ID) {
          if (!await modal.confirm(summary, { title: 'Delete User', confirmText: 'Delete', danger: true })) return;
        } else {
          const typed = await modal.prompt(`${summary}
            <span class="admin-delete-summary">Type the name to confirm.</span>
          `, { title: 'Delete User', okText: 'Delete', placeholder: name, danger: true });
          if (typed === null) return;
          if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) {
            toast.error('The name did not match; nothing was deleted');
            return;
          }
        }

        try {
          await dataService.deleteAppUser(discordId);
          toast.success(`Deleted ${name}`);
          this._users = this._users.filter(u => u.discordId !== discordId);
          this._renderUsers();
        } catch (err) {
          console.error('Failed to delete user:', err);
          toast.error(err.message || 'Failed to delete user');
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
