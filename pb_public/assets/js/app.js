/**
 * =============================================================================
 * app.js — App controller + boot
 *
 * Depends on: config.js, logger.js, auth.js, state.js, generators.js, db.js
 * =============================================================================
 */

const App = {

  /* ── 11a. INITIALISATION ─────────────────────────────────────────────── */

  async init() {
    Logger.info('App.init', { version: CONFIG.VERSION });

    const user = Auth.user();
    Logger.info('Auth state', {
      loggedIn: !!user,
      role    : Auth.role(),
      email   : user?.email ?? '(visitor)',
    });

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

  /* ── 11b. HOME SCREEN ────────────────────────────────────────────────── */

  async loadTournaments() {
    Logger.info('loadTournaments');
    UI.clearError('home-error');

    const list        = document.getElementById('tournament-list');
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

      State.favourites = favourites;
      Logger.info('Tournaments loaded', { count: tournaments.length });

      if (!tournaments.length) {
        list.innerHTML = `<div class="empty-state">
          <span class="empty-icon">🏆</span>
          No tournaments yet.<br>Create one to get started.
        </div>`;
        return;
      }

      const events     = {};
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

      // Favourites section for guests and admins
      if (Auth.canFavourite() && State.favourites.length) {
        const favIds = new Set(
          State.favourites.map(f =>
            typeof f.tournament === 'object' ? f.tournament.id : f.tournament
          )
        );
        const favTournaments = tournaments.filter(t => favIds.has(t.id));
        if (favTournaments.length) {
          html += `
            <div style="margin-bottom:10px;">
              <div style="font-size:11px;font-weight:600;text-transform:uppercase;
                          letter-spacing:0.07em;color:var(--text-tertiary);padding:0 0 6px 0;">
                ⭐ Following
              </div>
              ${favTournaments.map(t => App._renderTournamentItem(t)).join('')}
            </div>`;
        }
      }

      Object.keys(events).sort().forEach(eventName => {
        html += App._renderEventGroup(eventName, events[eventName]);
      });

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

  _renderEventGroup(eventName, categories) {
    const allDone     = categories.every(c => c.status === 'completed');
    const anyActive   = categories.some(c => c.status === 'active');
    const groupStatus = allDone ? 'completed' : anyActive ? 'active' : 'pending';

    const statusColors = {
      pending  : 'var(--text-tertiary)',
      active   : '#d4860a',
      completed: 'var(--accent)',
    };

    const categoryRows = categories.map(t => App._renderTournamentItem(t, true)).join('');

    return `
      <div class="event-group" style="
        background:var(--bg-primary);border:0.5px solid var(--border-light);
        border-radius:var(--radius-lg);margin-bottom:10px;overflow:hidden;">
        <div style="
          display:flex;align-items:center;justify-content:space-between;
          padding:0.85rem 1rem;background:var(--bg-secondary);
          border-bottom:0.5px solid var(--border-light);flex-wrap:wrap;gap:8px;">
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
          ${Auth.isAdmin() ? `
            <button class="btn sm primary"
                    onclick="App.goToSetupForEvent('${escHtml(eventName).replace(/'/g, "\\'")}')">
              + Add category
            </button>` : ''}
        </div>
        <div style="padding:6px 0;">${categoryRows}</div>
      </div>`;
  },

  _renderTournamentItem(tournament, isCategory = false) {
    const t          = tournament;
    const formatText = t.format.replace(/_/g, ' ');
    const dateText   = new Date(t.created).toLocaleDateString();

    const favBtn = Auth.canFavourite() ? (() => {
      const fav = State.favourites.find(f =>
        (typeof f.tournament === 'object' ? f.tournament.id : f.tournament) === t.id
      );
      return fav
        ? `<button class="btn sm ghost" title="Unfavourite"
                   onclick="App.toggleFavourite('${t.id}','${fav.id}')">⭐</button>`
        : `<button class="btn sm ghost" title="Follow"
                   onclick="App.toggleFavourite('${t.id}',null)">☆</button>`;
    })() : '';

    // Delete only for super admins
    const deleteBtn = Auth.isSuperAdmin() ? `
      <button class="btn sm danger"
              onclick="App.deleteTournament('${t.id}','${escHtml(t.name).replace(/'/g, "\\'")}')">
        Delete
      </button>` : '';

    return `
      <div style="
        display:flex;align-items:center;justify-content:space-between;
        padding:${isCategory ? '0.6rem 1rem 0.6rem 2rem' : '0.85rem 1rem'};
        border-bottom:0.5px solid var(--border-light);
        flex-wrap:wrap;gap:8px;transition:background 0.12s;"
        onmouseover="this.style.background='var(--bg-secondary)'"
        onmouseout="this.style.background='transparent'">
        <div>
          <div style="font-size:${isCategory ? '13px' : '14px'};font-weight:500;
                      color:var(--text-primary);display:flex;align-items:center;gap:6px;">
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
          ${deleteBtn}
          ${favBtn}
        </div>
      </div>`;
  },

  _renderAuthBar() {
    // Write to auth-controls (right side of auth bar) — left side has nav links
    const ctrl = document.getElementById('auth-controls');
    if (!ctrl) return;
    const user = Auth.user();

    if (user) {
      const roleLabel = {
        super_admin      : '⚡ Super Admin',
        tournament_admin : '✏️ Tournament Admin',
        guest            : '⭐ Guest',
      }[user.role] || user.role;

      const displayName = escHtml(user.name || user.email);

      ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-secondary);">
          ${displayName}
          <span style="margin-left:6px;font-size:10px;padding:2px 6px;
                       border-radius:4px;background:var(--bg-secondary);
                       color:var(--text-tertiary);border:0.5px solid var(--border-light);">
            ${roleLabel}
          </span>
        </span>
        <button class="btn sm ghost" onclick="Auth.logout()">Sign out</button>`;
    } else {
      ctrl.innerHTML = `
        <span style="font-size:12px;color:var(--text-tertiary);">Browsing as visitor</span>
        <a href="login.html" class="btn sm primary">Sign in / Register</a>`;
    }
  },

  async toggleFavourite(tournamentId, existingFavouriteId) {
    try {
      if (existingFavouriteId) {
        await DB.removeFavourite(existingFavouriteId);
        Logger.info('Removed favourite', { tournamentId });
      } else {
        await DB.addFavourite(tournamentId);
        Logger.info('Added favourite', { tournamentId });
      }
      await App.loadTournaments();
    } catch (e) {
      Logger.error('toggleFavourite failed', { error: e.message });
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

  /* ── 11c. SETUP SCREEN ───────────────────────────────────────────────── */

  goToSetup() {
    State.setupData = { teamCount: 8, format: 'elimination', name: '', eventName: '', names: [], masterRefs: [] };
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

  goToSetupForEvent(eventName) {
    Logger.info('goToSetupForEvent', { eventName });
    State.setupData = { teamCount: 8, format: 'elimination', name: '', eventName, names: [], masterRefs: [] };
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

  _initSetupScreen() {
    if (!document.getElementById('event-name')) {
      const tnInput = document.getElementById('tournament-name');
      if (tnInput) {
        tnInput.insertAdjacentHTML('afterend', `
          <div id="event-name-group" style="margin-bottom:1rem;margin-top:-0.5rem;">
            <label style="font-size:13px;color:var(--text-secondary);display:block;margin-bottom:6px;">
              Event name
              <span style="font-size:11px;color:var(--text-tertiary);font-style:italic;">
                — optional, groups categories together (e.g. "JBB 2025")
              </span>
            </label>
            <input type="text" id="event-name" class="tournament-name-input"
                   placeholder="e.g. JBB 2025, City Cup, School League"
                   maxlength="60" list="event-name-suggestions" style="margin-bottom:0;" />
            <datalist id="event-name-suggestions"></datalist>
          </div>`);
      }
    }

    const tnLabel = document.querySelector('label[for="tournament-name"]');
    if (tnLabel) tnLabel.textContent = 'Tournament / Category name';

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

    document.getElementById('event-name')?.addEventListener('input', function () {
      State.setupData.eventName = this.value.trim();
      App._updateSetupLabels(this.value.trim());
    });
  },

  _updateSetupLabels(eventName) {
    const tnLabel = document.querySelector('label[for="tournament-name"]');
    if (tnLabel) {
      tnLabel.textContent = eventName ? 'Category name' : 'Tournament / Category name';
    }
  },

  async _populateEventSuggestions() {
    const datalist = document.getElementById('event-name-suggestions');
    if (!datalist) return;
    try {
      const events = await DB.getEvents();
      datalist.innerHTML = events.map(e => `<option value="${escHtml(e)}">`).join('');
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
        round_robin : `Round robin for ${n} teams — everyone plays everyone.`,
        elimination : `Elimination for ${n} teams — one loss and you're out.`,
        group_stage : `Group stage for ${n} teams — groups first, then knockout.`,
      };
      tip.textContent = tips[State.setupData.format] || '';
    }
  },

  selectFormat(id) {
    State.setupData.format = id;
    App._renderFormatGrid();
  },

  /* ── 11d. NAMES SCREEN ───────────────────────────────────────────────── */

  async goToNames() {
    UI.clearError('setup-error');

    const nameVal  = (document.getElementById('tournament-name')?.value || '').trim();
    const eventVal = (document.getElementById('event-name')?.value     || '').trim();
    const raw      = document.getElementById('team-count')?.value.trim();
    const n        = parseInt(raw, 10);

    if (!nameVal) {
      UI.showError('setup-error', 'setup-error-msg',
        `Please enter a ${eventVal ? 'category' : 'tournament'} name.`);
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

    // Load master teams for autocomplete in name inputs
    try {
      State.masterTeams = await DB.getMasterTeams();
      Logger.info('Master teams loaded for autocomplete', { count: State.masterTeams.length });
    } catch (e) {
      State.masterTeams = [];
      Logger.warn('Could not load master teams', { error: e.message });
    }

    const grid = document.getElementById('team-inputs');
    if (grid) {
      // Build datalist of existing master team names for autocomplete
      const datalist = `<datalist id="master-team-suggestions">
        ${State.masterTeams.map(t => `<option value="${escHtml(t.name)}">`).join('')}
      </datalist>`;

      grid.innerHTML = datalist + Array.from({ length: n }, (_, i) => `
        <div class="team-input-wrap">
          <span class="team-num">${i + 1}</span>
          <input type="text"
                 placeholder="Team ${i + 1}"
                 id="tn-${i}"
                 value="${escHtml(State.setupData.names[i] || '')}"
                 maxlength="30"
                 list="master-team-suggestions"
                 autocomplete="off" />
        </div>`).join('');
    }

    UI.showScreen('screen-names');
  },

  /* ── 11e. FIXTURE GENERATION & PERSISTENCE ───────────────────────────── */

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
      const tournament = await DB.createTournament(
        State.setupData.name,
        State.setupData.format,
        State.setupData.eventName || null,
      );
      Logger.info('Tournament created', { id: tournament.id });

      const teamMap   = {};
      const numGroups = State.setupData.format === 'group_stage'
        ? (names.length <= 8 ? 2 : names.length <= 12 ? 3 : 4) : null;

      // Determine category for master team linking
      const category = State.setupData.eventName || State.setupData.name;

      for (let i = 0; i < names.length; i++) {
        const groupName = numGroups ? 'ABCDEFGH'[i % numGroups] : null;

        // Get or create master team record — links returning teams automatically
        const masterTeamId = await DB.getOrCreateMasterTeam(names[i], category);

        const team = await DB.createTeam(
          tournament.id, names[i], i + 1, groupName, masterTeamId
        );
        teamMap[names[i]] = team.id;
        Logger.debug('Team created', { name: names[i], masterTeamId, teamId: team.id });
      }

      let generated;
      if      (State.setupData.format === 'round_robin') generated = genRoundRobin(names);
      else if (State.setupData.format === 'elimination') generated = genElimination(names);
      else                                               generated = genGroupStage(names);

      await App._persistFixtures(tournament.id, generated, teamMap);
      await DB.updateTournament(tournament.id, { status: 'active' });

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
            tournament  : tournamentId,
            round       : round.roundNumber,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : homeId,
            away_team   : awayId,
            is_bye      : m.isBye,
            status      : m.isBye ? 'completed' : 'scheduled',
            group_name  : null,
          });
          savedFixtureMap[key] = saved;
        }
      }

      for (let mi = 0; mi < generated.rounds[0].matches.length; mi++) {
        const m = generated.rounds[0].matches[mi];
        if (!m.isBye) continue;
        const slot   = m.nextSlot === 'home' ? 'home_team' : 'away_team';
        const nextFx = savedFixtureMap[`R2M${m.nextMatchNumber}`];
        if (nextFx) {
          await pb.collection('fixtures').update(nextFx.id, { [slot]: teamMap[m.a] });
          Logger.info('Bye winner seeded', { team: m.a, slot });
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
              tournament  : tournamentId,
              round       : roundOffset + ri + 1,
              match_number: mi + 1,
              round_label : round.label,
              home_team   : teamMap[m.a] ?? null,
              away_team   : teamMap[m.b] ?? null,
              is_bye      : false,
              status      : 'scheduled',
              group_name  : group.name,
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
            tournament  : tournamentId,
            round       : roundOffset + ri + 1,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : null,
            away_team   : null,
            is_bye      : m.isBye,
            status      : 'scheduled',
            group_name  : null,
          });
        }
      }

    } else {
      for (let ri = 0; ri < generated.rounds.length; ri++) {
        const round = generated.rounds[ri];
        for (let mi = 0; mi < round.matches.length; mi++) {
          const m = round.matches[mi];
          await DB.createFixture({
            tournament  : tournamentId,
            round       : ri + 1,
            match_number: mi + 1,
            round_label : round.label,
            home_team   : teamMap[m.a] ?? null,
            away_team   : teamMap[m.b] ?? null,
            is_bye      : false,
            status      : 'scheduled',
            group_name  : null,
          });
        }
      }
    }
  },

  /* ── 11f. FIXTURES SCREEN ────────────────────────────────────────────── */

  _renderFixturesScreen(activeTab = 0) {
    const t  = State.activeTournament;
    const fx = State.fixtures;

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
      <div class="stat-box"><div class="stat-val">${State.teams.length}</div><div class="stat-lbl">Teams</div></div>
      <div class="stat-box"><div class="stat-val">${done}/${realFx.length}</div><div class="stat-lbl">Played</div></div>
      <div class="stat-box"><div class="stat-val">${rounds}</div><div class="stat-lbl">Rounds</div></div>`;

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

    UI.switchTab(Math.min(activeTab, document.querySelectorAll('.tab').length - 1));
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
      const rows      = _computeGroupStandings(State.fixtures, State.teams, gName);
      const tableRows = rows.map((s, i) => {
        const adv = i < 2;
        return `<tr style="${adv ? 'background:var(--bg-success)' : ''}">
          <td style="padding:6px 8px;font-size:12px;font-weight:500;
                     color:${adv ? 'var(--accent)' : 'var(--text-secondary)'}">
            ${i + 1}${adv ? ' ✓' : ''}
          </td>
          <td style="padding:6px 8px;font-size:13px;font-weight:${adv ? '600' : '400'}">
            ${escHtml(s.name)}
          </td>
          <td style="padding:6px 8px;font-size:12px;text-align:center">${s.played}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:600;
                     color:var(--accent)">${s.wins}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center">${s.losses}</td>
          <td style="padding:6px 8px;font-size:12px;text-align:center;
                     color:${s.pointDiff >= 0 ? 'var(--accent)' : 'var(--danger)'}">
            ${s.pointDiff >= 0 ? '+' : ''}${s.pointDiff}
          </td>
        </tr>`;
      }).join('');

      return `<div class="round-section">
        <div class="round-label">${gName}
          <span style="font-size:10px;color:var(--text-tertiary);font-style:italic"> ✓ advances</span>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;background:var(--bg-primary);
                        border-radius:var(--radius-md);overflow:hidden;
                        border:0.5px solid var(--border-light)">
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
    if (!roundNums.length) return '<div class="text-muted" style="padding:1rem 0">No bracket data yet.</div>';

    const CARD_H = 68, CARD_GAP = 12, COL_W = 180, COL_GAP = 40, PADDING_V = 20;
    const r1Count = rounds[roundNums[0]].length;
    const canvasH = r1Count * CARD_H + (r1Count - 1) * CARD_GAP + PADDING_V * 2;

    function cardCentreY(index, total) {
      const totalH = total * CARD_H + (total - 1) * CARD_GAP;
      const startY = (canvasH - totalH) / 2;
      return startY + index * (CARD_H + CARD_GAP) + CARD_H / 2;
    }

    const cols = roundNums.map((roundNum, colIdx) => {
      const matches = rounds[roundNum];
      const total   = matches.length;
      const label   = matches[0]?.round_label || `Round ${roundNum}`;

      const cards = matches.map((m, i) => {
        const hn     = m.expand?.home_team?.name || 'TBD';
        const an     = m.expand?.away_team?.name || 'TBD';
        const isDone = m.status === 'completed';
        const wH     = isDone && m.winner === m.home_team;
        const wA     = isDone && m.winner === m.away_team;
        const can    = !isDone && hn !== 'TBD' && an !== 'TBD' && Auth.isAdmin();
        const totalH = total * CARD_H + (total - 1) * CARD_GAP;
        const top    = (canvasH - totalH) / 2 + i * (CARD_H + CARD_GAP);

        return `<div class="nba-match ${isDone ? 'done' : ''} ${can ? 'clickable' : ''} ${hn === 'TBD' && an === 'TBD' ? 'tbd-match' : ''}"
                     style="top:${top}px;width:${COL_W}px;"
                     ${can ? `onclick="App.openScoreModal('${m.id}')"` : ''}>
          <div class="nba-team ${wH ? 'winner' : ''} ${hn === 'TBD' ? 'tbd' : ''}">
            <span class="nba-seed">${m.expand?.home_team ? State.teams.findIndex(t => t.id === m.home_team) + 1 : ''}</span>
            <span class="nba-name">${escHtml(hn)}</span>
            ${isDone ? `<span class="nba-score">${m.home_score}</span>` : ''}
          </div>
          <div class="nba-divider"></div>
          <div class="nba-team ${wA ? 'winner' : ''} ${an === 'TBD' ? 'tbd' : ''}">
            <span class="nba-seed">${m.expand?.away_team ? State.teams.findIndex(t => t.id === m.away_team) + 1 : ''}</span>
            <span class="nba-name">${escHtml(an)}</span>
            ${isDone ? `<span class="nba-score">${m.away_score}</span>` : ''}
          </div>
        </div>`;
      }).join('');

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
          svgLines += `<line x1="${midX}" y1="${fromY}" x2="${midX}" y2="${cardCentreY(mi+1,thisRound.length)}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
        if (mi % 2 === 0) {
          svgLines += `<line x1="${midX}" y1="${toY}" x2="${colLeft+COL_GAP}" y2="${toY}" stroke="var(--border-mid)" stroke-width="1.5"/>`;
        }
      }
    }

    const totalW = roundNums.length * COL_W + (roundNums.length - 1) * COL_GAP + 2;
    const svg    = `<svg width="${totalW}" height="${canvasH+24}"
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
        <div class="nba-bracket">${svg}${cols}</div>
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

    const editBtn = isDone && Auth.isAdmin()
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

  /* ── 11g. SCORE ENTRY ────────────────────────────────────────────────── */

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

      // Check tournament completion
      const realFx  = State.fixtures.filter(f => !f.is_bye);
      const allDone = realFx.every(f => f.status === 'completed');
      const status  = allDone ? 'completed' : 'active';
      await DB.updateTournament(fixture.tournament, { status });
      State.activeTournament.status = status;

      // Save team stats to databank when tournament completes
      if (allDone) {
        Logger.info('Tournament complete — saving team stats to databank');
        await DB.saveTeamStats(fixture.tournament, State.fixtures, State.teams);
      }

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

  /* ── ORGANISE EVENTS MODAL ───────────────────────────────────────────── */

  async openOrganiseModal() {
    const overlay = document.getElementById('organise-overlay');
    const list    = document.getElementById('organise-list');
    if (!overlay || !list) return;

    overlay.style.display = 'block';
    list.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;">Loading...</div>';

    try {
      const [tournaments, existingEvents] = await Promise.all([
        DB.getTournaments(),
        DB.getEvents(),
      ]);

      const datalistHtml = `<datalist id="organise-event-suggestions">
        ${existingEvents.map(e => `<option value="${escHtml(e)}">`).join('')}
      </datalist>`;

      list.innerHTML = datalistHtml + tournaments.map(t => `
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;
                    padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);
                    border:0.5px solid var(--border-light);">
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--text-primary);">
              ${escHtml(t.name)}
              <span class="status-badge badge-${t.status}" style="margin-left:6px;">${t.status}</span>
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
              ${t.format.replace(/_/g,' ')} · ${new Date(t.created).toLocaleDateString()}
            </div>
          </div>
          <input type="text"
                 class="organise-event-input"
                 data-tournament-id="${t.id}"
                 value="${escHtml(t.event_name || '')}"
                 placeholder="Event name"
                 list="organise-event-suggestions"
                 maxlength="60"
                 style="width:160px;font-size:12px;padding:5px 8px;" />
        </div>`).join('');

    } catch (e) {
      list.innerHTML = `<div style="color:var(--danger);font-size:13px;">Failed to load: ${e.message}</div>`;
    }
  },

  closeOrganiseModal(event) {
    if (event && event.target !== document.getElementById('organise-overlay')) return;
    document.getElementById('organise-overlay').style.display = 'none';
  },

  async saveOrganise() {
    const btn    = document.getElementById('btn-save-organise');
    const errEl  = document.getElementById('organise-error');
    const inputs = document.querySelectorAll('.organise-event-input');

    errEl.style.display = 'none';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

    try {
      let changeCount = 0;
      for (const input of inputs) {
        const tournamentId = input.dataset.tournamentId;
        const newEvent     = input.value.trim() || null;
        const current      = await pb.collection('tournaments').getOne(tournamentId, { fields: 'id,event_name' });
        const currentEvent = current.event_name || null;
        if (newEvent !== currentEvent) {
          await pb.collection('tournaments').update(tournamentId, { event_name: newEvent });
          changeCount++;
        }
      }

      document.getElementById('organise-overlay').style.display = 'none';
      await App.loadTournaments();
      UI.showSuccess('home-success', 'home-success-msg',
        changeCount > 0
          ? `${changeCount} tournament${changeCount === 1 ? '' : 's'} updated.`
          : 'No changes made.'
      );

    } catch (e) {
      errEl.textContent   = `Save failed: ${e.message}`;
      errEl.style.display = 'block';
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Save changes'; }
    }
  },

};  // ← end of App object

/* =============================================================================
   GLOBAL ERROR HANDLERS
   ============================================================================= */
window.addEventListener('error', e => {
  Logger.error('Uncaught error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', e => {
  Logger.error('Unhandled promise rejection', { reason: String(e.reason) });
});

/* =============================================================================
   BOOT
   ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  Logger.info('DOM ready — booting Tournament Manager v5.1.0');
  if (document.getElementById('screen-home')) {
    App.init().catch(e => Logger.error('App.init failed', { error: e.message }));
  }
});
