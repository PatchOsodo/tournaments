/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — main.js
 * Version : 4.2.0
 *
 * CHANGES FROM v4.1
 * ---------------
 * BUG FIX 1 — genElimination() round 1 loop:
 *   nextSlot was computed as `i % 4 === 0 ? 'home' : 'away'` where i is the
 *   slot index (0,2,4,6…). This caused slots 0 and 4 to both map to 'home',
 *   breaking bye seeding for any bracket larger than 4 slots.
 *   Fixed to: `matchNumber % 2 === 1 ? 'home' : 'away'` using the 1-indexed
 *   match number, which correctly alternates home/away per match pair.
 *
 * BUG FIX 2 — genElimination() round 1 loop:
 *   nextMatchNumber was `Math.floor(i/2)+1` which happened to produce the same
 *   result as the correct formula but expressed wrong intent. Replaced with the
 *   canonical `Math.ceil(matchNumber/2)` for clarity and correctness.
 *
 * BUG FIX 3 — _persistFixtures() group_stage knockout block:
 *   Knockout fixture round numbers were stored as `roundOffset + round.roundNumber`
 *   where round.roundNumber is already 1-indexed within the knockout sub-bracket.
 *   This double-counted the offset, causing knockout fixtures to receive round
 *   numbers that didn't match what advanceWinnerElimination searched for.
 *   Fixed to: `roundOffset + ri + 1` (sequential index into knockout rounds).
 *
 * TABLE OF CONTENTS
 * -----------------
 * 1.  Configuration
 * 2.  Logger
 * 3.  PocketBase Client
 * 4.  UI Helpers
 * 5.  Application State
 * 6.  Format Configuration & suggestFormat
 * 7.  Fixture Generation Algorithms
 *       7a. Round Robin
 *       7b. Single Elimination  ← FIXED (nextSlot, nextMatchNumber)
 *       7c. Group Stage
 * 8.  Database Layer (DB)
 *       advanceWinnerElimination
 *       clearAdvancedWinner
 * 9.  App Controller
 *       9a. Initialisation
 *       9b. Home Screen
 *       9c. Setup Screen
 *       9d. Names Screen
 *       9e. Fixture Generation & Persistence  ← FIXED (knockout round numbering)
 *       9f. Fixtures Screen / Render Helpers
 *       9g. Score Entry (new + edit)
 * 10. Helpers
 * 11. Global Error Handlers
 * 12. Boot
 * =============================================================================
 */

/* =============================================================================
   1. CONFIGURATION
   ============================================================================= */
const CONFIG = {
  API_BASE_URL : window.location.origin,
  VERSION      : '4.2.0',
};

/* =============================================================================
   2. LOGGER
   Writes to both the browser console and the in-page debug log panel.

   Usage:
     Logger.info('message', { optional: 'context' });
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
   4. UI HELPERS
   Pure DOM utilities — no business logic.
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
    teamCount : 8,
    format    : 'elimination',
    name      : '',
    names     : [],
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
   Pure functions — no DB calls, no side effects.
   ============================================================================= */

/* -----------------------------------------------------------------------------
   7a. ROUND ROBIN — circle rotation method (unchanged)

   Every team plays every other team once.
   Odd team counts get a synthetic BYE to keep pairs even.
   ----------------------------------------------------------------------------- */
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
    list.splice(1, 0, list.pop()); // rotate keeping position 0 fixed
  }

  const totalMatches = rounds.reduce((s, r) => s + r.matches.length, 0);
  Logger.debug('genRoundRobin done', { rounds: rounds.length, totalMatches });
  return { type: 'round_robin', rounds, totalMatches };
}

/* -----------------------------------------------------------------------------
   7b. SINGLE ELIMINATION — fixed-slot seed tree

   APPROACH
   ────────
   We build the bracket as a complete binary tree of size (next power of 2).
   Teams are placed into leaf slots 1..size. Slots beyond the real team count
   are BYE slots.

   A "BYE match" in round 1 is a match where one competitor is a BYE.
   The real team is the automatic winner and will be seeded directly into
   round 2 during persistence (see _persistFixtures). The bye match itself
   IS persisted as is_bye=true so the bracket renders correctly.

   Round-label naming follows standard tournament convention:
     Final, Semifinals, Quarterfinals, Round of 16, Round of 32 …

   SLOT → NEXT-ROUND MAPPING
   ──────────────────────────
   Match number M in round R feeds into match ceil(M/2) in round R+1.
   Odd M fills home_team; even M fills away_team.
   This mapping is deterministic and stored in each match object so
   DB.advanceWinnerElimination can look it up without recalculating.

   EXAMPLE — 6 teams (padded to 8, 2 byes)
   ──────────────────────────────────────────
   Round 1 (Round of 8):
     M1: Team1 vs Team2      → winner goes to R2 M1 home
     M2: Team3 vs Team4      → winner goes to R2 M1 away
     M3: Team5 vs BYE        → Team5 auto-advances to R2 M2 home
     M4: Team6 vs BYE        → Team6 auto-advances to R2 M2 away

   Round 2 (Semifinals):
     M1: [W:R1M1] vs [W:R1M2]   → winner to Final home
     M2: Team5    vs Team6       → winner to Final away

   Round 3 (Final):
     M1: [W:R2M1] vs [W:R2M2]
   ----------------------------------------------------------------------------- */
