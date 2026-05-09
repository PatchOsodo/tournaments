/**
 * =============================================================================
 * state.js — Application state, format configuration, UI helpers
 *
 * Depends on: config.js, logger.js, auth.js
 * =============================================================================
 */

/* =============================================================================
   APPLICATION STATE
   ============================================================================= */
const State = {
  activeTournament : null,
  activeFixture    : null,
  isEditMode       : false,
  fixtures         : [],
  teams            : [],
  favourites       : [],
  masterTeams      : [],   // team databank cache
  setupData        : {
    teamCount  : 8,
    format     : 'elimination',
    name       : '',
    eventName  : '',
    names      : [],
    masterRefs : [],
    selectedTeams : [], 
  },
};

/* =============================================================================
   FORMAT CONFIGURATION
   ============================================================================= */
const FORMATS = [
  { id: 'round_robin', icon: '⟳', name: 'Round robin',  desc: 'Everyone plays everyone' },
  { id: 'elimination', icon: '⌥', name: 'Elimination',  desc: 'Single bracket, best advance' },
  { id: 'group_stage', icon: '⊞', name: 'Group stage',  desc: 'Groups → knockout' },
];

function suggestFormat(n) {
  if (n <= 5)                return 'round_robin';
  if ([12,16,20].includes(n)) return 'elimination';
  return 'group_stage';
}

/* =============================================================================
   UI HELPERS
   ============================================================================= */
const UI = {

  showScreen(id) {
    Logger.debug('showScreen', { screen: id });
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  },

  showError(bannerId, msgId, message) {
    Logger.warn('showError', { banner: bannerId, message });
    const b = document.getElementById(bannerId);
    const m = document.getElementById(msgId);
    if (b) b.classList.add('visible');
    if (m) m.textContent = message;
  },

  clearError(bannerId) {
    const el = document.getElementById(bannerId);
    if (el) el.classList.remove('visible');
  },

  showSuccess(bannerId, msgId, message, delay = 4000) {
    Logger.info('showSuccess', { message });
    const b = document.getElementById(bannerId);
    const m = document.getElementById(msgId);
    if (b) b.classList.add('visible');
    if (m) m.textContent = message;
    setTimeout(() => { if (b) b.classList.remove('visible'); }, delay);
  },

  toggleLog() {
    const panel = document.getElementById('log-panel');
    const arrow = document.getElementById('log-arrow');
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (arrow) arrow.textContent = open ? '▼' : '▶';
  },

  setConnectionStatus(online) {
    const dot   = document.getElementById('conn-dot');
    const label = document.getElementById('conn-label');
    if (dot)   dot.className     = 'conn-dot ' + (online ? 'online' : 'offline');
    if (label) label.textContent = online ? 'Connected' : 'Offline';
  },

  switchTab(idx) {
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
    document.querySelectorAll('.tab-panel').forEach((p, i) => p.classList.toggle('active', i === idx));
  },

  setStatusBadge(status) {
    const badge = document.getElementById('tournament-status-badge');
    if (!badge) return;
    badge.textContent = status;
    badge.className   = `status-badge badge-${status}`;
  },

  openModal(fixture, isEdit = false) {
    Logger.info('openModal', { fixtureId: fixture.id, isEdit });
    State.activeFixture = fixture;
    State.isEditMode    = isEdit;

    document.getElementById('modal-home-name').textContent = fixture.expand?.home_team?.name || 'Home';
    document.getElementById('modal-away-name').textContent = fixture.expand?.away_team?.name || 'Away';
    document.getElementById('modal-title').textContent     = isEdit ? 'Edit result' : 'Enter match result';
    document.getElementById('score-home').value = isEdit ? (fixture.home_score ?? '') : '';
    document.getElementById('score-away').value = isEdit ? (fixture.away_score ?? '') : '';

    const editNote = document.getElementById('modal-edit-note');
    if (editNote) editNote.classList.toggle('visible', isEdit);

    document.getElementById('modal-error').classList.remove('visible');
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('score-home').focus();
  },

  closeModal(event) {
    if (event && event.target !== document.getElementById('modal-overlay')) return;
    document.getElementById('modal-overlay').classList.remove('open');
    State.activeFixture = null;
    State.isEditMode    = false;
  },
};
