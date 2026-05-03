/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — bracket.js
 * Version : 3.0.0
 *
 * Handles the standalone bracket visualisation page (bracket.html).
 * Reads the tournament ID from the URL query string, fetches all data
 * from PocketBase, and renders a full interactive bracket.
 *
 * This file is intentionally separate from main.js so the bracket page
 * can be opened in its own tab without loading the full app controller.
 *
 * Dependencies (loaded by bracket.html):
 *   - assets/css/styles.css
 *   - assets/js/pocketbase.umd.js
 *   - assets/js/bracket.js  (this file)
 * =============================================================================
 */

/* =============================================================================
   CONFIGURATION — mirrors main.js
   ============================================================================= */
const CONFIG = {
  API_BASE_URL : window.location.origin,
  VERSION      : '3.0.0',
};

/* =============================================================================
   POCKETBASE CLIENT
   ============================================================================= */
const pb = new PocketBase(CONFIG.API_BASE_URL);

/* =============================================================================
   MINIMAL LOGGER
   Bracket page only logs to console (no in-page panel).
   ============================================================================= */
const Logger = {
  debug : (m, c) => console.debug(`[DEBUG] ${m}`, c || ''),
  info  : (m, c) => console.info (`[INFO]  ${m}`, c || ''),
  warn  : (m, c) => console.warn (`[WARN]  ${m}`, c || ''),
  error : (m, c) => console.error(`[ERROR] ${m}`, c || ''),
};

/* =============================================================================
   HTML ESCAPE UTILITY
   ============================================================================= */
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* =============================================================================
   BRACKET PAGE CONTROLLER
   ============================================================================= */
