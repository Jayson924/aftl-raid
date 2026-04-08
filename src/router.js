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
    this.fallbackRoute = 'enhancement';
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
    let route = path.replace(/^\//, '') || this.defaultRoute;
    // Preserve query string for routes that need it (e.g. arena-match?match=xxx)
    if (window.location.search) {
      route = route + window.location.search;
    }
    // Extract base route for lookup (strip query params)
    const baseRoute = route.split('?')[0];
    // Check if route exists, otherwise return default
    return this.routes[baseRoute] ? route : this.defaultRoute;
  }

  navigate(path, updateHistory = true) {
    // Extract base route and query params
    const [basePath, queryString] = path.split('?');
    const requiredRole = this.routePermissions[basePath];

    if (requiredRole) {
      if (!authService.isAuthenticated() || !authService.hasAccess(requiredRole)) {
        this.navigate(this.fallbackRoute);
        return;
      }
    }

    const component = this.routes[basePath];
    if (component) {
      // Call destroy on the current component before switching
      if (this.currentComponent && typeof this.currentComponent.destroy === 'function') {
        this.currentComponent.destroy();
      }

      this.currentPage = basePath;
      this.currentComponent = component;

      // Update URL without triggering popstate
      if (updateHistory) {
        let urlPath = basePath === this.defaultRoute ? '/' : `/${basePath}`;
        if (queryString) urlPath += '?' + queryString;
        window.history.pushState({ route: path }, '', urlPath);
      }

      const appElement = document.querySelector('#app');
      appElement.innerHTML = '';
      component.render(appElement);

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === basePath);
      });
    }
  }

  refresh() {
    if (this.currentPage && this.currentComponent) {
      const appElement = document.querySelector('#app');
      appElement.innerHTML = '';
      this.currentComponent.render(appElement);
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
