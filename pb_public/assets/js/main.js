/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — main.js
 * Version : 5.0.0
 *
 * NEW IN v5.0.0 — TOURNAMENT CATEGORIES / EVENTS
 * ───────────────────────────────────────────────
 * A tournament "event" (e.g. "JBB 2025") can now contain multiple categories
 * (e.g. "U13 Boys", "U15 Girls", "U17 Boys"). Each category is a fully
 * independent tournament with its own teams, format, fixtures, and results.
 *
 * REQUIRED POCKETBASE SCHEMA CHANGE (one-time):
 *   → Open admin dashboard → tournaments collection → New field:
 *       Name : event_name
 *       Type : Text
 *       Required : NO  (leave unchecked)
 *   Save the collection. That is the only change needed.
 *
 * WHAT CHANGED:
 *   - DB.createTournament() accepts optional event_name
 *   - DB.getEvents() — new: returns distinct event names from the DB
 *   - App.loadTournaments() — home screen now groups by event_name
 *   - App.goToSetup() — injects event-name input into setup card on first run
 *   - App.goToSetupForEvent(name) — new: opens setup pre-filled with event name
 *   - App.goToNames() — reads event-name input
 *   - App.generateFixtures() — passes event_name to createTournament
 *   - App._renderEventGroup() — new: renders an event header + its categories
 *   - App._renderTournamentItem() — new: renders a single tournament row
 *
 * CARRIED OVER FROM v4.2.0:
 *   - genElimination nextSlot / nextMatchNumber fix
 *   - _persistFixtures group_stage knockout round numbering fix
 *   - _computeGroupStandings derives teams from fixtures (not team.group_name)
 *   - seedKnockoutFromGroups: internal completion guard, cross-seeding
 *   - migrateExistingTournaments: repairs old broken tournaments on init
 *   - repairNextFixture: verifies winner advancement after each save
 *   - isBracketMatch: group_stage knockout fixtures advance correctly
 *
 * TABLE OF CONTENTS
 * -----------------
 * 1.  Configuration
 * 2.  Logger
 * 3.  PocketBase Client
 *      3.1 Auth Helpers for login 
 * 4.  UI Helpers
 * 5.  Application State
 * 6.  Format Configuration & suggestFormat
 * 7.  Fixture Generation Algorithms
 *       7a. Round Robin
 *       7b. Single Elimination
 *       7c. Group Stage
 * 8.  Database Layer (DB)
 * 9.  Migration (repairs old broken data on init)
 * 10. App Controller
 *       10a. Initialisation
 *       10b. Home Screen          ← UPDATED (event grouping)
 *       10c. Setup Screen         ← UPDATED (event-name field injected)
 *       10d. Names Screen
 *       10e. Fixture Generation & Persistence
 *       10f. Fixtures Screen / Render Helpers
 *       10g. Score Entry (new + edit)
 * 11. Helpers
 * 12. Global Error Handlers
 * 13. Boot
 * =============================================================================
 */

/* =============================================================================
   1. CONFIGURATION
   ============================================================================= */
const CONFIG = {
  API_BASE_URL : window.location.origin,
  VERSION      : '5.0.0',
};

/* =============================================================================
   2. LOGGER
   ============================================================================= */
