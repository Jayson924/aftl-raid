import { authService } from './auth.js';
import { toast } from './toast.js';

class Router {
  constructor() {
    this.routes = {};
    this.routePermissions = {};
    this.currentPage = null;
    this.currentComponent = null;
    this.onAuthRequired = null;
    this.defaultRoute = 'lineups';
  }

  register(path, component, requiredRole = null) {
    this.routes[path] = component;
    if (requiredRole) {
      this.routePermissions[path] = requiredRole;
    }
  }

  setAuthRequiredHandler(handler) {
    this.onAuthRequired = handler;
  }

  // Get route from current URL path
  getRouteFromUrl() {
    const path = window.location.pathname;
    // Remove leading slash and get the route name
    const route = path.replace(/^\//, '') || this.defaultRoute;
    // Check if route exists, otherwise return default
    return this.routes[route] ? route : this.defaultRoute;
  }

  navigate(path, updateHistory = true) {
    const requiredRole = this.routePermissions[path];

    if (requiredRole) {
      if (!authService.isAuthenticated()) {
        toast.error('Where password');
        if (this.onAuthRequired) {
          this.onAuthRequired();
        }
        return;
      }

      if (!authService.hasAccess(requiredRole)) {
        toast.error('Hu dis');
        this.navigate('lineups');
        return;
      }
    }

    const component = this.routes[path];
    if (component) {
      // Call destroy on the current component before switching
      if (this.currentComponent && typeof this.currentComponent.destroy === 'function') {
        this.currentComponent.destroy();
      }

      this.currentPage = path;
      this.currentComponent = component;

      // Update URL without triggering popstate
      if (updateHistory) {
        const urlPath = path === this.defaultRoute ? '/' : `/${path}`;
        window.history.pushState({ route: path }, '', urlPath);
      }

      const appElement = document.querySelector('#app');
      appElement.innerHTML = '';
      component.render(appElement);

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === path);
      });
    }
  }

  init() {
    // Handle click navigation
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-route]')) {
        e.preventDefault();
        this.navigate(e.target.dataset.route);
      }
    });

    // Handle browser back/forward buttons
    window.addEventListener('popstate', (e) => {
      const route = e.state?.route || this.getRouteFromUrl();
      this.navigate(route, false);
    });

    // Navigate to initial route based on URL
    const initialRoute = this.getRouteFromUrl();
    this.navigate(initialRoute, false);

    // Set initial history state
    const urlPath = initialRoute === this.defaultRoute ? '/' : `/${initialRoute}`;
    window.history.replaceState({ route: initialRoute }, '', urlPath);
  }
}

export const router = new Router();
