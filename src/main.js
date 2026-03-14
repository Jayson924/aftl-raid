import './styles/style.scss'
import { router } from './router.js'
import { LineupsPage } from './pages/lineups.jsx'
import { PlayersPage } from './pages/players.jsx'
import { LineupEditorPage } from './pages/lineup-editor.jsx'
import { EnhancementPage } from './pages/enhancement.jsx'
import { SpendingGuidePage } from './pages/spending-guide.jsx'
import { MyRaidsPage } from './pages/my-raids.jsx'
import { dataService } from './data.js'
import { toast } from './toast.js'

// Initialize the app
async function initApp() {
  // Handle Discord OAuth callback
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    toast.error('Login failed: ' + (params.get('error_description') || error));
    window.history.replaceState({}, '', window.location.pathname);
  } else if (code) {
    try {
      await dataService.handleOAuthCallback(code);
      window.history.replaceState({}, '', window.location.pathname);
    } catch (err) {
      console.error('OAuth error:', err);
      toast.error('Login failed: ' + err.message);
      window.history.replaceState({}, '', window.location.pathname);
    }
  } else {
    // No OAuth callback - load existing session
    await dataService.loadSession();
  }

  // Listen for auth state changes
  dataService.onAuthStateChange((event, user) => {
    if (event === 'SIGNED_IN') {
      toast.success(`Welcome, ${dataService.getDisplayName()}!`);
      renderNavigation();
      router.refresh();
    } else if (event === 'SIGNED_OUT') {
      renderNavigation();
      router.navigate('lineups');
    }
  });

  // Create navigation
  renderNavigation();

  // Register routes
  router.register('lineups', LineupsPage);
  router.register('characters', PlayersPage); // Public - anyone can view
  router.register('editor', LineupEditorPage, 'admin'); // Requires admin role only
  router.register('enhancement', EnhancementPage); // No auth required
  router.register('lavish', SpendingGuidePage); // No auth required
  router.register('my-raids', MyRaidsPage, 'player'); // Any authenticated user

  // Set up auth required handler
  router.setAuthRequiredHandler(showLoginModal);

  // Initialize router
  router.init();
}