const Logger = (() => {
  const entries = [];

  function write(level, msg, ctx) {
    const ts     = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const detail = ctx ? ' ' + JSON.stringify(ctx) : '';
    entries.push({ ts, level, msg, detail });

    const fn = { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' }[level] || 'log';
    console[fn](`[${ts}] [${level}] ${msg}`, ctx || '');

    const container = document.getElementById('log-entries');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML =
      `<span class="log-time">${ts}</span>` +
      `<span class="log-level-${level}">${level}</span>` +
      `<span class="log-msg">${escHtml(msg)}${escHtml(detail)}</span>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  return {
    debug          : (m, c) => write('DEBUG', m, c),
    info           : (m, c) => write('INFO',  m, c),
    warn           : (m, c) => write('WARN',  m, c),
    error          : (m, c) => write('ERROR', m, c),
    all            : ()     => [...entries],
    asText         : ()     => entries.map(e => `[${e.ts}] [${e.level}] ${e.msg}${e.detail}`).join('\n'),
    copyToClipboard: () => {
      navigator.clipboard.writeText(Logger.asText())
        .then(() => Logger.info('Log copied to clipboard'))
        .catch(e  => Logger.error('Clipboard copy failed', { error: e.message }));
    },
    clear: () => {
      entries.length = 0;
      const c = document.getElementById('log-entries');
      if (c) c.innerHTML = '';
      Logger.info('Log cleared by user');
    },
  };
})();

/* =============================================================================
   3. POCKETBASE CLIENT
   ============================================================================= */
const pb = new PocketBase(CONFIG.API_BASE_URL);

/* =============================================================================
   3. 1 AUTH HELPERS
   ============================================================================= */
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
    pb.authStore.clear();
    window.location.href = 'login.html';
  },
};

/* =============================================================================
   4. UI HELPERS
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
    if (dot)   dot.className    = 'conn-dot ' + (online ? 'online' : 'offline');
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

/* =============================================================================
   5. APPLICATION STATE
   ============================================================================= */
const State = {
  activeTournament : null,
  activeFixture    : null,
  isEditMode       : false,
  fixtures         : [],
  teams            : [],
  setupData        : {
    teamCount    : 8,
    format       : 'elimination',
    name         : '',        // category / tournament name
    eventName    : '',        // NEW: parent event name (e.g. "JBB 2025")
    names        : [],
  },
};

/* =============================================================================
   6. FORMAT CONFIGURATION
   ============================================================================= */
const FORMATS = [
  { id: 'round_robin', icon: '⟳', name: 'Round robin',  desc: 'Everyone plays everyone' },
  { id: 'elimination', icon: '⌥', name: 'Elimination',  desc: 'Single bracket, best advance' },
  { id: 'group_stage', icon: '⊞', name: 'Group stage',  desc: 'Groups → knockout' },
];

function suggestFormat(n) {
  if (n <= 5)                return 'round_robin';
  if ([4,8,16].includes(n)) return 'elimination';
  return 'group_stage';
}

/* =============================================================================
   7. FIXTURE GENERATION ALGORITHMS
   ============================================================================= */

/* 7a. ROUND ROBIN ------------------------------------------------------------ */
function genRoundRobin(teams) {
  Logger.debug('genRoundRobin', { count: teams.length });
  const list  = teams.length % 2 === 1 ? [...teams, 'BYE'] : [...teams];
  const total = list.length;
  const rounds = [];

  for (let r = 0; r < total - 1; r++) {
    const matches = [];
    for (let i = 0; i < total / 2; i++) {
      const a = list[i], b = list[total - 1 - i];
      if (a !== 'BYE' && b !== 'BYE') matches.push({ a, b, isBye: false });
    }
    if (matches.length) rounds.push({ label: `Round ${r + 1}`, matches });
    list.splice(1, 0, list.pop());
  }

  const totalMatches = rounds.reduce((s, r) => s + r.matches.length, 0);
  Logger.debug('genRoundRobin done', { rounds: rounds.length, totalMatches });
  return { type: 'round_robin', rounds, totalMatches };
}

/* 7b. SINGLE ELIMINATION ---------------------------------------------------- */
function genElimination(teams) {
  Logger.debug('genElimination', { count: teams.length });

  let size = 1;
  while (size < teams.length) size *= 2;
  const byes = size - teams.length;
  Logger.info('genElimination bracket size', { teams: teams.length, size, byes });

  const slots       = [...teams, ...Array(byes).fill('BYE')];
  const totalRounds = Math.log2(size);
  const allRounds   = [];

  const round1Matches = [];
  for (let i = 0; i < size; i += 2) {
    const a           = slots[i];
    const b           = slots[i + 1];
    const isBye       = b === 'BYE';
    const matchNumber = Math.floor(i / 2) + 1;

    round1Matches.push({
      a,
      b,
      isBye,
      nextRound       : 2,
      nextMatchNumber : Math.ceil(matchNumber / 2),
      nextSlot        : matchNumber % 2 === 1 ? 'home' : 'away',
    });
  }

  const r1Label = _roundLabel(round1Matches.length, totalRounds, 1);
  allRounds.push({ roundNumber: 1, label: r1Label, matches: round1Matches });

  let matchCount = size / 2;
  for (let r = 2; r <= totalRounds; r++) {
    matchCount = matchCount / 2;
    const matches = [];
    for (let m = 1; m <= matchCount; m++) {
      matches.push({
        a               : 'TBD',
        b               : 'TBD',
        isBye           : false,
        nextRound       : r < totalRounds ? r + 1 : null,
        nextMatchNumber : r < totalRounds ? Math.ceil(m / 2) : null,
        nextSlot        : m % 2 === 1 ? 'home' : 'away',
      });
    }
    const label = _roundLabel(matchCount, totalRounds, r);
    allRounds.push({ roundNumber: r, label, matches });
  }

  const totalMatches = round1Matches.filter(m => !m.isBye).length +
    allRounds.slice(1).reduce((s, r) => s + r.matches.length, 0);

  Logger.info('genElimination done', {
    size, byes,
    rounds       : allRounds.length,
    totalMatches,
    roundSummary : allRounds.map(r => `${r.label}: ${r.matches.length} matches`),
  });

  return { type: 'elimination', rounds: allRounds, totalMatches };
}

function _roundLabel(matchCount, totalRounds, roundNumber) {
  const fromEnd = totalRounds - roundNumber + 1;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

/* 7c. GROUP STAGE ----------------------------------------------------------- */
function genGroupStage(teams) {
  Logger.debug('genGroupStage', { count: teams.length });
  const numGroups = teams.length <= 8 ? 2 : teams.length <= 12 ? 3 : 4;
  const groups    = Array.from({ length: numGroups }, () => []);
  teams.forEach((t, i) => groups[i % numGroups].push(t));

  Logger.info('Groups formed', { numGroups, sizes: groups.map(g => g.length) });

  const letters       = 'ABCDEFGH';
  const groupFixtures = groups.map((g, gi) => ({
    name   : `Group ${letters[gi]}`,
    teams  : g,
    rounds : genRoundRobin(g).rounds,
  }));

  const advancers = groups.map(g => g.slice(0, 2)).flat();
  const knockout  = genElimination(advancers);

  const totalGroupMatches = groupFixtures.reduce(
    (s, g) => s + g.rounds.reduce((rs, r) => rs + r.matches.length, 0), 0
  );
  const totalMatches = totalGroupMatches + knockout.totalMatches;

  Logger.debug('genGroupStage done', { totalGroupMatches, knockoutMatches: knockout.totalMatches, totalMatches });
  return { type: 'group_stage', groupFixtures, knockout, totalMatches, numGroups };
}

/**
 * Compute live group standings from fixture results.
 * Derives team IDs from fixture records directly (not from team.group_name).
 */
function _computeGroupStandings(fixtures, teams, groupName) {
  const allGroupFx = fixtures.filter(f => f.group_name === groupName && !f.is_bye);
  if (!allGroupFx.length) {
    Logger.warn('_computeGroupStandings: no fixtures found for group', { groupName });
    return [];
  }

  const resolveId = (val) => {
    if (!val) return null;
    if (typeof val === 'object') return val.id ?? null;
    return val;
  };

  const teamIdsInGroup = new Set();
  allGroupFx.forEach(f => {
    const hId = resolveId(f.home_team);
    const aId = resolveId(f.away_team);
    if (hId) teamIdsInGroup.add(hId);
    if (aId) teamIdsInGroup.add(aId);
  });

  const standingsMap = {};
  teamIdsInGroup.forEach(id => {
    const teamRecord = teams.find(t => t.id === id);
    standingsMap[id] = {
      teamId     : id,
      name       : teamRecord?.name || `Team (${id.slice(0, 6)})`,
      played     : 0,
      wins       : 0,
      losses     : 0,
      ptsFor     : 0,
      ptsAgainst : 0,
      get pointDiff() { return this.ptsFor - this.ptsAgainst; },
    };
  });

  allGroupFx.filter(f => f.status === 'completed').forEach(f => {
    const homeId = resolveId(f.home_team);
    const awayId = resolveId(f.away_team);
    const home   = standingsMap[homeId];
    const away   = standingsMap[awayId];
    if (!home || !away) return;

    home.played++;    away.played++;
    home.ptsFor    += (f.home_score || 0);   home.ptsAgainst += (f.away_score || 0);
    away.ptsFor    += (f.away_score || 0);   away.ptsAgainst += (f.home_score || 0);

    if ((f.home_score || 0) > (f.away_score || 0)) {
      home.wins++;  away.losses++;
    } else {
      away.wins++;  home.losses++;
    }
  });

  return Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins)           return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return b.ptsFor - a.ptsFor;
  });
}

/* =============================================================================
   8. DATABASE LAYER
   ============================================================================= */
const DB = {

  async healthCheck() {
    try {
      await pb.health.check();
      Logger.info('PocketBase health OK');
      return true;
    } catch (e) {
      Logger.error('PocketBase health failed', { error: e.message });
      return false;
    }
  },

  /** Fetch all tournaments, newest first. */
  async getTournaments() {
    return pb.collection('tournaments').getFullList({ sort: '-created' });
  },

  /**
   * NEW: Return a sorted, deduplicated list of existing event names.
   * Used to populate the autocomplete datalist on the setup screen.
   */
  async getEvents() {
    try {
      const all = await pb.collection('tournaments').getFullList({
        fields: 'event_name',
      });
      const names = [...new Set(
        all.map(t => t.event_name).filter(Boolean)
      )].sort();
      Logger.debug('DB.getEvents', { count: names.length, names });
      return names;
    } catch (e) {
      Logger.warn('DB.getEvents failed', { error: e.message });
      return [];
    }
  },

  /**
   * Create a tournament record.
   * @param {string}      name       - Category / tournament name
   * @param {string}      format     - round_robin | elimination | group_stage
   * @param {string|null} eventName  - NEW: parent event name (optional)
   */
  async createTournament(name, format, eventName = null) {
    Logger.info('DB.createTournament', { name, format, eventName });
    return pb.collection('tournaments').create({
      name,
      format,
      status     : 'pending',
      event_name : eventName || null,
    });
  },

  async updateTournament(id, data) {
    return pb.collection('tournaments').update(id, data);
  },

  async deleteTournament(id) {
    Logger.warn('DB.deleteTournament', { id });
    return pb.collection('tournaments').delete(id);
  },

  async createTeam(tournamentId, name, seed, groupName) {
    return pb.collection('teams').create({
      tournament : tournamentId,
      name,
      seed       : seed ?? null,
      group_name : groupName ?? null,
    });
  },

  async getTeams(tournamentId) {
    return pb.collection('teams').getFullList({
      filter : `tournament = "${tournamentId}"`,
      sort   : 'seed',
    });
  },

  async createFixture(data) {
    return pb.collection('fixtures').create(data);
  },

  async getFixtures(tournamentId) {
    return pb.collection('fixtures').getFullList({
      filter : `tournament = "${tournamentId}"`,
      sort   : 'round,match_number',
      expand : 'home_team,away_team,winner',
    });
  },

  async saveFixtureResult(fixtureId, homeScore, awayScore, winnerId) {
    Logger.info('DB.saveFixtureResult', { fixtureId, homeScore, awayScore, winnerId });
    return pb.collection('fixtures').update(fixtureId, {
      home_score : homeScore,
      away_score : awayScore,
      winner     : winnerId,
      status     : 'completed',
    });
  },

  async advanceWinnerElimination(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    Logger.info('DB.advanceWinner', {
      from : `R${currentRound}M${currentMatchNumber}`,
      to   : `R${nextRound}M${nextMatchNumber}`,
      slot,
    });

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber}`,
      });
      if (!nextFx.length) {
        Logger.warn('advanceWinner: no next fixture (may be the final)', { nextRound, nextMatchNumber });
        return;
      }
      await pb.collection('fixtures').update(nextFx[0].id, { [slot]: winnerTeamId });
      Logger.info('Winner placed', { nextFixtureId: nextFx[0].id, slot });
    } catch (e) {
      Logger.warn('advanceWinner failed', { error: e.message });
    }
  },

  async clearAdvancedWinner(tournamentId, currentRound, currentMatchNumber) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';
    Logger.warn('DB.clearAdvancedWinner', { nextRound, nextMatchNumber, slot });

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber}`,
      });
      if (!nextFx.length) return;
      await pb.collection('fixtures').update(nextFx[0].id, {
        [slot]     : null,
        status     : 'scheduled',
        winner     : null,
        home_score : null,
        away_score : null,
      });
      Logger.info('Cleared advanced winner', { slot });
    } catch (e) {
      Logger.warn('clearAdvancedWinner: no next fixture', { error: e.message });
    }
  },

  async repairNextFixture(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      const expected = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber} && !is_bye`,
      });

      if (expected.length) {
        const fx      = expected[0];
        const current = typeof fx[slot] === 'object' ? fx[slot]?.id : fx[slot];
        if (current === winnerTeamId) {
          Logger.debug('repairNextFixture: slot already correct', { slot });
          return;
        }
        await pb.collection('fixtures').update(fx.id, { [slot]: winnerTeamId });
        Logger.warn('repairNextFixture: corrected wrong slot value', { fixtureId: fx.id, slot });
        return;
      }

      // Scan fallback for old buggy round numbers
      const allKnockout = await pb.collection('fixtures').getFullList({
        filter : `tournament = "${tournamentId}" && group_name = "" && !is_bye`,
        sort   : 'round,match_number',
      });

      const rounds          = [...new Set(allKnockout.map(f => f.round))].sort((a, b) => a - b);
      const currentRoundIdx = rounds.indexOf(currentRound);
      if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) return;

      const actualNextRound = rounds[currentRoundIdx + 1];
      const nextRoundFx     = allKnockout.filter(f => f.round === actualNextRound).sort((a, b) => a.match_number - b.match_number);
      const currentRoundFx  = allKnockout.filter(f => f.round === currentRound).sort((a, b) => a.match_number - b.match_number);
      const positionInRound = currentRoundFx.findIndex(f => f.match_number === currentMatchNumber);
      const targetFixtureIdx = Math.floor(positionInRound / 2);
      const targetSlot       = positionInRound % 2 === 0 ? 'home_team' : 'away_team';

      if (targetFixtureIdx >= nextRoundFx.length) return;

      const targetFx   = nextRoundFx[targetFixtureIdx];
      const currentVal = typeof targetFx[targetSlot] === 'object' ? targetFx[targetSlot]?.id : targetFx[targetSlot];
      if (currentVal === winnerTeamId) return;

      await pb.collection('fixtures').update(targetFx.id, { [targetSlot]: winnerTeamId });
      Logger.warn('repairNextFixture: patched via scan', { fixtureId: targetFx.id, slot: targetSlot });

    } catch (e) {
      Logger.warn('repairNextFixture failed', { error: e.message });
    }
  },

  /**
   * Seed knockout bracket from group standings. Internal completion guard —
   * returns false if groups are not all done yet.
   */
  async seedKnockoutFromGroups(tournamentId, allTeams) {
    Logger.info('DB.seedKnockoutFromGroups: checking group completion');

    const freshFixtures = await pb.collection('fixtures').getFullList({
      filter : `tournament = "${tournamentId}"`,
      sort   : 'round,match_number',
      expand : 'home_team,away_team,winner',
    });

    const groupFxAll = freshFixtures.filter(f => f.group_name && !f.is_bye);
    if (!groupFxAll.length) { Logger.warn('seedKnockoutFromGroups: no group fixtures'); return false; }

    const allGroupsDone = groupFxAll.every(f => f.status === 'completed');
    if (!allGroupsDone) {
      Logger.debug('seedKnockoutFromGroups: not complete yet', {
        remaining: groupFxAll.filter(f => f.status !== 'completed').length,
      });
      return false;
    }

    Logger.info('seedKnockoutFromGroups: seeding knockout');

    const groupNames    = [...new Set(groupFxAll.map(f => f.group_name))].sort();
    const groupRankings = groupNames.map(gName => {
      const standings = _computeGroupStandings(freshFixtures, allTeams, gName);
      const top2      = standings.slice(0, 2);
      Logger.info(`${gName} top 2`, top2.map(s => `${s.name} W:${s.wins} PD:${s.pointDiff}`));
      return top2;
    });

    const firsts   = groupRankings.map(g => g[0]);
    const seconds  = groupRankings.map(g => g[1]);
    const advancers = [];
    for (let i = 0; i < firsts.length; i++) {
      advancers.push(firsts[i]);
      advancers.push(seconds[(i + 1) % seconds.length]);
    }

    Logger.info('Advancers', advancers.map((a, i) => `[${i}] ${a?.name ?? 'MISSING'}`));

    if (advancers.some(a => !a?.teamId)) {
      Logger.error('seedKnockoutFromGroups: missing teamId — aborting');
      return false;
    }

    const knockoutFx = freshFixtures
      .filter(f => !f.group_name && !f.is_bye)
      .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

    if (!knockoutFx.length) { Logger.error('seedKnockoutFromGroups: no knockout fixtures in DB'); return false; }

    const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
    const firstRoundFx = knockoutFx.filter(f => f.round === firstKoRound).sort((a, b) => a.match_number - b.match_number);

    for (let i = 0; i < firstRoundFx.length; i++) {
      const homeAdv = advancers[i * 2];
      const awayAdv = advancers[i * 2 + 1];
      await pb.collection('fixtures').update(firstRoundFx[i].id, {
        home_team : homeAdv.teamId,
        away_team : awayAdv.teamId,
      });
      Logger.info('Fixture seeded', { fixtureId: firstRoundFx[i].id, home: homeAdv.name, away: awayAdv.name });
    }

    return true;
  },
  
    async getFavourites() {
      if (!Auth.canFavourite()) return [];
      try {
        return await pb.collection('favourites').getFullList({
          filter : `user = "${Auth.user().id}"`,
          expand : 'tournament',
        });
      } catch (e) {
        Logger.warn('getFavourites failed', { error: e.message });
        return [];
        }
      },

    async addFavourite(tournamentId) {
      return pb.collection('favourites').create({
        user       : Auth.user().id,
        tournament : tournamentId,
      });
    },

    async removeFavourite(favouriteId) {
      return pb.collection('favourites').delete(favouriteId);
    },
};

