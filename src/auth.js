// Simple authentication service for protected pages
class AuthService {
  constructor() {
    this.adminPassword = 'epileptic-reference-deed-imperial-collie-exfoliate';
    this.sessionKey = 'aftl_auth';
  }

  isAuthenticated() {
    return sessionStorage.getItem(this.sessionKey) === 'true';
  }

  authenticate(password) {
    if (password === this.adminPassword) {
      sessionStorage.setItem(this.sessionKey, 'true');
      return true;
    }
    return false;
  }

  logout() {
    sessionStorage.removeItem(this.sessionKey);
  }
}

export const authService = new AuthService();