function genElimination(teams) {
  Logger.debug('genElimination', { count: teams.length });

  // Step 1: pad to next power of 2
  let size = 1;
  while (size < teams.length) size *= 2;
  const byes = size - teams.length;
  Logger.info('genElimination bracket size', { teams: teams.length, size, byes });

  // Step 2: fill slots — real teams first, then BYEs at the end
  const slots = [...teams, ...Array(byes).fill('BYE')];

  // Step 3: build round 1 from adjacent pairs of slots
  const totalRounds = Math.log2(size);
  const allRounds   = [];

  const round1Matches = [];
  for (let i = 0; i < size; i += 2) {
    const a           = slots[i];
    const b           = slots[i + 1];
    const isBye       = b === 'BYE';
    const matchNumber = Math.floor(i / 2) + 1;  // 1-indexed match number

    round1Matches.push({
      a,
      b,
      isBye,
      nextRound       : 2,
      // FIX 1 & 2: use matchNumber (not slot index i) for both nextMatchNumber
      // and nextSlot. Previously `i % 4 === 0` caused slots 0 and 4 to both
      // resolve to 'home', breaking bye seeding on brackets larger than 4 slots.
      nextMatchNumber : Math.ceil(matchNumber / 2),
      nextSlot        : matchNumber % 2 === 1 ? 'home' : 'away',
    });
  }

  const r1Label = _roundLabel(round1Matches.length, totalRounds, 1);
  allRounds.push({ roundNumber: 1, label: r1Label, matches: round1Matches });

  // Step 4: build subsequent rounds as all-TBD placeholders
  let matchCount = size / 2;  // round 1 match count
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
    size,
    byes,
    rounds        : allRounds.length,
    totalMatches,
    byeMatches    : round1Matches.filter(m => m.isBye).length,
    roundSummary  : allRounds.map(r => `${r.label}: ${r.matches.length} matches`),
  });

  return { type: 'elimination', rounds: allRounds, totalMatches };
}

/**
 * Derive the display label for a round.
 * @param {number} matchCount    - Number of matches in this round
 * @param {number} totalRounds   - Total rounds in the bracket
 * @param {number} roundNumber   - 1-indexed round number
 */
function _roundLabel(matchCount, totalRounds, roundNumber) {
  const fromEnd = totalRounds - roundNumber + 1; // 1 = final, 2 = semis, etc.
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

/* -----------------------------------------------------------------------------
   7c. GROUP STAGE

   Groups are formed by interleaving teams (snake-style distribution).
   Round robin is run within each group.

   ADVANCEMENT (NBA-style tiebreaker):
     1. Most wins
     2. If tied → best point differential (points scored − points conceded)

   The top 2 from each group advance to a single elimination knockout.
   Standings are computed here for logging; live standings during a tournament
   are computed from actual fixture results in _computeGroupStandings().
   ----------------------------------------------------------------------------- */
function genGroupStage(teams) {
  Logger.debug('genGroupStage', { count: teams.length });
  const numGroups = teams.length <= 8 ? 2 : teams.length <= 12 ? 3 : 4;
  const groups    = Array.from({ length: numGroups }, () => []);

  // Snake distribution: 0→A, 1→B, 2→C, 3→B, 4→A … gives balanced groups
  teams.forEach((t, i) => groups[i % numGroups].push(t));

  Logger.info('Groups formed', { numGroups, sizes: groups.map(g => g.length) });

  const letters      = 'ABCDEFGH';
  const groupFixtures = groups.map((g, gi) => ({
    name   : `Group ${letters[gi]}`,
    teams  : g,
    rounds : genRoundRobin(g).rounds,
  }));

  // For generation purposes the top 2 per group are the first 2 teams
  // (seeding order). Actual progression is determined by live results
  // in App._computeGroupStandings() when results are entered.
  const advancers = groups.map(g => g.slice(0, 2)).flat();
  Logger.debug('Initial knockout seeds (pre-play)', { advancers });

  const knockout = genElimination(advancers);

  const totalGroupMatches = groupFixtures.reduce(
    (s, g) => s + g.rounds.reduce((rs, r) => rs + r.matches.length, 0), 0
  );
  const totalMatches = totalGroupMatches + knockout.totalMatches;

  Logger.debug('genGroupStage done', { totalGroupMatches, knockoutMatches: knockout.totalMatches, totalMatches });
  return { type: 'group_stage', groupFixtures, knockout, totalMatches, numGroups };
}

/**
 * Compute live group standings from fixture results.
 *
 * IMPORTANT: Team IDs are derived directly from the fixture records
 * (not from the teams collection's group_name field) so this works even
 * if the group_name field is missing or misconfigured on team records.
 *
 * RANKING CRITERIA (in order):
 *   1. Wins (descending)
 *   2. Point differential: (pts scored − pts conceded) (descending)
 *   3. Points scored (descending) — final tiebreaker
 *
 * @param {Array}  fixtures  - All fixtures for the tournament (with expand)
 * @param {Array}  teams     - All team records (used only for name lookup)
 * @param {string} groupName - Full group name e.g. 'Group A'
 * @returns {Array} sorted standing objects: [{ teamId, name, wins, losses, ptsFor, ptsAgainst, pointDiff }]
 */
function _computeGroupStandings(fixtures, teams, groupName) {
  // Get all fixtures (complete or not) for this group to find which teams are in it
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

  Logger.debug('_computeGroupStandings: teams in group', { groupName, count: teamIdsInGroup.size });

  // Build standings map keyed by team ID
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

  // Accumulate only completed fixtures
  const completedFx = allGroupFx.filter(f => f.status === 'completed');
  completedFx.forEach(f => {
    const homeId = resolveId(f.home_team);
    const awayId = resolveId(f.away_team);
    const home   = standingsMap[homeId];
    const away   = standingsMap[awayId];
    if (!home || !away) {
      Logger.warn('_computeGroupStandings: team not in standingsMap', { homeId, awayId });
      return;
    }

    home.played++;    away.played++;
    home.ptsFor    += (f.home_score || 0);   home.ptsAgainst += (f.away_score || 0);
    away.ptsFor    += (f.away_score || 0);   away.ptsAgainst += (f.home_score || 0);

    if ((f.home_score || 0) > (f.away_score || 0)) {
      home.wins++;  away.losses++;
    } else {
      away.wins++;  home.losses++;
    }
  });

  const sorted = Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins)           return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return b.ptsFor - a.ptsFor;
  });

  Logger.debug('_computeGroupStandings result', {
    groupName,
    standings: sorted.map(s => `${s.name} W:${s.wins} PD:${s.pointDiff}`),
  });

  return sorted;
}