const BracketPage = {

  tournament : null,
  teams      : [],
  fixtures   : [],

  /** Entry point — called on DOMContentLoaded */
  async init() {
    Logger.info('BracketPage.init', { version: CONFIG.VERSION });

    // Read tournament ID from URL: bracket.html?id=XXXX
    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');

    if (!id) {
      BracketPage._showError('No tournament ID in URL. Open this page from the tournament list.');
      return;
    }

    BracketPage._setLoading(true);

    try {
      // Fetch tournament, teams, and fixtures in parallel
      const [tournament, teams, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('teams').getFullList({
          filter : `tournament = "${id}"`,
          sort   : 'seed',
        }),
        pb.collection('fixtures').getFullList({
          filter : `tournament = "${id}"`,
          sort   : 'round,match_number',
          expand : 'home_team,away_team,winner',
        }),
      ]);

      BracketPage.tournament = tournament;
      BracketPage.teams      = teams;
      BracketPage.fixtures   = fixtures;

      Logger.info('Data loaded', {
        tournament : tournament.name,
        teams      : teams.length,
        fixtures   : fixtures.length,
      });

      BracketPage._renderHeader();
      BracketPage._renderBracket();

    } catch (e) {
      Logger.error('Failed to load tournament', { error: e.message });
      BracketPage._showError(`Could not load tournament: ${e.message}`);
    } finally {
      BracketPage._setLoading(false);
    }
  },

  /** Render the page header with tournament info */
  _renderHeader() {
    const t = BracketPage.tournament;
    const fx = BracketPage.fixtures.filter(f => !f.is_bye);
    const done = fx.filter(f => f.status === 'completed').length;

    const titleEl  = document.getElementById('bracket-title');
    const metaEl   = document.getElementById('bracket-meta');
    const badgeEl  = document.getElementById('bracket-status');

    if (titleEl) titleEl.textContent = t.name;
    if (metaEl)  metaEl.textContent  = `${BracketPage.teams.length} teams · ${t.format.replace(/_/g,' ')} · ${done}/${fx.length} matches played`;
    if (badgeEl) {
      badgeEl.textContent = t.status;
      badgeEl.className   = `status-badge badge-${t.status}`;
    }
  },

  /**
   * Main render dispatcher.
   * Calls the appropriate renderer based on tournament format.
   */
  _renderBracket() {
    const t      = BracketPage.tournament;
    const canvas = document.getElementById('bracket-canvas-area');
    if (!canvas) return;

    if (t.format === 'elimination') {
      canvas.innerHTML = BracketPage._buildEliminationBracket(BracketPage.fixtures);

    } else if (t.format === 'round_robin') {
      canvas.innerHTML = BracketPage._buildRoundRobinView(BracketPage.fixtures);

    } else if (t.format === 'group_stage') {
      canvas.innerHTML = BracketPage._buildGroupStageBracket(BracketPage.fixtures);

    } else {
      canvas.innerHTML = `<div class="no-bracket">Unknown format: ${escHtml(t.format)}</div>`;
    }

    // Show champion box if tournament is complete
    BracketPage._renderChampion();
  },

  /**
   * Render an elimination bracket.
   * Columns represent rounds, rows represent matches within each round.
   * Connector lines are drawn with CSS (the ::after pseudo-element on .bc-round).
   *
   * @param {Array} fixtures - All fixture records for the tournament
   * @returns {string} HTML string
   */
  _buildEliminationBracket(fixtures) {
    // Group fixtures by round number
    const rounds = {};
    fixtures
      .filter(f => !f.is_bye && !f.group_name)
      .forEach(f => {
        if (!rounds[f.round]) rounds[f.round] = [];
        rounds[f.round].push(f);
      });

    if (!Object.keys(rounds).length) {
      return '<div class="no-bracket">No bracket data available yet.</div>';
    }

    const roundNums = Object.keys(rounds).map(Number).sort((a,b) => a-b);

    const cols = roundNums.map(roundNum => {
      const matches     = rounds[roundNum];
      const roundLabel  = matches[0]?.round_label || `Round ${roundNum}`;

      const matchCards = matches.map(m => BracketPage._bracketMatchCard(m)).join('');

      return `<div class="bc-round">
        <div class="bc-round-label">${escHtml(roundLabel)}</div>
        <div class="bc-matches">${matchCards}</div>
      </div>`;
    }).join('');

    return `<div class="bracket-canvas-wrap">
      <div class="bracket-canvas">${cols}</div>
    </div>`;
  },

  /**
   * Render a round-robin schedule as a table.
   * Shows every match, round by round, with results where available.
   *
   * @param {Array} fixtures
   * @returns {string} HTML string
   */
  _buildRoundRobinView(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.round_label || `Round ${f.round}`;
      if (!rounds[key]) rounds[key] = [];
      rounds[key].push(f);
    });

    const sections = Object.entries(rounds).map(([label, matches]) => {
      const rows = matches.map((m, i) => {
        const hn   = m.expand?.home_team?.name || 'TBD';
        const an   = m.expand?.away_team?.name || 'TBD';
        const done = m.status === 'completed';
        const wH   = done && m.winner === m.home_team;
        const wA   = done && m.winner === m.away_team;

        return `<div class="match-card ${done ? 'completed' : ''}">
          <span class="match-num">M${i+1}</span>
          <span class="team-a ${wH ? 'winner-bold' : ''}">${escHtml(hn)}</span>
          <span class="vs">vs</span>
          <span class="team-b ${wA ? 'winner-bold' : ''}">${escHtml(an)}</span>
          ${done ? `<span class="match-score">${m.home_score} – ${m.away_score}</span>` : ''}
        </div>`;
      }).join('');

      return `<div class="round-section">
        <div class="round-label">${escHtml(label)}</div>
        ${rows}
      </div>`;
    }).join('');

    return `<div style="max-width:600px;">${sections}</div>`;
  },

  /**
   * Render a group stage bracket.
   * Shows each group's round-robin schedule, then the knockout bracket.
   *
   * @param {Array} fixtures
   * @returns {string} HTML string
   */
  _buildGroupStageBracket(fixtures) {
    const groupFx   = fixtures.filter(f => !f.is_bye && f.group_name);
    const knockoutFx = fixtures.filter(f => !f.is_bye && !f.group_name);

    // Build group sections
    const groups = {};
    groupFx.forEach(f => {
      if (!groups[f.group_name]) groups[f.group_name] = [];
      groups[f.group_name].push(f);
    });

    const groupHtml = Object.entries(groups).map(([name, matches]) => {
      const rows = matches.map((m, i) => {
        const hn   = m.expand?.home_team?.name || 'TBD';
        const an   = m.expand?.away_team?.name || 'TBD';
        const done = m.status === 'completed';
        const wH   = done && m.winner === m.home_team;
        const wA   = done && m.winner === m.away_team;
        return `<div class="match-card ${done ? 'completed' : ''}">
          <span class="match-num">M${i+1}</span>
          <span class="team-a ${wH ? 'winner-bold' : ''}">${escHtml(hn)}</span>
          <span class="vs">vs</span>
          <span class="team-b ${wA ? 'winner-bold' : ''}">${escHtml(an)}</span>
          ${done ? `<span class="match-score">${m.home_score} – ${m.away_score}</span>` : ''}
        </div>`;
      }).join('');

      return `<div class="round-section">
        <div class="round-label">${escHtml(name)}</div>
        ${rows}
      </div>`;
    }).join('');

    // Build knockout bracket
    const koHtml = knockoutFx.length
      ? BracketPage._buildEliminationBracket(knockoutFx)
      : '<div class="no-bracket" style="padding:1rem 0;">Knockout stage not yet generated.</div>';

    return `
      <div style="margin-bottom:2rem;">
        <h3 style="font-size:14px;font-weight:500;margin-bottom:1rem;color:var(--text-secondary);">Group Stage</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
          ${groupHtml}
        </div>
      </div>
      <div>
        <h3 style="font-size:14px;font-weight:500;margin-bottom:1rem;color:var(--text-secondary);">Knockout Bracket</h3>
        ${koHtml}
      </div>`;
  },

  /**
   * Build a single bracket match card for the visual bracket.
   * @param {object} fixture - PocketBase fixture record with expand
   * @returns {string} HTML
   */
  _bracketMatchCard(fixture) {
    const hn   = fixture.expand?.home_team?.name || 'TBD';
    const an   = fixture.expand?.away_team?.name || 'TBD';
    const done = fixture.status === 'completed';
    const wH   = done && fixture.winner === fixture.home_team;
    const wA   = done && fixture.winner === fixture.away_team;
    const isTBD = hn === 'TBD' || an === 'TBD';

    return `<div class="bc-match ${done ? 'done' : ''} ${isTBD ? 'tbd-match' : ''}">
      <div class="bc-team ${hn === 'TBD' ? 'tbd' : ''} ${wH ? 'winner' : ''}">
        <span class="bc-team-name">${escHtml(hn)}</span>
        ${done ? `<span class="bc-score">${fixture.home_score}</span>` : ''}
      </div>
      <div class="bc-team ${an === 'TBD' ? 'tbd' : ''} ${wA ? 'winner' : ''}">
        <span class="bc-team-name">${escHtml(an)}</span>
        ${done ? `<span class="bc-score">${fixture.away_score}</span>` : ''}
      </div>
    </div>`;
  },

  /**
   * If the tournament is complete, find the winner of the final and
   * render a champion callout box below the bracket.
   */
  _renderChampion() {
    const t = BracketPage.tournament;
    if (t.status !== 'completed') return;

    // Find the last fixture (highest round number, match 1)
    const realFx = BracketPage.fixtures.filter(f => !f.is_bye);
    if (!realFx.length) return;

    const maxRound = Math.max(...realFx.map(f => f.round));
    const final    = realFx.find(f => f.round === maxRound && f.status === 'completed');
    if (!final) return;

    const winner = final.expand?.winner?.name
      || BracketPage.teams.find(t => t.id === final.winner)?.name
      || 'Unknown';

    const box = document.getElementById('champion-box');
    if (!box) return;
    box.innerHTML = `
      <div class="trophy">🏆</div>
      <h2>Tournament Champion</h2>
      <div class="champion-name">${escHtml(winner)}</div>`;
    box.style.display = 'block';
  },

  /** Show a full-page error message */
  _showError(message) {
    const canvas = document.getElementById('bracket-canvas-area');
    if (canvas) {
      canvas.innerHTML = `<div class="no-bracket">
        <span style="font-size:32px;display:block;margin-bottom:0.75rem;">⚠️</span>
        ${escHtml(message)}
      </div>`;
    }
    Logger.error('BracketPage error shown', { message });
  },

  /** Toggle loading state on the canvas area */
  _setLoading(loading) {
    const canvas = document.getElementById('bracket-canvas-area');
    if (!canvas) return;
    if (loading) {
      canvas.innerHTML = `<div class="no-bracket">
        <span style="font-size:32px;display:block;margin-bottom:0.75rem;">⏳</span>
        Loading bracket...
      </div>`;
    }
  },

  /** Print the bracket page */
  print() {
    window.print();
  },

  /** Reload the bracket data (useful after results are entered in the main app) */
  async refresh() {
    Logger.info('BracketPage.refresh');
    BracketPage._setLoading(true);
    await BracketPage.init();
  },
};

/* =============================================================================
   BOOT
   ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('Bracket page DOM ready');
  BracketPage.init().catch(e => Logger.error('BracketPage.init failed', { error: e.message }));
});
