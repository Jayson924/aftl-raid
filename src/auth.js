// Simple authentication service for protected pages
class AuthService {
  constructor() {
    this.adminPassword = 'epileptic-reference-deed-imperial-collie-exfoliate';
    this.playerPassword = 'figment-smite-juiciness-armory-customary-corridor';
    this.sessionKey = 'aftl_auth';
    this.roleKey = 'aftl_role';
  }

  isAuthenticated() {
    return sessionStorage.getItem(this.sessionKey) === 'true';
  }

  getRole() {
    return sessionStorage.getItem(this.roleKey) || null;
  }

  isAdmin() {
    return this.getRole() === 'admin';
  }

  isPlayer() {
    return this.getRole() === 'player';
  }

  hasAccess(requiredRole) {
    const currentRole = this.getRole();
    if (!currentRole) return false;

    if (requiredRole === 'admin') {
      return currentRole === 'admin';
    } else if (requiredRole === 'player') {
      return currentRole === 'admin' || currentRole === 'player';
    }

    return false;
  }

  authenticate(password) {
    if (password === this.adminPassword) {
      sessionStorage.setItem(this.sessionKey, 'true');
      sessionStorage.setItem(this.roleKey, 'admin');
      return { success: true, role: 'admin' };
    } else if (password === this.playerPassword) {
      sessionStorage.setItem(this.sessionKey, 'true');
      sessionStorage.setItem(this.roleKey, 'player');
      return { success: true, role: 'player' };
    }
    return { success: false, role: null };
  }

  logout() {
    sessionStorage.removeItem(this.sessionKey);
    sessionStorage.removeItem(this.roleKey);
  }
}

export const authService = new AuthService();
