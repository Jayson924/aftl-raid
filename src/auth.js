/**
 * Auth Service - Wrapper around dataService for backwards compatibility
 *
 * This module provides the same interface as before but delegates to
 * dataService.isAuthenticated(), dataService.isAdmin(), etc.
 *
 * For new code, prefer using dataService directly.
 */

import { dataService } from './data.js';

class AuthService {
  isAuthenticated() {
    return dataService.isAuthenticated();
  }

  getRole() {
    return dataService.getUserRole();
  }

  isAdmin() {
    return dataService.isAdmin();
  }

  isPlayer() {
    return dataService.isPlayer();
  }

  canEditLineups() {
    return dataService.canEditLineups();
  }

  hasAccess(requiredRole) {
    return dataService.hasAccess(requiredRole);
  }

  // Legacy method - now uses Discord OAuth
  async authenticate(password) {
    console.warn('authenticate() is deprecated. Use dataService.signInWithDiscord() instead.');
    return { success: false, role: null };
  }

  async logout() {
    await dataService.signOut();
  }

  // New helper methods
  getDisplayName() {
    return dataService.getDisplayName();
  }

  getAvatarUrl() {
    return dataService.getAvatarUrl();
  }
}

export const authService = new AuthService();
