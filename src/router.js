import { authService } from './auth.js';
import { toast } from './toast.js';

class Router {
  constructor() {
    this.routes = {};
    this.protectedRoutes = new Set();
    this.currentPage = null;
    this.onAuthRequired = null;
  }

  register(path, component, isProtected = false) {
    this.routes[path] = component;
    if (isProtected) {
      this.protectedRoutes.add(path);
    }
  }

  setAuthRequiredHandler(handler) {
    this.onAuthRequired = handler;
  }

  navigate(path) {
    if (this.protectedRoutes.has(path) && !authService.isAuthenticated()) {
      toast.error('Please login to access this page');
      if (this.onAuthRequired) {
        this.onAuthRequired();
      }
      return;
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