/* =============================================================================
   9. MIGRATION — repair tournaments created with old buggy round numbering
   ============================================================================= */
async function migrateExistingTournaments() {
  Logger.info('Migration: checking for broken tournaments');
  let tournaments;
  try {
    tournaments = await pb.collection('tournaments').getFullList({ sort: '-created' });
  } catch (e) {
    Logger.error('Migration: failed to fetch', { error: e.message });
    return;
  }

  const active = tournaments.filter(t => t.status === 'active' && t.format === 'group_stage');
  for (const tournament of active) {
    try { await _migrateTournament(tournament); }
    catch (e) { Logger.error('Migration: failed for tournament', { id: tournament.id, error: e.message }); }
  }
  Logger.info('Migration: complete');
}

async function _migrateTournament(tournament) {
  const [allTeams, allFixtures] = await Promise.all([
    pb.collection('teams').getFullList({ filter: `tournament = "${tournament.id}"`, sort: 'seed' }),
    pb.collection('fixtures').getFullList({
      filter: `tournament = "${tournament.id}"`,
      sort: 'round,match_number',
      expand: 'home_team,away_team,winner',
    }),
  ]);

  const groupFx    = allFixtures.filter(f => f.group_name && !f.is_bye);
  const knockoutFx = allFixtures.filter(f => !f.group_name && !f.is_bye);
  if (!groupFx.length || !knockoutFx.length) return;

  const allGroupsDone = groupFx.every(f => f.status === 'completed');
  if (!allGroupsDone) return;

  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const knockoutUnseeded = knockoutFx.filter(f => f.round === firstKoRound).every(f => !f.home_team && !f.away_team);

  if (knockoutUnseeded) {
    Logger.warn('Migration: seeding knockout', { id: tournament.id });
    await _migrateSeeding(tournament.id, allTeams, allFixtures, knockoutFx);
    return;
  }

  const rounds = [...new Set(knockoutFx.map(f => f.round))].sort((a, b) => a - b);
  for (const fx of knockoutFx.filter(f => f.status === 'completed' && f.winner).sort((a,b) => a.round-b.round||a.match_number-b.match_number)) {
    const currentRoundIdx = rounds.indexOf(fx.round);
    if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) continue;

    const nextRound      = rounds[currentRoundIdx + 1];
    const currentRoundFx = knockoutFx.filter(f => f.round === fx.round).sort((a,b) => a.match_number - b.match_number);
    const posInRound     = currentRoundFx.findIndex(f => f.id === fx.id);
    const slot           = posInRound % 2 === 0 ? 'home_team' : 'away_team';
    const nextRoundFx    = knockoutFx.filter(f => f.round === nextRound).sort((a,b) => a.match_number - b.match_number);
    const nextFx         = nextRoundFx[Math.floor(posInRound / 2)];
    if (!nextFx) continue;

    const winnerId   = typeof fx.winner === 'object' ? fx.winner.id : fx.winner;
    const currentVal = typeof nextFx[slot] === 'object' ? nextFx[slot]?.id : nextFx[slot];
    if (currentVal === winnerId) continue;

    await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerId });
    Logger.warn('Migration: fixed winner slot', { from: `R${fx.round}M${fx.match_number}`, slot });
  }
}

