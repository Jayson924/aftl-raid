import './style.scss'
import { router } from './router.js'
import { LineupsPage } from './pages/lineups.js'
import { PlayersPage } from './pages/players.js'
import { LineupEditorPage } from './pages/lineup-editor.js'
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
  router.register('players', PlayersPage, true); // Protected
  router.register('editor', LineupEditorPage, true); // Protected

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

  nav.innerHTML = `
    <div class="nav-container">
      <h1 class="app-title">AFTL Raid Manager</h1>
      <ul class="nav-links">
        <li><a href="#" class="nav-link" data-route="lineups">Lineups</a></li>
        ${isAuthenticated ? `
          <li><a href="#" class="nav-link" data-route="players">Characters</a></li>
          <li><a href="#" class="nav-link" data-route="editor">Lineup Editor</a></li>
        ` : ''}
      </ul>
      <div class="nav-actions">
        ${isAuthenticated ? `
          <button id="logout-btn" class="btn-icon" title="Logout">🚪</button>
        ` : `
          <button id="login-btn" class="btn-icon" title="Admin Login">🔐</button>
        `}
      </div>
    </div>
  `;

  document.body.insertBefore(nav, document.querySelector('#app'));

  // Login/Logout buttons
  if (isAuthenticated) {
    document.getElementById('logout-btn').addEventListener('click', () => {
      authService.logout();
      toast.info('Logged out successfully');
      renderNavigation();
      router.navigate('lineups');
    });
  } else {
    document.getElementById('login-btn').addEventListener('click', showLoginModal);
  }
}

function showLoginModal() {
  const modalElement = document.createElement('div');
  modalElement.className = 'modal';
  modalElement.innerHTML = `
    <div class="modal-content">
      <h2>Admin Login</h2>
      <p>Enter the admin password to access the Characters and Lineup Editor pages.</p>
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

    if (authService.authenticate(password)) {
      document.body.removeChild(modalElement);
      toast.success('Login successful!');
      renderNavigation();
    } else {
      toast.error('Incorrect password');
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