function renderNavigation() {
  const existingNav = document.querySelector('nav.main-nav');
  if (existingNav) {
    existingNav.remove();
  }

  const nav = document.createElement('nav');
  nav.className = 'main-nav';

  const isAuthenticated = dataService.isAuthenticated();
  const isAdmin = dataService.isAdmin();
  const isPlayer = dataService.isPlayer();
  const displayName = dataService.getDisplayName();
  const avatarUrl = dataService.getAvatarUrl();

  nav.innerHTML = `
    <div class="nav-container">
      <h1 class="app-title">AFTL Raid Manager <span style="font-size: 0.5em; color: #888; font-weight: normal;">v2.0.15</span></h1>
      <button class="hamburger-btn" id="hamburger-btn" aria-label="Toggle menu">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
      <ul class="nav-links" id="nav-links">
        <li><a href="#" class="nav-link" data-route="lineups">Lineups</a></li>
        ${isAuthenticated ? `
          <li><a href="#" class="nav-link" data-route="characters">Characters</a></li>
        ` : ''}
        ${isAdmin ? `
          <li><a href="#" class="nav-link" data-route="editor">Lineup Editor</a></li>
        ` : ''}
        <li><a href="#" class="nav-link" data-route="enhancement">Enhancement</a></li>
        <li><a href="#" class="nav-link" data-route="lavish">Gold/Lavish</a></li>
        <li class="nav-auth-mobile">
          ${isAuthenticated ? `
            <a href="#" class="nav-link" id="my-raids-btn-mobile">My Raids</a>
            <a href="#" class="nav-link" id="change-name-btn-mobile">Change Name</a>
            <a href="#" class="nav-link" id="logout-btn-mobile">Logout (${displayName})</a>
          ` : `
            <a href="#" class="nav-link" id="login-btn-mobile">Login with Discord</a>
          `}
        </li>
      </ul>
      <div class="nav-actions">
        ${isAuthenticated ? `
          <div class="user-dropdown" id="user-dropdown">
            <button class="user-dropdown-toggle" id="user-dropdown-toggle" title="${displayName} (${dataService.getUserRole()})">
              ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}" class="user-avatar">` : ''}
              <span class="user-name">${displayName}</span>
              <span class="dropdown-arrow">▼</span>
            </button>
            <div class="user-dropdown-menu" id="user-dropdown-menu">
              <div class="dropdown-header">
                <span class="dropdown-role">${dataService.getUserRole()}</span>
              </div>
              <button class="dropdown-item" id="my-raids-btn">My Raids</button>
              <button class="dropdown-item" id="change-name-btn">Change Name</button>
              <button class="dropdown-item" id="logout-btn">Logout</button>
            </div>
          </div>
        ` : `
          <button id="login-btn" class="btn-discord" title="Login with Discord">
            <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M60.1 4.9C55.6 2.8 50.7 1.3 45.7.4c-.1 0-.2 0-.2.1-.6 1.1-1.3 2.6-1.8 3.7-5.5-.8-10.9-.8-16.3 0-.5-1.2-1.2-2.6-1.8-3.7 0-.1-.1-.1-.2-.1-5.1.9-9.9 2.4-14.5 4.5 0 0-.1 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2 6.1 4.5 12 7.2 17.7 9 .1 0 .2 0 .2-.1 1.4-1.9 2.6-3.8 3.6-5.9.1-.1 0-.3-.1-.3-2-.8-3.8-1.7-5.6-2.7-.1-.1-.1-.3 0-.4.4-.3.8-.6 1.1-.9.1-.1.2-.1.2 0 11.6 5.3 24.2 5.3 35.7 0 .1 0 .2 0 .2 0 .4.3.7.6 1.1.9.1.1.1.3 0 .4-1.8 1-3.6 1.9-5.6 2.7-.1 0-.2.2-.1.3 1.1 2.1 2.3 4.1 3.6 5.9 0 .1.1.1.2.1 5.7-1.8 11.6-4.5 17.7-9 0 0 .1-.1.1-.2 1.4-14.5-2.4-27.1-10-38.3 0 0 0-.1-.1-.1zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.4 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2z"/>
            </svg>
            <span>Login</span>
          </button>
        `}
      </div>
    </div>
  `;

  document.body.insertBefore(nav, document.querySelector('#app'));

  // Hamburger menu toggle
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const navLinks = document.getElementById('nav-links');

  hamburgerBtn.addEventListener('click', () => {
    hamburgerBtn.classList.toggle('active');
    navLinks.classList.toggle('open');
  });

  // Close menu when a link is clicked
  navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target) && navLinks.classList.contains('open')) {
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
    }
  });

  // Login/Logout buttons (desktop)
  if (isAuthenticated) {
    const dropdownToggle = document.getElementById('user-dropdown-toggle');
    const dropdownMenu = document.getElementById('user-dropdown-menu');

    // Toggle dropdown on click
    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('open');
      dropdownToggle.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdownToggle.contains(e.target) && !dropdownMenu.contains(e.target)) {
        dropdownMenu.classList.remove('open');
        dropdownToggle.classList.remove('open');
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await dataService.signOut();
      toast.info('Bye bye na');
      renderNavigation();
      router.navigate('lineups');
    });

    document.getElementById('my-raids-btn').addEventListener('click', () => {
      dropdownMenu.classList.remove('open');
      dropdownToggle.classList.remove('open');
      router.navigate('my-raids');
    });

    document.getElementById('change-name-btn').addEventListener('click', () => {
      dropdownMenu.classList.remove('open');
      dropdownToggle.classList.remove('open');
      showChangeNameModal();
    });
  } else {
    document.getElementById('login-btn').addEventListener('click', handleDiscordLogin);
  }

  // Login/Logout buttons (mobile)
  if (isAuthenticated) {
    document.getElementById('my-raids-btn-mobile').addEventListener('click', (e) => {
      e.preventDefault();
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
      router.navigate('my-raids');
    });

    document.getElementById('change-name-btn-mobile').addEventListener('click', (e) => {
      e.preventDefault();
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
      showChangeNameModal();
    });

    document.getElementById('logout-btn-mobile').addEventListener('click', async (e) => {
      e.preventDefault();
      await dataService.signOut();
      toast.info('Bye bye na');
      renderNavigation();
      router.navigate('lineups');
    });
  } else {
    document.getElementById('login-btn-mobile').addEventListener('click', (e) => {
      e.preventDefault();
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
      handleDiscordLogin();
    });
  }
}

