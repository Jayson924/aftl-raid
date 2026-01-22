import { authService } from './auth.js';
import { toast } from './toast.js';

class Router {
  constructor() {
    this.routes = {};
    this.routePermissions = {};
    this.currentPage = null;
    this.onAuthRequired = null;
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

  navigate(path) {
    const requiredRole = this.routePermissions[path];

    if (requiredRole) {
      if (!authService.isAuthenticated()) {
        toast.error('Please login to access this page');
        if (this.onAuthRequired) {
          this.onAuthRequired();
        }
        return;
      }

      if (!authService.hasAccess(requiredRole)) {
        toast.error('You do not have permission to access this page');
        this.navigate('lineups');
        return;
      }
    }

    const component = this.routes[path];
    if (component) {
      this.currentPage = path;
      const appElement = document.querySelector('#app');
      appElement.innerHTML = '';
      component.render(appElement);

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === path);
      });
    }
  }

  init() {
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-route]')) {
        e.preventDefault();
        this.navigate(e.target.dataset.route);
      }
    });

    this.navigate('lineups');
  }
}

export const router = new Router();
