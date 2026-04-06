import { dataService } from '../data.js';

/**
 * Arena layout shell — wraps all /arena* routes with a fantasy-themed header.
 * Toggles body.arena-mode class for styling overrides.
 */
export const ArenaShell = {
  currentRoute: null,

  activate() {
    document.body.classList.add('arena-mode');
    // Hide main nav when in arena
    const mainNav = document.querySelector('nav.main-nav');
    if (mainNav) mainNav.style.display = 'none';
  },

  deactivate() {
    document.body.classList.remove('arena-mode');
    const mainNav = document.querySelector('nav.main-nav');
    if (mainNav) mainNav.style.display = '';
  },

  renderHeader(container, activeRoute) {
    this.currentRoute = activeRoute;

    const displayName = dataService.getDisplayName();
    const avatarUrl = dataService.getAvatarUrl();
    const isAdmin = dataService.isAdmin();

    const header = document.createElement('header');
    header.className = 'arena-header';
    header.innerHTML = `
      <h1 class="arena-title">
        <span class="arena-title-icon">&#9876;</span>
        Guild Arena
      </h1>
      <nav class="arena-nav">
        <a href="#" class="arena-nav-link ${activeRoute === 'arena' ? 'active' : ''}" data-route="arena">Hub</a>
        ${isAdmin ? `<a href="#" class="arena-nav-link ${activeRoute === 'arena-setup' ? 'active' : ''}" data-route="arena-setup">Setup</a>` : ''}
        <a href="#" class="arena-back-link" data-route="lineups">
          <span class="back-arrow">&larr;</span> Back to Raid Manager
        </a>
      </nav>
      ${displayName ? `
        <div class="arena-user-info">
          <img src="${avatarUrl || '/icons/avatar.svg'}" alt="" class="arena-user-avatar" onerror="this.src='/icons/avatar.svg'">
          <span>${displayName}</span>
        </div>
      ` : ''}
    `;

    container.appendChild(header);
  }
};