/* =============================================================================
   8. DATABASE LAYER
   All PocketBase REST calls are centralised here.
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

  async getTournaments() {
    return pb.collection('tournaments').getFullList({ sort: '-created' });
  },

  async createTournament(name, format) {
    Logger.info('DB.createTournament', { name, format });
    return pb.collection('tournaments').create({ name, format, status: 'pending' });
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

  /**
   * After a result is saved, place the winner into the correct slot of the
   * next-round fixture.
   *
   * SLOT MAPPING:
   *   Match number M in round R:
   *     Odd  M → home_team slot of match ceil(M/2) in round R+1
   *     Even M → away_team slot of match ceil(M/2) in round R+1
   *
   * @param {string} tournamentId
   * @param {number} currentRound       - 1-indexed round number
   * @param {number} currentMatchNumber - 1-indexed match number within round
   * @param {string} winnerTeamId
   */
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
        Logger.warn('advanceWinner: no next fixture (this may be the final)', { nextRound, nextMatchNumber });
        return;
      }
      await pb.collection('fixtures').update(nextFx[0].id, { [slot]: winnerTeamId });
      Logger.info('Winner placed', { nextFixtureId: nextFx[0].id, slot });
    } catch (e) {
      Logger.warn('advanceWinner failed', { error: e.message });
    }
  },

  /**
   * When editing an elimination result, clear the previously advanced team
   * from the next-round fixture (and cascade: clear that fixture's result
   * too since it is now invalid).
   */
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

