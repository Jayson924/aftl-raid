import { dataService } from '../data.js';
import { toast } from '../toast.js';

export const AdminPage = {
  _users: [],

  async render(container) {
    if (!dataService.isAdmin()) {
      container.innerHTML = '<p>Admin access required.</p>';
      return;
    }

    container.innerHTML = `
      <div class="admin-page">
        <h1 class="page-title">Admin</h1>
        <div class="section">
          <h2>Users</h2>
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
    `;

    await this._loadUsers();
    this._renderUsers();
  },

  async _loadUsers() {
    this._users = await dataService.getAppUsers();
  },

  _renderUsers() {
    const nonAdmins = this._users.filter(u => u.role !== 'admin');
    const admins = this._users.filter(u => u.role === 'admin');

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
          </div>
        </div>
        <div class="admin-user-actions">
          <select class="admin-role-select" data-discord-id="${user.discordId}" ${user.discordId === currentUserId || isOtherAdmin(user) ? 'disabled' : ''}>
            <option value="guest" ${user.role === 'guest' ? 'selected' : ''}>Guest</option>
            <option value="player" ${user.role === 'player' ? 'selected' : ''}>Player</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          <button class="btn btn-danger btn-sm admin-delete-btn" data-discord-id="${user.discordId}"
            ${user.discordId === currentUserId || isOtherAdmin(user) ? 'disabled' : ''}>Delete</button>
        </div>
      </div>
    `).join('');

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
        if (!confirm(`Delete user "${user.displayName}"? This cannot be undone.`)) return;

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