async function handleDiscordLogin() {
  try {
    toast.info('Redirecting to Discord...');
    await dataService.signInWithDiscord();
  } catch (error) {
    console.error('Discord login error:', error);
    toast.error('Failed to connect to Discord');
  }
}

function showChangeNameModal() {
  const currentName = dataService.getDisplayName();
  const modalElement = document.createElement('div');
  modalElement.className = 'modal';
  modalElement.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <h2>Change Display Name</h2>
      <div class="form-group">
        <label for="new-display-name">Display Name</label>
        <input type="text" id="new-display-name" value="${currentName || ''}" maxlength="32" placeholder="Enter your display name">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancel-name-btn">Cancel</button>
        <button type="button" class="btn btn-primary" id="save-name-btn">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);

  const input = document.getElementById('new-display-name');
  input.focus();
  input.select();

  document.getElementById('cancel-name-btn').addEventListener('click', () => {
    modalElement.remove();
  });

  document.getElementById('save-name-btn').addEventListener('click', async () => {
    const newName = input.value.trim();
    if (!newName) {
      toast.error('Display name cannot be empty');
      return;
    }

    try {
      await dataService.updateDisplayName(newName);
      toast.success('Display name updated!');
      modalElement.remove();
      renderNavigation();
    } catch (error) {
      toast.error(`Failed to update name: ${error.message}`);
    }
  });

  // Allow Enter to save
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('save-name-btn').click();
    } else if (e.key === 'Escape') {
      modalElement.remove();
    }
  });

  // Close on backdrop click
  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      modalElement.remove();
    }
  });
}

function showLoginModal() {
  const modalElement = document.createElement('div');
  modalElement.className = 'modal';
  modalElement.innerHTML = `
    <div class="modal-content login-modal">
      <h2>Login</h2>
      <p>Sign in with your Discord account to access protected pages.</p>
      <div class="form-actions" style="flex-direction: column; gap: 12px;">
        <button type="button" class="btn btn-discord-large" id="discord-login-btn">
          <svg width="24" height="18" viewBox="0 0 71 55" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M60.1 4.9C55.6 2.8 50.7 1.3 45.7.4c-.1 0-.2 0-.2.1-.6 1.1-1.3 2.6-1.8 3.7-5.5-.8-10.9-.8-16.3 0-.5-1.2-1.2-2.6-1.8-3.7 0-.1-.1-.1-.2-.1-5.1.9-9.9 2.4-14.5 4.5 0 0-.1 0-.1.1C1.6 18.7-.9 32.1.3 45.4c0 .1 0 .1.1.2 6.1 4.5 12 7.2 17.7 9 .1 0 .2 0 .2-.1 1.4-1.9 2.6-3.8 3.6-5.9.1-.1 0-.3-.1-.3-2-.8-3.8-1.7-5.6-2.7-.1-.1-.1-.3 0-.4.4-.3.8-.6 1.1-.9.1-.1.2-.1.2 0 11.6 5.3 24.2 5.3 35.7 0 .1 0 .2 0 .2 0 .4.3.7.6 1.1.9.1.1.1.3 0 .4-1.8 1-3.6 1.9-5.6 2.7-.1 0-.2.2-.1.3 1.1 2.1 2.3 4.1 3.6 5.9 0 .1.1.1.2.1 5.7-1.8 11.6-4.5 17.7-9 0 0 .1-.1.1-.2 1.4-14.5-2.4-27.1-10-38.3 0 0 0-.1-.1-.1zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.4 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.2 6.4 7.2 0 4-2.8 7.2-6.4 7.2z"/>
          </svg>
          Sign in with Discord
        </button>
        <button type="button" class="btn btn-secondary" id="cancel-login-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modalElement);

  document.getElementById('discord-login-btn').addEventListener('click', async () => {
    document.body.removeChild(modalElement);
    await handleDiscordLogin();
  });

  document.getElementById('cancel-login-btn').addEventListener('click', () => {
    document.body.removeChild(modalElement);
  });

  modalElement.addEventListener('click', (e) => {
    if (e.target === modalElement) {
      document.body.removeChild(modalElement);
    }
  });
}

// Listen for display name changes from other pages (e.g., My Raids)
window.addEventListener('display-name-changed', () => {
  renderNavigation();
});

// Start the app
initApp();