/**
   * After advancing a winner, verify the next-round fixture actually received
   * the team in the correct slot. If not (e.g. old buggy round numbering in DB),
   * find the fixture by scanning and patch it directly.
   *
   * This is safe to call on every save — if the slot is already correct it
   * is a no-op.
   *
   * @param {string} tournamentId
   * @param {number} currentRound
   * @param {number} currentMatchNumber
   * @param {string} winnerTeamId
   */
  async repairNextFixture(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      // First check the expected fixture — if it already has the right winner, done
      const expected = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber} && !is_bye`,
      });

      if (expected.length) {
        const fx       = expected[0];
        const current  = typeof fx[slot] === 'object' ? fx[slot]?.id : fx[slot];
        if (current === winnerTeamId) {
          Logger.debug('repairNextFixture: slot already correct', { slot, fixtureId: fx.id });
          return;
        }
        // Slot exists but has wrong value — overwrite it
        await pb.collection('fixtures').update(fx.id, { [slot]: winnerTeamId });
        Logger.warn('repairNextFixture: corrected wrong slot value', {
          fixtureId : fx.id,
          slot,
          was       : current,
          now       : winnerTeamId,
        });
        return;
      }

      // Expected fixture not found by round/match — scan knockout fixtures
      // and find the one that should logically follow this match.
      // This handles old tournaments where round numbers were stored with the
      // v4.1 offset bug and don't match the expected nextRound value.
      Logger.warn('repairNextFixture: expected fixture not found, scanning', {
        expectedRound: nextRound, expectedMatch: nextMatchNumber,
      });

      const allKnockout = await pb.collection('fixtures').getFullList({
        filter : `tournament = "${tournamentId}" && group_name = "" && !is_bye`,
        sort   : 'round,match_number',
      });

      // Group knockout fixtures by round, then find the round after the current one
      const rounds = [...new Set(allKnockout.map(f => f.round))].sort((a, b) => a - b);
      const currentRoundIdx = rounds.indexOf(currentRound);
      if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) {
        Logger.debug('repairNextFixture: no subsequent knockout round found (may be the final)');
        return;
      }

      const actualNextRound = rounds[currentRoundIdx + 1];
      const nextRoundFx     = allKnockout
        .filter(f => f.round === actualNextRound)
        .sort((a, b) => a.match_number - b.match_number);

      // Determine which fixture in the next round this match feeds into
      const currentRoundFx  = allKnockout
        .filter(f => f.round === currentRound)
        .sort((a, b) => a.match_number - b.match_number);
      const positionInRound = currentRoundFx.findIndex(f => f.match_number === currentMatchNumber);
      const targetFixtureIdx = Math.floor(positionInRound / 2);
      const targetSlot       = positionInRound % 2 === 0 ? 'home_team' : 'away_team';

      if (targetFixtureIdx >= nextRoundFx.length) {
        Logger.warn('repairNextFixture: target fixture index out of range', { targetFixtureIdx });
        return;
      }

      const targetFx    = nextRoundFx[targetFixtureIdx];
      const currentVal  = typeof targetFx[targetSlot] === 'object'
        ? targetFx[targetSlot]?.id
        : targetFx[targetSlot];

      if (currentVal === winnerTeamId) {
        Logger.debug('repairNextFixture: scan found slot already correct');
        return;
      }

      await pb.collection('fixtures').update(targetFx.id, { [targetSlot]: winnerTeamId });
      Logger.warn('repairNextFixture: patched via scan', {
        fixtureId  : targetFx.id,
        slot       : targetSlot,
        winnerTeamId,
      });

    } catch (e) {
      Logger.warn('repairNextFixture failed', { error: e.message });
    }
  },

  /**
   * After all group matches complete, rank each group by wins then point
   * differential, then seed the top-2 finishers into the knockout bracket
   * using cross-group matchups.
   *
   * Cross-seed pattern (N groups, 2 advance per group):
   *   firsts  = [A1, B1, C1, …]
   *   seconds = [A2, B2, C2, …]
   *   slots   = [A1, B2, B1, C2, C1, A2]   (each 1st vs next group's 2nd)
   *
   * SAFE TO CALL UNCONDITIONALLY — checks internally whether all groups are
   * complete before doing anything. Returns true if seeding was performed.
   *
   * @param {string} tournamentId
   * @param {Array}  allTeams - Team records (used for name lookups only)
   * @returns {Promise<boolean>} true if knockout was seeded, false if not ready
   */
  async seedKnockoutFromGroups(tournamentId, allTeams) {
    Logger.info('DB.seedKnockoutFromGroups: checking group completion');

    const freshFixtures = await pb.collection('fixtures').getFullList({
      filter : `tournament = "${tournamentId}"`,
      sort   : 'round,match_number',
      expand : 'home_team,away_team,winner',
    });

    const groupFxAll = freshFixtures.filter(f => f.group_name && !f.is_bye);
    if (!groupFxAll.length) {
      Logger.warn('seedKnockoutFromGroups: no group fixtures found');
      return false;
    }
    const allGroupsDone = groupFxAll.every(f => f.status === 'completed');
    if (!allGroupsDone) {
      const remaining = groupFxAll.filter(f => f.status !== 'completed').length;
      Logger.debug('seedKnockoutFromGroups: groups not complete yet', { remaining });
      return false;
    }

    Logger.info('seedKnockoutFromGroups: all group matches done — seeding knockout');

    const groupNames = [...new Set(groupFxAll.map(f => f.group_name))].sort();
    Logger.info('Groups found', { groupNames });

    const groupRankings = groupNames.map(gName => {
      const standings = _computeGroupStandings(freshFixtures, allTeams, gName);
      if (standings.length < 2) {
        Logger.error('Fewer than 2 teams ranked in group', { gName, count: standings.length });
      }
      const top2 = standings.slice(0, 2);
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

    Logger.info('Advancers', advancers.map((a, i) =>
      `[${i}] ${a?.name ?? 'MISSING'} id=${a?.teamId ?? 'NONE'}`));

    if (advancers.some(a => !a?.teamId)) {
      Logger.error('seedKnockoutFromGroups: missing teamId in advancers — aborting', {
        slots: advancers.map(a => a?.teamId ?? 'MISSING'),
      });
      return false;
    }

    const knockoutFx = freshFixtures
      .filter(f => !f.group_name && !f.is_bye)
      .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

    if (!knockoutFx.length) {
      Logger.error('seedKnockoutFromGroups: no knockout fixtures in DB');
      return false;
    }

    const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
    const firstRoundFx = knockoutFx
      .filter(f => f.round === firstKoRound)
      .sort((a, b) => a.match_number - b.match_number);

    Logger.info('Updating first KO round fixtures', {
      round: firstKoRound,
      count: firstRoundFx.length,
    });

    for (let i = 0; i < firstRoundFx.length; i++) {
      const homeAdv = advancers[i * 2];
      const awayAdv = advancers[i * 2 + 1];

      await pb.collection('fixtures').update(firstRoundFx[i].id, {
        home_team : homeAdv.teamId,
        away_team : awayAdv.teamId,
      });

      Logger.info('Fixture seeded', {
        fixtureId : firstRoundFx[i].id,
        home      : homeAdv.name,
        away      : awayAdv.name,
      });
    }

    return true;
  },
};

/* =============================================================================
   MIGRATION — repair tournaments created with v4.1 buggy fixture generation.

   Runs once on init. Safe to call repeatedly — all checks are idempotent.

   Two failure modes are repaired:
     A) Knockout fixtures empty (semifinals not seeded) — group stage complete
        but seedKnockoutFromGroups never fired or failed silently.
     B) Final empty (semifinals played but winners not advanced) — 
        advanceWinnerElimination failed to find the next fixture.
   ============================================================================= */
async function migrateExistingTournaments() {
  Logger.info('Migration: checking for broken tournaments');

  let tournaments;
  try {
    tournaments = await pb.collection('tournaments').getFullList({ sort: '-created' });
  } catch (e) {
    Logger.error('Migration: failed to fetch tournaments', { error: e.message });
    return;
  }

  const active = tournaments.filter(t =>
    t.status === 'active' && t.format === 'group_stage'
  );

  Logger.info('Migration: active group_stage tournaments to check', { count: active.length });

  for (const tournament of active) {
    try {
      await _migrateTournament(tournament);
    } catch (e) {
      Logger.error('Migration: failed for tournament', { id: tournament.id, error: e.message });
    }
  }

  Logger.info('Migration: complete');
}

async function _migrateTournament(tournament) {
  Logger.info('Migration: checking tournament', { id: tournament.id, name: tournament.name });

  const [allTeams, allFixtures] = await Promise.all([
    pb.collection('teams').getFullList({
      filter: `tournament = "${tournament.id}"`, sort: 'seed',
    }),
    pb.collection('fixtures').getFullList({
      filter: `tournament = "${tournament.id}"`,
      sort: 'round,match_number',
      expand: 'home_team,away_team,winner',
    }),
  ]);

  const groupFx    = allFixtures.filter(f => f.group_name && !f.is_bye);
  const knockoutFx = allFixtures.filter(f => !f.group_name && !f.is_bye);

  if (!groupFx.length || !knockoutFx.length) {
    Logger.debug('Migration: skipping — no group or knockout fixtures', { id: tournament.id });
    return;
  }

  const allGroupsDone = groupFx.every(f => f.status === 'completed');
  if (!allGroupsDone) {
    Logger.debug('Migration: groups not complete yet', { id: tournament.id });
    return;
  }

  // Check every completed knockout fixture and verify its winner is correctly
  // placed in the next round. This catches stale manual patches and any case
  // where advanceWinnerElimination fired but wrote to the wrong fixture.
  const completedKnockout = knockoutFx
    .filter(f => f.status === 'completed' && f.winner)
    .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

  // Also check first knockout round is seeded at all
  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const firstRoundFx = knockoutFx.filter(f => f.round === firstKoRound);
  const knockoutUnseeded = firstRoundFx.every(f => !f.home_team && !f.away_team);

  if (knockoutUnseeded) {
    Logger.warn('Migration: knockout unseeded — seeding now', { id: tournament.id });
    await _migrateSeeding(tournament.id, allTeams, allFixtures, knockoutFx);
    // Re-fetch after seeding before checking advancement
    return;
  }

  // Walk every completed knockout match and verify winner is in the right slot
  // of the next fixture. Fix it if not.
  let repaired = false;
  const rounds = [...new Set(knockoutFx.map(f => f.round))].sort((a, b) => a - b);

  for (const fx of completedKnockout) {
    const currentRoundIdx = rounds.indexOf(fx.round);
    if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) continue;

    const nextRound   = rounds[currentRoundIdx + 1];
    const currentRoundFx = knockoutFx
      .filter(f => f.round === fx.round)
      .sort((a, b) => a.match_number - b.match_number);
    const positionInRound  = currentRoundFx.findIndex(f => f.id === fx.id);
    const nextMatchIdx     = Math.floor(positionInRound / 2);
    const slot             = positionInRound % 2 === 0 ? 'home_team' : 'away_team';

    const nextRoundFx = knockoutFx
      .filter(f => f.round === nextRound)
      .sort((a, b) => a.match_number - b.match_number);

    if (nextMatchIdx >= nextRoundFx.length) continue;

    const nextFx     = nextRoundFx[nextMatchIdx];
    const winnerId   = typeof fx.winner === 'object' ? fx.winner.id : fx.winner;
    const currentVal = typeof nextFx[slot] === 'object' ? nextFx[slot]?.id : nextFx[slot];

    if (currentVal === winnerId) {
      Logger.debug('Migration: slot correct', { round: fx.round, match: fx.match_number, slot });
      continue;
    }

    Logger.warn('Migration: fixing wrong winner in next fixture', {
      from    : `R${fx.round}M${fx.match_number}`,
      nextId  : nextFx.id,
      slot,
      was     : currentVal,
      correct : winnerId,
    });

    await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerId });
    repaired = true;
  }

  if (repaired) {
    Logger.info('Migration: repairs applied', { id: tournament.id });
  } else {
    Logger.debug('Migration: tournament looks healthy', { id: tournament.id });
  }
}
/*async function _migrateTournament(tournament) {
  Logger.info('Migration: checking tournament', { id: tournament.id, name: tournament.name });

  const [allTeams, allFixtures] = await Promise.all([
    pb.collection('teams').getFullList({
      filter: `tournament = "${tournament.id}"`, sort: 'seed',
    }),
    pb.collection('fixtures').getFullList({
      filter: `tournament = "${tournament.id}"`,
      sort: 'round,match_number',
      expand: 'home_team,away_team,winner',
    }),
  ]);

  const groupFx    = allFixtures.filter(f => f.group_name && !f.is_bye);
  const knockoutFx = allFixtures.filter(f => !f.group_name && !f.is_bye);

  if (!groupFx.length || !knockoutFx.length) {
    Logger.debug('Migration: skipping — no group or knockout fixtures', { id: tournament.id });
    return;
  }

  const allGroupsDone = groupFx.every(f => f.status === 'completed');

  // ── Case A: group stage done but knockout not seeded yet
  if (allGroupsDone) {
    const knockoutEmpty = knockoutFx.every(f => !f.home_team && !f.away_team);
    const knockoutPartial = !knockoutEmpty &&
      knockoutFx.some(f => f.status !== 'completed' && (!f.home_team || !f.away_team));

    if (knockoutEmpty) {
      Logger.warn('Migration: knockout completely unseeded — seeding now', { id: tournament.id });
      await _migrateSeeding(tournament.id, allTeams, allFixtures, knockoutFx);
      return;
    }

    if (knockoutPartial) {
      Logger.warn('Migration: knockout partially played — checking for unadvanced winners', { id: tournament.id });
      await _migrateAdvancement(tournament.id, allFixtures, knockoutFx);
      return;
    }
  }

  Logger.debug('Migration: tournament looks healthy', { id: tournament.id });
}
*/
/**
 * Case A — seed the first knockout round from group standings.
 * Mirrors DB.seedKnockoutFromGroups but works from already-fetched data.
 */
async function _migrateSeeding(tournamentId, allTeams, allFixtures, knockoutFx) {
  const groupNames = [...new Set(
    allFixtures.filter(f => f.group_name && !f.is_bye).map(f => f.group_name)
  )].sort();

  const groupRankings = groupNames.map(gName => {
    const standings = _computeGroupStandings(allFixtures, allTeams, gName);
    Logger.info(`Migration: ${gName} standings`, standings.map(s => `${s.name} W:${s.wins} PD:${s.pointDiff}`));
    return standings.slice(0, 2);
  });

  const firsts  = groupRankings.map(g => g[0]);
  const seconds = groupRankings.map(g => g[1]);
  const advancers = [];
  for (let i = 0; i < firsts.length; i++) {
    advancers.push(firsts[i]);
    advancers.push(seconds[(i + 1) % seconds.length]);
  }

  if (advancers.some(a => !a?.teamId)) {
    Logger.error('Migration: missing teamId in advancers — aborting', {
      slots: advancers.map(a => a?.teamId ?? 'MISSING'),
    });
    return;
  }

  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const firstRoundFx = knockoutFx
    .filter(f => f.round === firstKoRound)
    .sort((a, b) => a.match_number - b.match_number);

  for (let i = 0; i < firstRoundFx.length; i++) {
    const homeAdv = advancers[i * 2];
    const awayAdv = advancers[i * 2 + 1];
    await pb.collection('fixtures').update(firstRoundFx[i].id, {
      home_team : homeAdv.teamId,
      away_team : awayAdv.teamId,
    });
    Logger.info('Migration: seeded fixture', {
      id   : firstRoundFx[i].id,
      home : homeAdv.name,
      away : awayAdv.name,
    });
  }
}

/**
 * Case B — find completed knockout fixtures whose winner was never advanced,
 * and push the winner into the correct slot of the next fixture.
 */
async function _migrateAdvancement(tournamentId, allFixtures, knockoutFx) {
  const completed = knockoutFx
    .filter(f => f.status === 'completed' && f.winner)
    .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

  for (const fx of completed) {
    const nextRound       = fx.round + 1;
    const nextMatchNumber = Math.ceil(fx.match_number / 2);
    const slot            = fx.match_number % 2 === 1 ? 'home_team' : 'away_team';

    const nextFx = knockoutFx.find(
      f => f.round === nextRound && f.match_number === nextMatchNumber
    );

    if (!nextFx) {
      Logger.debug('Migration: no next fixture (this is the final or last round)', {
        round: fx.round, match: fx.match_number,
      });
      continue;
    }

    const winnerId = typeof fx.winner === 'object' ? fx.winner.id : fx.winner;
    const currentSlotValue = nextFx[slot];
    const currentSlotId = typeof currentSlotValue === 'object'
      ? currentSlotValue?.id
      : currentSlotValue;

    if (currentSlotId === winnerId) {
      Logger.debug('Migration: slot already correct, skipping', { slot, nextFx: nextFx.id });
      continue;
    }

    Logger.warn('Migration: advancing winner into next fixture', {
      from : `R${fx.round}M${fx.match_number}`,
      to   : `R${nextRound}M${nextMatchNumber}`,
      slot,
      winner: fx.expand?.winner?.name ?? winnerId,
    });

    await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerId });
  }
}
/* =============================================================================
   9. APP CONTROLLER
   ============================================================================= */
const App = {

  /* ── 9a. INITIALISATION ──────────────────────────────────────────────── */

  async init() {
    Logger.info('App.init', { version: CONFIG.VERSION });
    const online = await DB.healthCheck();
    UI.setConnectionStatus(online);
    if (!online) {
      UI.showError('home-error', 'home-error-msg',
        'Cannot reach PocketBase. Ensure it is running: ./pocketbase serve');
    }
    App._initSetupScreen();
    await migrateExistingTournaments();
    await App.loadTournaments();
  },

  /* ── 9b. HOME SCREEN ─────────────────────────────────────────────────── */

  async loadTournaments() {
    Logger.info('loadTournaments');
    UI.clearError('home-error');
    const list = document.getElementById('tournament-list');
    if (!list) return;
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>Loading...</div>';

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

      list.innerHTML = tournaments.map(t => `
        <div class="tournament-item">
          <div class="tournament-item-info">
            <h3>${escHtml(t.name)}</h3>
            <p>${t.format.replace(/_/g, ' ')} · ${new Date(t.created).toLocaleDateString()}</p>
          </div>
          <div class="tournament-item-actions">
            <span class="status-badge badge-${t.status}">${t.status}</span>
            <button class="btn sm primary" onclick="App.openTournament('${t.id}')">Open</button>
            <a class="btn sm ghost" href="bracket.html?id=${t.id}" target="_blank">Bracket</a>
            <button class="btn sm danger" onclick="App.deleteTournament('${t.id}','${escHtml(t.name)}')">Delete</button>
          </div>
        </div>`).join('');

    } catch (e) {
      Logger.error('loadTournaments failed', { error: e.message });
      UI.showError('home-error', 'home-error-msg', `Could not load tournaments: ${e.message}`);
      list.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>Failed to load.</div>';
    }
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

  /* ── 9c. SETUP SCREEN ────────────────────────────────────────────────── */

  goToSetup() {
    State.setupData = { teamCount: 8, format: 'elimination', name: '', names: [] };
    const tc = document.getElementById('team-count');
    const tn = document.getElementById('tournament-name');
    if (tc) tc.value = 8;
    if (tn) tn.value = '';
    App._renderFormatGrid();
    UI.showScreen('screen-setup');
  },

  _initSetupScreen() {
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

  /* ── 9d. NAMES SCREEN ────────────────────────────────────────────────── */

  goToNames() {
    UI.clearError('setup-error');
    const nameVal = (document.getElementById('tournament-name')?.value || '').trim();
    const raw     = document.getElementById('team-count')?.value.trim();
    const n       = parseInt(raw, 10);

    if (!nameVal) {
      UI.showError('setup-error', 'setup-error-msg', 'Please enter a tournament name.');
      return;
    }
    if (!raw || isNaN(n) || n < 3 || n > 32) {
      UI.showError('setup-error', 'setup-error-msg', 'Enter a number of teams between 3 and 32.');
      document.getElementById('team-count')?.classList.add('input-error');
      return;
    }

    State.setupData.name      = nameVal;
    State.setupData.teamCount = n;

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

  /* ── 9e. FIXTURE GENERATION & PERSISTENCE ────────────────────────────── */

  async generateFixtures() {
    UI.clearError('names-error');
    Logger.info('generateFixtures');

    const names = Array.from({ length: State.setupData.teamCount }, (_, i) => {
      const el = document.getElementById(`tn-${i}`);
      return (el?.value.trim()) || `Team ${i + 1}`;
    });
    State.setupData.names = names;

    // Duplicate check
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
      // 1 — Create tournament
      const tournament = await DB.createTournament(State.setupData.name, State.setupData.format);
      Logger.info('Tournament record created', { id: tournament.id });

      // 2 — Create teams, build name → ID map
      const teamMap   = {};
      const numGroups = State.setupData.format === 'group_stage'
        ? (names.length <= 8 ? 2 : names.length <= 12 ? 3 : 4) : null;

      for (let i = 0; i < names.length; i++) {
        const groupName = numGroups ? 'ABCDEFGH'[i % numGroups] : null;
        const team      = await DB.createTeam(tournament.id, names[i], i + 1, groupName);
        teamMap[names[i]] = team.id;
        Logger.debug('Team created', { name: names[i], id: team.id, group: groupName });
      }

      // 3 — Generate fixture structure (pure, no DB)
      let generated;
      if      (State.setupData.format === 'round_robin') generated = genRoundRobin(names);
      else if (State.setupData.format === 'elimination') generated = genElimination(names);
      else                                               generated = genGroupStage(names);

      // 4 — Persist to PocketBase
      await App._persistFixtures(tournament.id, generated, teamMap);
      Logger.info('All fixtures persisted');

      // 5 — Activate
      await DB.updateTournament(tournament.id, { status: 'active' });

      // 6 — Load and navigate
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

  /**
   * Persist generated fixtures to PocketBase.
   *
   * KEY BEHAVIOUR: For elimination round 1, bye matches are saved with
   * is_bye=true and status='completed'. After saving, the real team is
   * immediately placed into the correct slot of the next-round fixture,
   * so round 2 arrives pre-populated with all known teams.
   *
   * @param {string} tournamentId
   * @param {object} generated   - Output of genRoundRobin / genElimination / genGroupStage
   * @param {object} teamMap     - { teamName: pocketbaseTeamId }
   */
  async _persistFixtures(tournamentId, generated, teamMap) {
    Logger.info('_persistFixtures', { type: generated.type });

    if (generated.type === 'elimination') {
      // ── Elimination: persist rounds in order, handle byes specially
      const savedFixtureMap = {};  // 'R{r}M{m}' → saved fixture record

      for (const round of generated.rounds) {
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m   = round.matches[mi];
          const key = `R${round.roundNumber}M${mi + 1}`;

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
          Logger.debug('Fixture saved', { key, isBye: m.isBye });
        }
      }

      // After all fixtures exist, seed bye winners into round 2
      const round1 = generated.rounds[0];
      for (let mi = 0; mi < round1.matches.length; mi++) {
        const m = round1.matches[mi];
        if (!m.isBye) continue;

        // The real team is always in slot 'a' (byes are always slot 'b')
        const winnerTeamId    = teamMap[m.a];
        const nextRound       = 2;
        const nextMatchNumber = m.nextMatchNumber;
        const slot            = m.nextSlot === 'home' ? 'home_team' : 'away_team';

        const nextKey = `R${nextRound}M${nextMatchNumber}`;
        const nextFx  = savedFixtureMap[nextKey];
        if (nextFx) {
          await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerTeamId });
          Logger.info('Bye winner seeded into next round', {
            team   : m.a,
            into   : nextKey,
            slot,
          });
        }
      }

    } else if (generated.type === 'group_stage') {
      // ── Group stage: round robin groups first, then knockout placeholders
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

      // FIX 3: Knockout round placeholders use sequential index `ri` rather
      // than `round.roundNumber`. Previously `roundOffset + round.roundNumber`
      // double-counted since roundNumber is already 1-indexed within the
      // knockout sub-bracket, causing knockout fixtures to get wrong round
      // values and advanceWinnerElimination to fail to find the next fixture.
      for (let ri = 0; ri < generated.knockout.rounds.length; ri++) {
        const round = generated.knockout.rounds[ri];
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m = round.matches[mi];
          await DB.createFixture({
            tournament   : tournamentId,
            round        : roundOffset + ri + 1,   // ← FIXED: was roundOffset + round.roundNumber
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
      // ── Round robin: straightforward
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

  /* ── 9f. FIXTURES SCREEN ─────────────────────────────────────────────── */

  /**
   * Render (or re-render) the fixtures screen.
   * @param {number} [activeTab=0] - Tab index to keep active after re-render.
   */
  _renderFixturesScreen(activeTab = 0) {
    const t  = State.activeTournament;
    const fx = State.fixtures;

    document.getElementById('sched-title').textContent = t.name;
    document.getElementById('sched-meta').textContent  =
      `${State.teams.length} teams · ${t.format.replace(/_/g, ' ')}`;
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
    const safeTab  = Math.min(activeTab, tabCount - 1);
    UI.switchTab(safeTab);
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

  /** Render standings tables for all groups (wins + point differential) */
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

  /**
   * NBA-style bracket renderer.
   *
   * Renders rounds as vertical columns with SVG connector lines between
   * matches that feed into each other.
   */
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

    const r1Count   = rounds[roundNums[0]].length;
    const canvasH   = r1Count * CARD_H + (r1Count - 1) * CARD_GAP + PADDING_V * 2;

    function cardCentreY(index, total) {
      const totalHeight = total * CARD_H + (total - 1) * CARD_GAP;
      const startY      = (canvasH - totalHeight) / 2;
      return startY + index * (CARD_H + CARD_GAP) + CARD_H / 2;
    }

    const cols = roundNums.map((roundNum, colIdx) => {
      const matches = rounds[roundNum];
      const total   = matches.length;

      const cards = matches.map((m, i) => {
        const hn    = m.expand?.home_team?.name || 'TBD';
        const an    = m.expand?.away_team?.name || 'TBD';
        const isDone= m.status === 'completed';
        const wH    = isDone && m.winner === m.home_team;
        const wA    = isDone && m.winner === m.away_team;
        const can   = !isDone && hn !== 'TBD' && an !== 'TBD';

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

        const fromY  = cardCentreY(mi, thisRound.length);
        const toY    = cardCentreY(parentIdx, nextRound.length);
        const midX   = colLeft + COL_GAP / 2;

        svgLines += `<line x1="${colLeft}" y1="${fromY}" x2="${midX}" y2="${fromY}"
                           stroke="var(--border-mid)" stroke-width="1.5" />`;
        if (mi % 2 === 0 && mi + 1 < thisRound.length) {
          const siblingY = cardCentreY(mi + 1, thisRound.length);
          svgLines += `<line x1="${midX}" y1="${fromY}" x2="${midX}" y2="${siblingY}"
                             stroke="var(--border-mid)" stroke-width="1.5" />`;
        }
        if (mi % 2 === 0) {
          svgLines += `<line x1="${midX}" y1="${toY}" x2="${colLeft + COL_GAP}" y2="${toY}"
                             stroke="var(--border-mid)" stroke-width="1.5" />`;
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
        .nba-bracket-wrap { overflow-x:auto; padding-bottom:1rem; }
        .nba-bracket {
          display:flex;
          align-items:flex-start;
          position:relative;
          min-width:max-content;
          padding-top:0;
        }
        .nba-round { display:flex; flex-direction:column; }
        .nba-round-label {
          font-size:10px;
          font-weight:600;
          text-transform:uppercase;
          letter-spacing:0.07em;
          color:var(--text-tertiary);
          text-align:center;
          padding-bottom:8px;
          margin-bottom:0;
          height:24px;
          display:flex;
          align-items:center;
          justify-content:center;
        }
        .nba-col { position:relative; }
        .nba-match {
          position:absolute;
          background:var(--bg-primary);
          border:1px solid var(--border-light);
          border-radius:var(--radius-md);
          overflow:hidden;
          transition:border-color 0.15s, box-shadow 0.15s;
        }
        .nba-match.clickable { cursor:pointer; }
        .nba-match.clickable:hover {
          border-color:var(--accent);
          box-shadow:0 2px 10px rgba(29,158,117,0.18);
        }
        .nba-match.done { border-color:var(--accent); }
        .nba-match.tbd-match { opacity:0.45; }
        .nba-team {
          display:flex;
          align-items:center;
          gap:6px;
          padding:6px 8px;
          height:34px;
          font-size:12px;
          min-width:0;
        }
        .nba-team.winner { background:var(--bg-success); }
        .nba-team.tbd    { opacity:0.6; }
        .nba-divider { height:1px; background:var(--border-light); }
        .nba-seed {
          font-size:10px;
          color:var(--text-tertiary);
          min-width:14px;
          text-align:right;
          flex-shrink:0;
        }
        .nba-name {
          flex:1;
          font-weight:500;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          color:var(--text-primary);
        }
        .nba-team.winner .nba-name { color:var(--accent); font-weight:600; }
        .nba-team.tbd .nba-name    { color:var(--text-tertiary); font-style:italic; font-weight:400; }
        .nba-score {
          font-size:12px;
          font-weight:700;
          color:var(--text-tertiary);
          flex-shrink:0;
          margin-left:4px;
        }
        .nba-team.winner .nba-score { color:var(--accent); }
        .nba-connectors { position:absolute; top:0; left:0; pointer-events:none; }
      </style>
      <div class="nba-bracket-wrap">
        <div class="nba-bracket">
          ${svg}
          ${cols}
        </div>
      </div>`;
  },

  _matchCard(fixture, num) {
    const homeName = fixture.expand?.home_team?.name || 'TBD';
    const awayName = fixture.expand?.away_team?.name || 'TBD';
    const isDone   = fixture.status === 'completed';
    const canEnter = !isDone && homeName !== 'TBD' && awayName !== 'TBD';
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
      <span class="team-a ${homeName === 'TBD' ? 'tbd' : ''} ${wHome ? 'winner-bold' : ''}">${escHtml(homeName)}</span>
      <span class="vs">vs</span>
      <span class="team-b ${awayName === 'TBD' ? 'tbd' : ''} ${wAway ? 'winner-bold' : ''}">${escHtml(awayName)}</span>
      ${scoreHtml}
      ${editBtn}
    </div>`;
  },

  /* ── 9g. SCORE ENTRY ─────────────────────────────────────────────────── */

  async openScoreModal(fixtureId) {
    Logger.info('openScoreModal', { fixtureId });
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
    Logger.info('openEditModal', { fixtureId });
    try {
      const fixture = await pb.collection('fixtures').getOne(fixtureId, {
        expand: 'home_team,away_team,winner',
      });
      UI.openModal(fixture, true);
    } catch (e) {
      Logger.error('openEditModal failed', { error: e.message });
    }
  },

  /** Save (new or edited) result from the modal */
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
      Logger.info('saveResult', { fixtureId: fixture.id, homeScore, awayScore, isEdit, winnerId });

      const isBracketMatch =
        State.activeTournament.format === 'elimination' ||
        (State.activeTournament.format === 'group_stage' && !fixture.group_name);

      Logger.debug('saveResult: isBracketMatch', {
        format      : State.activeTournament.format,
        groupName   : fixture.group_name || null,
        isBracketMatch,
      });

      if (isEdit && isBracketMatch) {
        await DB.clearAdvancedWinner(fixture.tournament, fixture.round, fixture.match_number);
      }

      await DB.saveFixtureResult(fixture.id, homeScore, awayScore, winnerId);

      if (isBracketMatch) {
        await DB.advanceWinnerElimination(
          fixture.tournament, fixture.round, fixture.match_number, winnerId
        );

        // After advancing, verify the next fixture actually received the winner.
        // Covers cases where a prior bug left the next fixture in a broken state
        // (e.g. wrong round number in DB) — we find it by content rather than
        // by the stored round/match fields, so it works on old and new data alike.
        await DB.repairNextFixture(
          fixture.tournament, fixture.round, fixture.match_number, winnerId
        );
      }

      let groupJustFinished = false;
      if (State.activeTournament.format === 'group_stage') {
        const seeded = await DB.seedKnockoutFromGroups(fixture.tournament, State.teams);
        if (seeded) {
          Logger.info('Knockout bracket seeded after group stage completion');
          groupJustFinished = true;
        }
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

      let targetTab = activeTabIdx;
      if (groupJustFinished) {
        targetTab = 2;
        Logger.info('Auto-switching to Knockout tab after group stage completion');
      }

      App._renderFixturesScreen(targetTab);
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
};

/* =============================================================================
   10. HELPERS
   ============================================================================= */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* =============================================================================
   11. GLOBAL ERROR HANDLERS
   ============================================================================= */
window.addEventListener('error', e => {
  Logger.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', e => {
  Logger.error('Unhandled promise rejection', { reason: String(e.reason) });
});

/* =============================================================================
   12. BOOT
   ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM ready — booting Tournament Manager v4.2.0');
  if (document.getElementById('screen-home')) {
    App.init().catch(e => Logger.error('App.init failed', { error: e.message }));
  }
});
