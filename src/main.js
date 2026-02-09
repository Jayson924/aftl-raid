import './styles/style.scss'
import { router } from './router.js'
import { LineupsPage } from './pages/lineups.js'
import { PlayersPage } from './pages/players.js'
import { LineupEditorPage } from './pages/lineup-editor.js'
import { EnhancementPage } from './pages/enhancement.js'
import { SpendingGuidePage } from './pages/spending-guide.jsx'
import { dataService } from './data.js'
import { toast } from './toast.js'
import { authService } from './auth.js'
import { modal } from './modal.js'

// Initialize the app
function initApp() {
  // Create navigation
  renderNavigation();

  // Register routes
  router.register('lineups', LineupsPage);
  router.register('players', PlayersPage, 'player'); // Requires player or admin role
  router.register('editor', LineupEditorPage, 'admin'); // Requires admin role only
  router.register('enhancement', EnhancementPage); // No auth required
  router.register('spending', SpendingGuidePage); // No auth required

  // Set up auth required handler
  router.setAuthRequiredHandler(showLoginModal);

  // Load saved configuration
  dataService.loadConfig();

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

  const isAuthenticated = authService.isAuthenticated();
  const isAdmin = authService.isAdmin();
  const isPlayer = authService.isPlayer();

  nav.innerHTML = `
    <div class="nav-container">
      <h1 class="app-title">AFTL Raid Manager <span style="font-size: 0.5em; color: #888; font-weight: normal;">v1.006</span></h1>
      <button class="hamburger-btn" id="hamburger-btn" aria-label="Toggle menu">
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
        <span class="hamburger-line"></span>
      </button>
      <ul class="nav-links" id="nav-links">
        <li><a href="#" class="nav-link" data-route="lineups">Lineups</a></li>
        ${isAuthenticated ? `
          <li><a href="#" class="nav-link" data-route="players">Characters</a></li>
        ` : ''}
        ${isAdmin ? `
          <li><a href="#" class="nav-link" data-route="editor">Lineup Editor</a></li>
        ` : ''}
        <li><a href="#" class="nav-link" data-route="enhancement">Enhancement</a></li>
        <li><a href="#" class="nav-link" data-route="spending">Gold/Lavish</a></li>
        <li class="nav-auth-mobile">
          ${isAuthenticated ? `
            <a href="#" class="nav-link" id="logout-btn-mobile">Logout</a>
          ` : `
            <a href="#" class="nav-link" id="login-btn-mobile">Login</a>
          `}
        </li>
      </ul>
      <div class="nav-actions">
        ${isAuthenticated ? `
          <button id="logout-btn" class="btn-icon" title="Logout">🚪</button>
        ` : `
          <button id="login-btn" class="btn-icon" title="Login">🔐</button>
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
    document.getElementById('logout-btn').addEventListener('click', () => {
      authService.logout();
      toast.info('Bye bye na');
      renderNavigation();
      router.navigate('lineups');
    });
  } else {
    document.getElementById('login-btn').addEventListener('click', showLoginModal);
  }

  // Login/Logout buttons (mobile)
  if (isAuthenticated) {
    document.getElementById('logout-btn-mobile').addEventListener('click', (e) => {
      e.preventDefault();
      authService.logout();
      toast.info('Bye bye na');
      renderNavigation();
      router.navigate('lineups');
    });
  } else {
    document.getElementById('login-btn-mobile').addEventListener('click', (e) => {
      e.preventDefault();
      hamburgerBtn.classList.remove('active');
      navLinks.classList.remove('open');
      showLoginModal();
    });
  }
}

function showLoginModal() {
  const modalElement = document.createElement('div');
  modalElement.className = 'modal';
  modalElement.innerHTML = `
    <div class="modal-content">
      <h2>Login</h2>
      <p>Enter your password to access protected pages.</p>
      <form id="login-form">
        <div class="form-group">
          <label for="admin-password">Password:</label>
          <input type="password" id="admin-password" required autofocus>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Login</button>
          <button type="button" class="btn btn-secondary" id="cancel-login-btn">Cancel</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modalElement);

  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = document.getElementById('admin-password').value;

    const result = authService.authenticate(password);

    if (result.success) {
      document.body.removeChild(modalElement);
      if (result.role === 'admin') {
        toast.success('Admin login, bawal barlito!');
      } else if (result.role === 'player') {
        toast.success('Welcome po');
      }
      renderNavigation();
    } else {
      toast.error('New phone who dis?');
      document.getElementById('admin-password').value = '';
      document.getElementById('admin-password').focus();
    }
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

// Start the app
initApp();
