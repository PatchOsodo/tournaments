/**
 * =============================================================================
 * auth.js — PocketBase client + Auth helpers
 *
 * Depends on: config.js, logger.js
 * =============================================================================
 */

// Single PocketBase instance shared across all modules
const pb = new PocketBase(CONFIG.API_BASE_URL);

const Auth = {
  user()           { return pb.authStore.isValid ? pb.authStore.model : null; },
  role()           { return Auth.user()?.role ?? 'visitor'; },
  isSuperAdmin()   { return Auth.role() === 'super_admin'; },
  isAdmin()        { return Auth.isSuperAdmin() || Auth.role() === 'tournament_admin'; },
  isGuest()        { return Auth.role() === 'guest'; },
  isVisitor()      { return !pb.authStore.isValid; },
  canEnterScores() { return Auth.isAdmin(); },
  canFavourite()   { return Auth.isGuest() || Auth.isAdmin(); },

  logout() {
    Logger.info('Auth.logout');
    pb.authStore.clear();
    window.location.href = 'login.html';
  },
};