async function _migrateSeeding(tournamentId, allTeams, allFixtures, knockoutFx) {
  const groupNames    = [...new Set(allFixtures.filter(f => f.group_name && !f.is_bye).map(f => f.group_name))].sort();
  const groupRankings = groupNames.map(gName => _computeGroupStandings(allFixtures, allTeams, gName).slice(0, 2));
  const firsts  = groupRankings.map(g => g[0]);
  const seconds = groupRankings.map(g => g[1]);
  const advancers = [];
  for (let i = 0; i < firsts.length; i++) {
    advancers.push(firsts[i]);
    advancers.push(seconds[(i + 1) % seconds.length]);
  }
  if (advancers.some(a => !a?.teamId)) { Logger.error('Migration: missing teamId — aborting'); return; }

  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const firstRoundFx = knockoutFx.filter(f => f.round === firstKoRound).sort((a,b) => a.match_number - b.match_number);
  for (let i = 0; i < firstRoundFx.length; i++) {
    await pb.collection('fixtures').update(firstRoundFx[i].id, {
      home_team: advancers[i*2].teamId,
      away_team: advancers[i*2+1].teamId,
    });
  }
}

/* =============================================================================
   10. APP CONTROLLER
   ============================================================================= */
const App = {

  /* ── 10a. INITIALISATION ─────────────────────────────────────────────── */

  async init() {
    Logger.info('App.init', { version: CONFIG.VERSION });

      // Auth check — redirect viewers to login if they try to access
      // admin-only pages directly. Viewers are welcome on index.html
      // but cannot create tournaments or enter scores.
    const user = Auth.user();
        Logger.info('Auth state', {
        loggedIn : !!user,
        role     : Auth.role(),
        email    : user?.email ?? '(guest)',
        });

      // Render auth bar
    App._renderAuthBar();

    const online = await DB.healthCheck();
    UI.setConnectionStatus(online);
    if (!online) {
        UI.showError('home-error', 'home-error-msg',
        'Cannot reach PocketBase. Ensure it is running.');
    }
    App._initSetupScreen();
    await migrateExistingTournaments();
    await App.loadTournaments();
},

  /* ── 10b. HOME SCREEN ────────────────────────────────────────────────── */

  /**
   * Load all tournaments and render the home screen.
   *
   * Rendering logic:
   *   - Tournaments WITH an event_name are grouped under an event header.
   *   - Tournaments WITHOUT an event_name render as standalone items.
   *   - Within an event group, categories are sorted by created date.
   *   - Each event header has an "+ Add category" button.
   */
  async loadTournaments() {
    Logger.info('loadTournaments');
    UI.clearError('home-error');
    const list = document.getElementById('tournament-list');
    // Show/hide admin-only controls
    const newBtn      = document.getElementById('btn-new-tournament');
    const organiseBtn = document.getElementById('btn-organise');
    if (newBtn)      newBtn.style.display      = Auth.isAdmin() ? '' : 'none';
    if (organiseBtn) organiseBtn.style.display = Auth.isAdmin() ? '' : 'none';
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>Loading...</div>';
    
    try {
      const [tournaments, favourites] = await Promise.all([
        DB.getTournaments(),
        DB.getFavourites(),
      ]);

      // Store favourites in state for rendering
      State.favourites = favourites;
      
      catch (e) {
        Logger.error('Failed to load favourites', { error: e.message });
        // Hatustop hapa, tunaruhusu tournaments ziendelee kuload
    }

    try {
      const tournaments = await DB.getTournaments();
      Logger.info('Tournaments loaded', { count: tournaments.length });

      if (!tournaments.length) {
        list.innerHTML = `<div class="empty-state">
          <span class="empty-icon">🏆</span>
          No tournaments yet.<br>Create one to get started.
        </div>`;
        return;
      }

      // Separate events (grouped) from standalone tournaments
      const events     = {};  // { eventName: [tournament, ...] }
      const standalone = [];

      tournaments.forEach(t => {
        const ev = (t.event_name || '').trim();
        if (ev) {
          if (!events[ev]) events[ev] = [];
          events[ev].push(t);
        } else {
          standalone.push(t);
        }
      });

      let html = '';

      // Render event groups first (alphabetically by event name)
      Object.keys(events).sort().forEach(eventName => {
        html += App._renderEventGroup(eventName, events[eventName]);
      });

      // Render standalone tournaments
      standalone.forEach(t => {
        html += App._renderTournamentItem(t);
      });

      list.innerHTML = html;

    } catch (e) {
      Logger.error('loadTournaments failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not load tournaments: ${e.message}`);
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Failed to load.</div>';
    }
  },
  

  /**
   * Render an event group — a collapsible header with all its categories.
   *
   * @param {string}   eventName   - The event name (e.g. "JBB 2025")
   * @param {Array}    categories  - Tournament records belonging to this event
   * @returns {string} HTML string
   */
  _renderEventGroup(eventName, categories) {
    const allDone     = categories.every(c => c.status === 'completed');
    const anyActive   = categories.some(c => c.status === 'active');
    const groupStatus = allDone ? 'completed' : anyActive ? 'active' : 'pending';

    const statusColors = {
      pending   : 'var(--text-tertiary)',
      active    : '#d4860a',
      completed : 'var(--accent)',
    };

    const categoryRows = categories.map(t => App._renderTournamentItem(t, true)).join('');

    return `
      <div class="event-group" style="
        background    : var(--bg-primary);
        border        : 0.5px solid var(--border-light);
        border-radius : var(--radius-lg);
        margin-bottom : 10px;
        overflow      : hidden;
      ">
        <!-- Event header -->
        <div style="
          display         : flex;
          align-items     : center;
          justify-content : space-between;
          padding         : 0.85rem 1rem;
          background      : var(--bg-secondary);
          border-bottom   : 0.5px solid var(--border-light);
          flex-wrap       : wrap;
          gap             : 8px;
        ">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;">🏆</span>
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--text-primary)">
                ${escHtml(eventName)}
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px;">
                ${categories.length} ${categories.length === 1 ? 'category' : 'categories'}
                &nbsp;·&nbsp;
                <span style="color:${statusColors[groupStatus]}">${groupStatus}</span>
              </div>
            </div>
          </div>
          <button class="btn sm primary"
                  onclick="App.goToSetupForEvent('${escHtml(eventName).replace(/'/g, "\\'")}')">
            + Add category
          </button>
        </div>
        <!-- Categories -->
        <div style="padding:6px 0;">
          ${categoryRows}
        </div>
      </div>`;
  },

  /**
   * Render a single tournament row.
   *
   * @param {object}  tournament  - PocketBase tournament record
   * @param {boolean} isCategory  - When true, renders with indented category style
   * @returns {string} HTML string
   */
  _renderTournamentItem(tournament, isCategory = false) {
    const t          = tournament;
    const formatText = t.format.replace(/_/g, ' ');
    const dateText   = new Date(t.created).toLocaleDateString();

    return `
      <div style="
        display         : flex;
        align-items     : center;
        justify-content : space-between;
        padding         : ${isCategory ? '0.6rem 1rem 0.6rem 2rem' : '0.85rem 1rem'};
        border-bottom   : 0.5px solid var(--border-light);
        flex-wrap       : wrap;
        gap             : 8px;
        transition      : background 0.12s;
      " onmouseover="this.style.background='var(--bg-secondary)'"
         onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-size:${isCategory ? '13px' : '14px'};font-weight:500;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
            ${isCategory ? '<span style="font-size:11px;color:var(--text-tertiary)">↳</span>' : ''}
            ${escHtml(t.name)}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
            ${formatText} · ${dateText}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span class="status-badge badge-${t.status}">${t.status}</span>
            <button class="btn sm primary" onclick="App.openTournament('${t.id}')">Open</button>
            <a class="btn sm ghost" href="bracket.html?id=${t.id}" target="_blank">Bracket</a>
            ${Auth.isAdmin() ? `
            <button class="btn sm danger" onclick="App.deleteTournament('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">
            Delete</button>` : ''}
        </div>
      </div>`;
  },

  async openTournament(tournamentId) {
    Logger.info('openTournament', { tournamentId });
    try {
      State.activeTournament = await pb.collection('tournaments').getOne(tournamentId);
      State.teams            = await DB.getTeams(tournamentId);
      State.fixtures         = await DB.getFixtures(tournamentId);
      App._renderFixturesScreen();
      UI.showScreen('screen-fixtures');
      const link = document.getElementById('bracket-page-link');
      if (link) link.href = `bracket.html?id=${tournamentId}`;
    } catch (e) {
      Logger.error('openTournament failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not open: ${e.message}`);
    }
  },

  async deleteTournament(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await DB.deleteTournament(id);
      await App.loadTournaments();
    } catch (e) {
      Logger.error('deleteTournament failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Delete failed: ${e.message}`);
    }
  },

  goToHome() {
    UI.showScreen('screen-home');
    App.loadTournaments();
  },

  /* ── 10c. SETUP SCREEN ───────────────────────────────────────────────── */

  /**
   * Open the setup screen for a brand-new tournament or category.
   * Resets all setup state.
   */
  goToSetup() {
    State.setupData = { teamCount: 8, format: 'elimination', name: '', eventName: '', names: [] };
    const tc = document.getElementById('team-count');
    const tn = document.getElementById('tournament-name');
    const en = document.getElementById('event-name');
    if (tc) tc.value = 8;
    if (tn) tn.value = '';
    if (en) { en.value = ''; App._updateSetupLabels(''); }
    App._renderFormatGrid();
    App._populateEventSuggestions();
    UI.showScreen('screen-setup');
  },

  /**
   * NEW: Open the setup screen pre-filled with an existing event name.
   * Used by the "+ Add category" button on event groups.
   *
   * @param {string} eventName - Event name to pre-fill
   */
  goToSetupForEvent(eventName) {
    Logger.info('goToSetupForEvent', { eventName });
    State.setupData = { teamCount: 8, format: 'elimination', name: '', eventName, names: [] };
    const tc = document.getElementById('team-count');
    const tn = document.getElementById('tournament-name');
    const en = document.getElementById('event-name');
    if (tc) tc.value = 8;
    if (tn) tn.value = '';
    if (en) { en.value = eventName; App._updateSetupLabels(eventName); }
    App._renderFormatGrid();
    App._populateEventSuggestions();
    UI.showScreen('screen-setup');
  },

  /**
   * Inject the event-name input field into the setup card if it is not
   * already present in the HTML. This keeps index.html minimal — no manual
   * HTML edits required for this feature.
   *
   * Called once on App.init(). The injected field persists for the session.
   */
  _initSetupScreen() {
    // Inject event-name field if not already in the HTML
    if (!document.getElementById('event-name')) {
      const tnInput = document.getElementById('tournament-name');
      if (tnInput) {
        const eventNameHtml = `
          <div id="event-name-group" style="margin-bottom:1rem;margin-top:-0.5rem;">
            <label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:6px;" id="event-name-label">
              Event name
              <span style="font-size:11px;color:var(--text-tertiary);font-style:italic;">
                — optional, groups categories together (e.g. "JBB 2025")
              </span>
            </label>
            <input type="text" id="event-name" class="tournament-name-input"
                   placeholder="e.g. JBB 2025, City Cup, School League"
                   maxlength="60"
                   list="event-name-suggestions"
                   style="margin-bottom:0;" />
            <datalist id="event-name-suggestions"></datalist>
          </div>`;

        // Insert AFTER the tournament-name input's parent wrapper
        tnInput.insertAdjacentHTML('afterend', eventNameHtml);

        Logger.info('_initSetupScreen: event-name field injected');
      }
    }

    // Also update the tournament-name label to clarify its dual role
    const tnLabel = document.querySelector('label[for="tournament-name"], label + #tournament-name');
    if (tnLabel && tnLabel.tagName === 'LABEL') {
      tnLabel.innerHTML = `Tournament / Category name`;
    }

    // Wire up team count input
    App._renderFormatGrid();
    document.getElementById('team-count')?.addEventListener('input', function () {
      const n = parseInt(this.value, 10);
      UI.clearError('setup-error');
      this.classList.remove('input-error');
      if (!isNaN(n) && n >= 3 && n <= 32) {
        State.setupData.teamCount = n;
        State.setupData.format    = suggestFormat(n);
        App._renderFormatGrid();
      }
    });

    // Wire up event-name input: update labels and state as user types
    document.getElementById('event-name')?.addEventListener('input', function () {
      const val = this.value.trim();
      State.setupData.eventName = val;
      App._updateSetupLabels(val);
    });
  },

  /**
   * Update the tournament-name label text depending on whether an event name
   * is set. When an event is named, the field becomes "Category name".
   *
   * @param {string} eventName - Current value of the event-name input
   */
  _updateSetupLabels(eventName) {
    // Find the label immediately before the tournament-name input
    const tnInput = document.getElementById('tournament-name');
    if (!tnInput) return;
    // Walk backwards through siblings to find the label
    let el = tnInput.previousElementSibling;
    while (el && el.tagName !== 'LABEL') el = el.previousElementSibling;

    if (el && el.tagName === 'LABEL') {
      el.textContent = eventName ? 'Category name' : 'Tournament / Category name';
    }
  },

  /**
   * Populate the autocomplete datalist with existing event names from the DB.
   * Called each time the setup screen opens so new events appear immediately.
   */
  async _populateEventSuggestions() {
    const datalist = document.getElementById('event-name-suggestions');
    if (!datalist) return;
    try {
      const events = await DB.getEvents();
      datalist.innerHTML = events.map(e => `<option value="${escHtml(e)}">`).join('');
      Logger.debug('_populateEventSuggestions', { count: events.length });
    } catch (e) {
      Logger.warn('_populateEventSuggestions failed', { error: e.message });
    }
  },

  _renderFormatGrid() {
    const el = document.getElementById('format-grid');
    if (!el) return;
    const n         = State.setupData.teamCount;
    const suggested = suggestFormat(n);
    if (!State.setupData.format) State.setupData.format = suggested;

    el.innerHTML = FORMATS.map(f => {
      const isSug = f.id === suggested;
      const isSel = f.id === State.setupData.format;
      return `<div class="format-card ${isSel ? 'selected' : ''}" onclick="App.selectFormat('${f.id}')">
        <div class="fmt-icon">${f.icon}</div>
        <div class="fmt-name">${f.name} ${isSug ? '<span class="badge-teal">suggested</span>' : ''}</div>
        <div class="fmt-desc">${f.desc}</div>
      </div>`;
    }).join('');

    const tip = document.getElementById('format-suggestion');
    if (tip) {
      const tips = {
        round_robin: `Round robin for ${n} teams — everyone plays everyone.`,
        elimination: `Elimination for ${n} teams — single bracket, one loss and you're out.`,
        group_stage: `Group stage for ${n} teams — groups first, then knockout.`,
      };
      tip.textContent = tips[State.setupData.format] || '';
    }
  },

  selectFormat(id) {
    State.setupData.format = id;
    App._renderFormatGrid();
  },

  /* ── 10d. NAMES SCREEN ───────────────────────────────────────────────── */

  goToNames() {
    UI.clearError('setup-error');

    const nameVal  = (document.getElementById('tournament-name')?.value || '').trim();
    const eventVal = (document.getElementById('event-name')?.value     || '').trim();
    const raw      = document.getElementById('team-count')?.value.trim();
    const n        = parseInt(raw, 10);

    if (!nameVal) {
      const label = eventVal ? 'category name' : 'tournament name';
      UI.showError('setup-error', 'setup-error-msg', `Please enter a ${label}.`);
      return;
    }
    if (!raw || isNaN(n) || n < 3 || n > 32) {
      UI.showError('setup-error', 'setup-error-msg', 'Enter a number of teams between 3 and 32.');
      document.getElementById('team-count')?.classList.add('input-error');
      return;
    }

    State.setupData.name      = nameVal;
    State.setupData.eventName = eventVal;
    State.setupData.teamCount = n;

    Logger.info('goToNames', {
      name      : nameVal,
      eventName : eventVal || '(none)',
      teams     : n,
      format    : State.setupData.format,
    });

    const grid = document.getElementById('team-inputs');
    if (grid) {
      grid.innerHTML = Array.from({ length: n }, (_, i) => `
        <div class="team-input-wrap">
          <span class="team-num">${i + 1}</span>
          <input type="text" placeholder="Team ${i + 1}" id="tn-${i}"
                 value="${escHtml(State.setupData.names[i] || '')}" maxlength="30" />
        </div>`).join('');
    }
    UI.showScreen('screen-names');
  },

  /* ── 10e. FIXTURE GENERATION & PERSISTENCE ───────────────────────────── */

  async generateFixtures() {
    UI.clearError('names-error');
    Logger.info('generateFixtures');

    const names = Array.from({ length: State.setupData.teamCount }, (_, i) => {
      const el = document.getElementById(`tn-${i}`);
      return (el?.value.trim()) || `Team ${i + 1}`;
    });
    State.setupData.names = names;

    const seen = new Set();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) {
        UI.showError('names-error', 'names-error-msg',
          `Duplicate name: "${name}". All team names must be unique.`);
        return;
      }
      seen.add(key);
    }

    const btn = document.getElementById('btn-generate');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

    try {
      // 1 — Create tournament record (with optional event_name)
      const tournament = await DB.createTournament(
        State.setupData.name,
        State.setupData.format,
        State.setupData.eventName || null,   // NEW: pass event name
      );
      Logger.info('Tournament record created', {
        id        : tournament.id,
        eventName : State.setupData.eventName || '(none)',
      });

      // 2 — Create teams
      const teamMap   = {};
      const numGroups = State.setupData.format === 'group_stage'
        ? (names.length <= 8 ? 2 : names.length <= 12 ? 3 : 4) : null;

      for (let i = 0; i < names.length; i++) {
        const groupName = numGroups ? 'ABCDEFGH'[i % numGroups] : null;
        const team      = await DB.createTeam(tournament.id, names[i], i + 1, groupName);
        teamMap[names[i]] = team.id;
      }

      // 3 — Generate fixture structure
      let generated;
      if      (State.setupData.format === 'round_robin') generated = genRoundRobin(names);
      else if (State.setupData.format === 'elimination') generated = genElimination(names);
      else                                               generated = genGroupStage(names);

      // 4 — Persist
      await App._persistFixtures(tournament.id, generated, teamMap);

      // 5 — Activate
      await DB.updateTournament(tournament.id, { status: 'active' });

      // 6 — Navigate to fixtures screen
      State.activeTournament        = tournament;
      State.activeTournament.status = 'active';
      State.teams    = await DB.getTeams(tournament.id);
      State.fixtures = await DB.getFixtures(tournament.id);
      App._renderFixturesScreen();
      UI.showScreen('screen-fixtures');
      UI.showSuccess('fixtures-success', 'fixtures-success-msg',
        `"${tournament.name}" created — ${generated.totalMatches} matches.`);

    } catch (e) {
      Logger.error('generateFixtures failed', { error: e.message, stack: e.stack });
      UI.showError('names-error', 'names-error-msg', `Save failed: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Generate &amp; save →'; }
    }
  },

  async _persistFixtures(tournamentId, generated, teamMap) {
    Logger.info('_persistFixtures', { type: generated.type });

    if (generated.type === 'elimination') {
      const savedFixtureMap = {};

      for (const round of generated.rounds) {
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m      = round.matches[mi];
          const key    = `R${round.roundNumber}M${mi + 1}`;
          const homeId = (!m.isBye && m.a !== 'TBD' && teamMap[m.a]) ? teamMap[m.a] : null;
          const awayId = (!m.isBye && m.b !== 'TBD' && m.b !== 'BYE' && teamMap[m.b]) ? teamMap[m.b] : null;

          const saved = await DB.createFixture({
            tournament   : tournamentId,
            round        : round.roundNumber,
            match_number : mi + 1,
            round_label  : round.label,
            home_team    : homeId,
            away_team    : awayId,
            is_bye       : m.isBye,
            status       : m.isBye ? 'completed' : 'scheduled',
            group_name   : null,
          });
          savedFixtureMap[key] = saved;
        }
      }

      // Seed bye winners into round 2
      for (let mi = 0; mi < generated.rounds[0].matches.length; mi++) {
        const m = generated.rounds[0].matches[mi];
        if (!m.isBye) continue;
        const slot   = m.nextSlot === 'home' ? 'home_team' : 'away_team';
        const nextFx = savedFixtureMap[`R2M${m.nextMatchNumber}`];
        if (nextFx) {
          await pb.collection('fixtures').update(nextFx.id, { [slot]: teamMap[m.a] });
          Logger.info('Bye winner seeded', { team: m.a, into: `R2M${m.nextMatchNumber}`, slot });
        }
      }

    } else if (generated.type === 'group_stage') {
      let roundOffset = 0;

      for (const group of generated.groupFixtures) {
        for (let ri = 0; ri < group.rounds.length; ri++) {
          const round = group.rounds[ri];
          for (let mi = 0; mi < round.matches.length; mi++) {
            const m = round.matches[mi];
            await DB.createFixture({
              tournament   : tournamentId,
              round        : roundOffset + ri + 1,
              match_number : mi + 1,
              round_label  : round.label,
              home_team    : teamMap[m.a] ?? null,
              away_team    : teamMap[m.b] ?? null,
              is_bye       : false,
              status       : 'scheduled',
              group_name   : group.name,
            });
          }
        }
        roundOffset += group.rounds.length;
      }

      for (let ri = 0; ri < generated.knockout.rounds.length; ri++) {
        const round = generated.knockout.rounds[ri];
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m = round.matches[mi];
          await DB.createFixture({
            tournament   : tournamentId,
            round        : roundOffset + ri + 1,
            match_number : mi + 1,
            round_label  : round.label,
            home_team    : null,
            away_team    : null,
            is_bye       : m.isBye,
            status       : 'scheduled',
            group_name   : null,
          });
        }
      }

    } else {
      for (let ri = 0; ri < generated.rounds.length; ri++) {
        const round = generated.rounds[ri];
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m = round.matches[mi];
          await DB.createFixture({
            tournament   : tournamentId,
            round        : ri + 1,
            match_number : mi + 1,
            round_label  : round.label,
            home_team    : teamMap[m.a] ?? null,
            away_team    : teamMap[m.b] ?? null,
            is_bye       : false,
            status       : 'scheduled',
            group_name   : null,
          });
        }
      }
    }
  },

  /* ── 10f. FIXTURES SCREEN ────────────────────────────────────────────── */

  _renderFixturesScreen(activeTab = 0) {
    const t  = State.activeTournament;
    const fx = State.fixtures;

    // Build the fixtures screen header — include event name if present
    const eventBadge = t.event_name
      ? `<span style="font-size:11px;color:var(--text-tertiary);background:var(--bg-secondary);
                      border-radius:4px;padding:2px 7px;border:0.5px solid var(--border-light);">
           🏆 ${escHtml(t.event_name)}
         </span>`
      : '';

    document.getElementById('sched-title').textContent = t.name;
    document.getElementById('sched-meta').innerHTML    =
      `${State.teams.length} teams · ${t.format.replace(/_/g, ' ')} ${eventBadge}`;
    UI.setStatusBadge(t.status);

    const realFx = fx.filter(f => !f.is_bye);
    const done   = realFx.filter(f => f.status === 'completed').length;
    const rounds = [...new Set(fx.map(f => f.round))].length;

    document.getElementById('stats-row').innerHTML = `
      <div class="stat-box">
        <div class="stat-val">${State.teams.length}</div>
        <div class="stat-lbl">Teams</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${done}/${realFx.length}</div>
        <div class="stat-lbl">Played</div>
      </div>
      <div class="stat-box">
        <div class="stat-val">${rounds}</div>
        <div class="stat-lbl">Rounds</div>
      </div>`;

    if (t.format === 'round_robin') {
      document.getElementById('tab-row').innerHTML =
        '<button class="tab" onclick="UI.switchTab(0)">Schedule</button>';
      document.getElementById('tab-panels').innerHTML =
        `<div class="tab-panel">${App._renderScheduleList(fx)}</div>`;

    } else if (t.format === 'elimination') {
      document.getElementById('tab-row').innerHTML = `
        <button class="tab" onclick="UI.switchTab(0)">Schedule</button>
        <button class="tab" onclick="UI.switchTab(1)">Bracket</button>`;
      document.getElementById('tab-panels').innerHTML = `
        <div class="tab-panel">${App._renderScheduleList(fx)}</div>
        <div class="tab-panel">${App._renderNbaBracket(fx)}</div>`;

    } else {
      const groupFx    = fx.filter(f => f.group_name);
      const knockoutFx = fx.filter(f => !f.group_name);
      document.getElementById('tab-row').innerHTML = `
        <button class="tab" onclick="UI.switchTab(0)">Groups</button>
        <button class="tab" onclick="UI.switchTab(1)">Standings</button>
        <button class="tab" onclick="UI.switchTab(2)">Knockout</button>`;
      document.getElementById('tab-panels').innerHTML = `
        <div class="tab-panel">${App._renderGroupSchedule(groupFx)}</div>
        <div class="tab-panel">${App._renderGroupStandings()}</div>
        <div class="tab-panel">${App._renderScheduleList(knockoutFx)}</div>`;
    }

    const tabCount = document.querySelectorAll('.tab').length;
    UI.switchTab(Math.min(activeTab, tabCount - 1));
  },

  _renderScheduleList(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.round_label || `Round ${f.round}`;
      if (!rounds[key]) rounds[key] = [];
      rounds[key].push(f);
    });
    if (!Object.keys(rounds).length) {
      return '<div class="text-muted" style="padding:1rem 0">No matches yet.</div>';
    }
    return Object.entries(rounds).map(([label, matches]) =>
      `<div class="round-section">
        <div class="round-label">${label}</div>
        ${matches.map((m, i) => App._matchCard(m, i + 1)).join('')}
      </div>`
    ).join('');
  },

  _renderGroupSchedule(fixtures) {
    const groups = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.group_name || 'Group';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });
    return Object.entries(groups).map(([name, matches]) =>
      `<div class="round-section">
        <div class="round-label">${name}</div>
        ${matches.map((m, i) => App._matchCard(m, i + 1)).join('')}
      </div>`
    ).join('');
  },

  _renderGroupStandings() {
    const groupNames = [...new Set(
      State.fixtures.filter(f => f.group_name).map(f => f.group_name)
    )].sort();

    if (!groupNames.length) {
      return '<div class="text-muted" style="padding:1rem 0">No group data yet.</div>';
    }

    return groupNames.map(gName => {
      const rows = _computeGroupStandings(State.fixtures, State.teams, gName);
      const tableRows = rows.map((s, i) => {
        const isAdvancing = i < 2;
        return `<tr style="${isAdvancing ? 'background:var(--bg-success)' : ''}">
          <td style="padding:6px 8px;font-size:12px;font-weight:500;color:${isAdvancing ? 'var(--accent)' : 'var(--text-secondary)'}">
            ${i + 1}${isAdvancing ? ' ✓' : ''}
          </td>
          <td style="padding:6px 8px;font-size:13px;font-weight:${isAdvancing ? '600' : '400'}">${escHtml(s.name)}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center">${s.played}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:600;color:var(--accent)">${s.wins}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center">${s.losses}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;color:${s.pointDiff >= 0 ? 'var(--accent)' : 'var(--danger)'}">${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff}</td>
        </tr>`;
      }).join('');

      return `<div class="round-section">
        <div class="round-label">${gName} <span style="font-size:10px;color:var(--text-tertiary);font-style:italic">✓ advances</span></div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;background:var(--bg-primary);border-radius:var(--radius-md);overflow:hidden;border:0.5px solid var(--border-light)">
            <thead>
              <tr style="background:var(--bg-secondary)">
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:left">#</th>
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:left">Team</th>
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">P</th>
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">W</th>
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">L</th>
                <th style="padding:6px 8px;font-size:10px;font-weight:500;color:var(--text-tertiary);text-align:center">+/-</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
  },

  _renderNbaBracket(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      if (!rounds[f.round]) rounds[f.round] = [];
      rounds[f.round].push(f);
    });

    const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
    if (!roundNums.length) {
      return '<div class="text-muted" style="padding:1rem 0">No bracket data yet.</div>';
    }

    const CARD_H    = 68;
    const CARD_GAP  = 12;
    const COL_W     = 180;
    const COL_GAP   = 40;
    const PADDING_V = 20;

    const r1Count = rounds[roundNums[0]].length;
    const canvasH = r1Count * CARD_H + (r1Count - 1) * CARD_GAP + PADDING_V * 2;

    function cardCentreY(index, total) {
      const totalHeight = total * CARD_H + (total - 1) * CARD_GAP;
      const startY      = (canvasH - totalHeight) / 2;
      return startY + index * (CARD_H + CARD_GAP) + CARD_H / 2;
    }

    const cols = roundNums.map((roundNum, colIdx) => {
      const matches = rounds[roundNum];
      const total   = matches.length;

      const cards = matches.map((m, i) => {
        const hn   = m.expand?.home_team?.name || 'TBD';
        const an   = m.expand?.away_team?.name || 'TBD';
        const isDone = m.status === 'completed';
        const wH   = isDone && m.winner === m.home_team;
        const wA   = isDone && m.winner === m.away_team;
        const can  = !isDone && hn !== 'TBD' && an !== 'TBD';

        const totalH = total * CARD_H + (total - 1) * CARD_GAP;
        const startY = (canvasH - totalH) / 2;
        const top    = startY + i * (CARD_H + CARD_GAP);

        return `<div class="nba-match ${isDone ? 'done' : ''} ${can ? 'clickable' : ''} ${hn === 'TBD' && an === 'TBD' ? 'tbd-match' : ''}"
                     style="top:${top}px;width:${COL_W}px;"
                     ${can ? `onclick="App.openScoreModal('${m.id}')"` : ''}>
          <div class="nba-team ${wH ? 'winner' : ''} ${hn === 'TBD' ? 'tbd' : ''}">
            <span class="nba-seed">${m.expand?.home_team ? State.teams.findIndex(t=>t.id===m.home_team)+1 : ''}</span>
            <span class="nba-name">${escHtml(hn)}</span>
            ${isDone ? `<span class="nba-score">${m.home_score}</span>` : ''}
          </div>
          <div class="nba-divider"></div>
          <div class="nba-team ${wA ? 'winner' : ''} ${an === 'TBD' ? 'tbd' : ''}">
            <span class="nba-seed">${m.expand?.away_team ? State.teams.findIndex(t=>t.id===m.away_team)+1 : ''}</span>
            <span class="nba-name">${escHtml(an)}</span>
            ${isDone ? `<span class="nba-score">${m.away_score}</span>` : ''}
          </div>
        </div>`;
      }).join('');

      const label = matches[0]?.round_label || `Round ${roundNum}`;
      return `<div class="nba-round" style="min-width:${COL_W}px;margin-right:${colIdx < roundNums.length - 1 ? COL_GAP : 0}px;">
        <div class="nba-round-label">${escHtml(label)}</div>
        <div class="nba-col" style="height:${canvasH}px;position:relative;">${cards}</div>
      </div>`;
    }).join('');

    let svgLines = '';
    for (let ci = 0; ci < roundNums.length - 1; ci++) {
      const thisRound = rounds[roundNums[ci]];
      const nextRound = rounds[roundNums[ci + 1]];
      const colLeft   = (COL_W + COL_GAP) * (ci + 1) - COL_GAP;

      for (let mi = 0; mi < thisRound.length; mi++) {
        const parentIdx = Math.floor(mi / 2);
        if (parentIdx >= nextRound.length) continue;

        const fromY = cardCentreY(mi, thisRound.length);
        const toY   = cardCentreY(parentIdx, nextRound.length);
        const midX  = colLeft + COL_GAP / 2;

        svgLines += `<line x1="${colLeft}" y1="${fromY}" x2="${midX}" y2="${fromY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        if (mi % 2 === 0 && mi + 1 < thisRound.length) {
          const siblingY = cardCentreY(mi + 1, thisRound.length);
          svgLines += `<line x1="${midX}" y1="${fromY}" x2="${midX}" y2="${siblingY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
        if (mi % 2 === 0) {
          svgLines += `<line x1="${midX}" y1="${toY}" x2="${colLeft + COL_GAP}" y2="${toY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
      }
    }

    const totalW = roundNums.length * COL_W + (roundNums.length - 1) * COL_GAP + 2;
    const svg = `<svg class="nba-connectors" width="${totalW}" height="${canvasH + 24}"
                      style="position:absolute;top:24px;left:0;pointer-events:none;overflow:visible">
      ${svgLines}
    </svg>`;

    return `
      <style>
        .nba-bracket-wrap{overflow-x:auto;padding-bottom:1rem}
        .nba-bracket{display:flex;align-items:flex-start;position:relative;min-width:max-content}
        .nba-round{display:flex;flex-direction:column}
        .nba-round-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-tertiary);text-align:center;padding-bottom:8px;height:24px;display:flex;align-items:center;justify-content:center}
        .nba-col{position:relative}
        .nba-match{position:absolute;background:var(--bg-primary);border:1px solid var(--border-light);border-radius:var(--radius-md);overflow:hidden;transition:border-color .15s,box-shadow .15s}
        .nba-match.clickable{cursor:pointer}
        .nba-match.clickable:hover{border-color:var(--accent);box-shadow:0 2px 10px rgba(29,158,117,.18)}
        .nba-match.done{border-color:var(--accent)}
        .nba-match.tbd-match{opacity:.45}
        .nba-team{display:flex;align-items:center;gap:6px;padding:6px 8px;height:34px;font-size:12px;min-width:0}
        .nba-team.winner{background:var(--bg-success)}
        .nba-team.tbd{opacity:.6}
        .nba-divider{height:1px;background:var(--border-light)}
        .nba-seed{font-size:10px;color:var(--text-tertiary);min-width:14px;text-align:right;flex-shrink:0}
        .nba-name{flex:1;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)}
        .nba-team.winner .nba-name{color:var(--accent);font-weight:600}
        .nba-team.tbd .nba-name{color:var(--text-tertiary);font-style:italic;font-weight:400}
        .nba-score{font-size:12px;font-weight:700;color:var(--text-tertiary);flex-shrink:0;margin-left:4px}
        .nba-team.winner .nba-score{color:var(--accent)}
        .nba-connectors{position:absolute;top:0;left:0;pointer-events:none}
      </style>
      <div class="nba-bracket-wrap">
        <div class="nba-bracket">
          ${svg}${cols}
        </div>
      </div>`;
  },

  _matchCard(fixture, num) {
    const homeName = fixture.expand?.home_team?.name || 'TBD';
    const awayName = fixture.expand?.away_team?.name || 'TBD';
    const isDone   = fixture.status === 'completed';
    const canEnter = !isDone && homeName !== 'TBD' && awayName !== 'TBD' && Auth.isAdmin();
    const wHome    = isDone && fixture.winner === fixture.home_team;
    const wAway    = isDone && fixture.winner === fixture.away_team;

    const scoreHtml = isDone
      ? `<span class="match-score">${fixture.home_score} – ${fixture.away_score}</span>`
      : canEnter ? `<span class="match-action">Tap to enter</span>` : '';

    const editBtn = isDone
      ? `<button class="btn sm ghost" onclick="App.openEditModal('${fixture.id}')" title="Edit result">✏️</button>`
      : '';

    return `<div class="match-card ${isDone ? 'completed' : ''} ${canEnter ? 'clickable' : ''}"
                 ${canEnter ? `onclick="App.openScoreModal('${fixture.id}')"` : ''}>
      <span class="match-num">M${num}</span>
      <span class="team-a ${homeName==='TBD'?'tbd':''} ${wHome?'winner-bold':''}">${escHtml(homeName)}</span>
      <span class="vs">vs</span>
      <span class="team-b ${awayName==='TBD'?'tbd':''} ${wAway?'winner-bold':''}">${escHtml(awayName)}</span>
      ${scoreHtml}
      ${editBtn}
    </div>`;
  },

  /* ── 10g. SCORE ENTRY ────────────────────────────────────────────────── */

  async openScoreModal(fixtureId) {
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId, {
        expand: 'home_team,away_team,winner',
      });
      UI.openModal(fixture, false);
    } catch (e) {
      Logger.error('openScoreModal failed', { error: e.message });
    }
  },

  async openEditModal(fixtureId) {
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId, {
        expand: 'home_team,away_team,winner',
      });
      UI.openModal(fixture, true);
    } catch (e) {
      Logger.error('openEditModal failed', { error: e.message });
    }
  },

  async saveResult() {
    const fixture = State.activeFixture;
    const isEdit  = State.isEditMode;
    if (!fixture) return;

    const homeScore = parseInt(document.getElementById('score-home').value, 10);
    const awayScore = parseInt(document.getElementById('score-away').value, 10);
    const errEl     = document.getElementById('modal-error');
    errEl.classList.remove('visible');

    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      errEl.textContent = 'Enter valid scores (0 or higher) for both teams.';
      errEl.classList.add('visible');
      return;
    }
    if (homeScore === awayScore) {
      errEl.textContent = 'Scores cannot be equal — there must be a winner.';
      errEl.classList.add('visible');
      return;
    }

    const activeTabIdx = (() => {
      const tabs = document.querySelectorAll('.tab');
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].classList.contains('active')) return i;
      }
      return 0;
    })();

    const btn = document.getElementById('btn-save-result');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

    try {
      const winnerId = homeScore > awayScore ? fixture.home_team : fixture.away_team;

      // A bracket match is either a pure elimination match, OR a group-stage
      // knockout fixture (group_name is null/empty for knockout rounds)
      const isBracketMatch =
        State.activeTournament.format === 'elimination' ||
        (State.activeTournament.format === 'group_stage' && !fixture.group_name);

      if (isEdit && isBracketMatch) {
        await DB.clearAdvancedWinner(fixture.tournament, fixture.round, fixture.match_number);
      }

      await DB.saveFixtureResult(fixture.id, homeScore, awayScore, winnerId);

      if (isBracketMatch) {
        await DB.advanceWinnerElimination(fixture.tournament, fixture.round, fixture.match_number, winnerId);
        await DB.repairNextFixture(fixture.tournament, fixture.round, fixture.match_number, winnerId);
      }

      let groupJustFinished = false;
      if (State.activeTournament.format === 'group_stage') {
        const seeded = await DB.seedKnockoutFromGroups(fixture.tournament, State.teams);
        if (seeded) groupJustFinished = true;
      }

      State.fixtures = await DB.getFixtures(fixture.tournament);

      const realFx  = State.fixtures.filter(f => !f.is_bye);
      const allDone = realFx.every(f => f.status === 'completed');
      const status  = allDone ? 'completed' : 'active';
      await DB.updateTournament(fixture.tournament, { status });
      State.activeTournament.status = status;

      document.getElementById('modal-overlay').classList.remove('open');
      State.activeFixture = null;
      State.isEditMode    = false;

      App._renderFixturesScreen(groupJustFinished ? 2 : activeTabIdx);
      UI.showSuccess('fixtures-success', 'fixtures-success-msg',
        isEdit ? 'Result updated.' : 'Result saved.');

    } catch (e) {
      Logger.error('saveResult failed', { error: e.message, stack: e.stack });
      errEl.textContent = `Save failed: ${e.message}`;
      errEl.classList.add('visible');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Save result'; }
    }
  },
  
/*---------------AUTH RENDER -------------------*/
_renderAuthBar() {
    const bar  = document.getElementById('auth-bar');
    if (!bar) return;
    const user = Auth.user();

    if (user) {
        const roleLabel = {
            super_admin      : '⚡ Super Admin',
            tournament_admin : '✏️ Tournament Admin',
        }[user.role] || user.role;

    bar.innerHTML = `
        <span style="font-size:12px;color:var(--text-secondary);">
            ${escHtml(user.email)}
            <span style="margin-left:6px;font-size:10px;padding:2px 6px; border-radius:4px;background:var(--bg-secondary); color:var(--text-tertiary);border:0.5px solid var(--border-light);">
                ${roleLabel}
            </span>
        </span>
        <button class="btn sm ghost" onclick="Auth.logout()">Sign out</button>`;
    } else {
      bar.innerHTML = `
        <span style="font-size:12px;color:var(--text-tertiary);">Viewing as guest</span>
        <a href="login.html" class="btn sm primary">Sign in</a>`;
    }
  },
};

/* =============================================================================
   11. HELPERS
   ============================================================================= */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* =============================================================================
   12. GLOBAL ERROR HANDLERS
   ============================================================================= */
window.addEventListener('error', e => {
  Logger.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', e => {
  Logger.error('Unhandled promise rejection', { reason: String(e.reason) });
});

/* =============================================================================
   13. BOOT
   ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM ready — booting Tournament Manager v5.0.0');
  if (document.getElementById('screen-home')) {
    App.init().catch(e => Logger.error('App.init failed', { error: e.message }));
  }
});
