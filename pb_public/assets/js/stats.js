/* =============================================================================
   STATS PAGE — self-contained app logic
   ============================================================================= */

const pb = new PocketBase(CONFIG.API_BASE_URL);

// ── Page state ────────────────────────────────────────────────────────────────
let masterTeams = [];
let allStats    = [];
let categories  = [];
let aggregated  = {};  // { masterId → { name, category, wins, losses, ... } }

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setConnStatus(await checkHealth());
  renderAuthBar();
  await loadData();
});

async function checkHealth() {
  try { await pb.health.check(); return true; } catch (e) { return false; }
}

function setConnStatus(online) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (dot)   dot.className     = 'conn-dot ' + (online ? 'online' : 'offline');
  if (label) label.textContent = online ? 'Connected' : 'Offline';
}

function renderAuthBar() {
  const ctrl = document.getElementById('auth-controls');
  if (!ctrl) return;
  const user = pb.authStore.isValid ? pb.authStore.model : null;
  if (user) {
    const roleLabel = {
      super_admin      : '⚡ Super Admin',
      tournament_admin : '✏️ Tournament Admin',
      guest            : '⭐ Guest',
    }[user.role] || user.role;
    ctrl.innerHTML = `
      <span style="font-size:12px;color:var(--text-secondary);">
        ${escHtml(user.name || user.email)}
        <span style="margin-left:6px;font-size:10px;padding:2px 6px;border-radius:4px;
                     background:var(--bg-secondary);color:var(--text-tertiary);
                     border:0.5px solid var(--border-light);">${roleLabel}</span>
      </span>
      <button class="btn sm ghost"
              onclick="pb.authStore.clear();window.location.href='login.html'">
        Sign out
      </button>`;
  } else {
    ctrl.innerHTML = `<a href="login.html" class="btn sm primary">Sign in</a>`;
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadData() {
  try {
    [masterTeams, allStats] = await Promise.all([
      pb.collection('master_teams').getFullList({
        sort: 'name', requestKey: null,
      }),
      pb.collection('team_stats').getFullList({
        sort: '-created', expand: 'master_team,tournament', requestKey: null,
      }),
    ]);

    // Build aggregated map keyed by master_team ID
    aggregated = {};
    masterTeams.forEach(t => {
      aggregated[t.id] = {
        id            : t.id,
        name          : t.name,
        category      : t.category || '',
        short_name    : t.short_name || '',
        tournaments   : 0,
        wins          : 0,
        losses        : 0,
        points_for    : 0,
        points_against: 0,
        placements    : [],
        history       : [],
      };
    });

    allStats.forEach(s => {
      const masterId = typeof s.master_team === 'object'
        ? s.master_team?.id : s.master_team;
      const agg = aggregated[masterId];
      if (!agg) return;

      agg.tournaments++;
      agg.wins           += (s.wins           || 0);
      agg.losses         += (s.losses         || 0);
      agg.points_for     += (s.points_for     || 0);
      agg.points_against += (s.points_against || 0);
      if (s.placement) agg.placements.push(s.placement);

      agg.history.push({
        tournamentName : s.expand?.tournament?.name    || 'Unknown',
        eventName      : s.expand?.tournament?.event_name || '',
        wins           : s.wins           || 0,
        losses         : s.losses         || 0,
        points_for     : s.points_for     || 0,
        points_against : s.points_against || 0,
        placement      : s.placement      || null,
        group_name     : s.group_name     || '',
      });
    });

    // Distinct categories — sorted alphabetically
    categories = [...new Set(
      masterTeams.map(t => t.category).filter(Boolean)
    )].sort();

    // Populate category filter dropdowns
    const catOptions = '<option value="">All categories</option>' +
      categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    ['category-filter', 'rankings-category'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = catOptions;
    });

    // Populate H2H selects — grouped by category using <optgroup>
    populateH2HSelects();

    // Summary line
    const totalTournaments = new Set(
      allStats.map(s => typeof s.tournament === 'object' ? s.tournament?.id : s.tournament)
    ).size;
    document.getElementById('stats-summary').textContent =
      `${masterTeams.length} teams · ${allStats.length} tournament entries · ${totalTournaments} tournaments`;

    renderTeams();
    renderRankings();

  } catch (e) {
    console.error('loadData failed:', e);
    document.getElementById('teams-list').innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>
        Failed to load: ${escHtml(e.message)}
      </div>`;
  }
}

function populateH2HSelects() {
  // Group teams by category for <optgroup> display
  const byCategory = {};
  masterTeams.forEach(t => {
    const cat = t.category || 'Uncategorised';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  });

  const optionsHtml = '<option value="">Select a team</option>' +
    Object.keys(byCategory).sort().map(cat =>
      `<optgroup label="${escHtml(cat)}">` +
      byCategory[cat].map(t =>
        `<option value="${t.id}">${escHtml(t.name)}</option>`
      ).join('') +
      `</optgroup>`
    ).join('');

  ['h2h-team1', 'h2h-team2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = optionsHtml;
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(idx) {
  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', i === idx));
  document.querySelectorAll('.tab-panel').forEach((p, i) =>
    p.classList.toggle('active', i === idx));
}

// ── TEAMS TAB ─────────────────────────────────────────────────────────────────
function filterTeams() { renderTeams(); }

function renderTeams() {
  const search   = (document.getElementById('team-search')?.value || '').toLowerCase();
  const category = document.getElementById('category-filter')?.value || '';
  const list     = document.getElementById('teams-list');

  const filtered = Object.values(aggregated).filter(t => {
    const matchSearch   = !search   || t.name.toLowerCase().includes(search);
    const matchCategory = !category || t.category === category;
    return matchSearch && matchCategory && t.tournaments > 0;
  }).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🔍</span>
      No teams found${search ? ` matching "${escHtml(search)}"` : ''}.
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(t => {
    const total  = t.wins + t.losses;
    const winPct = total > 0 ? Math.round((t.wins / total) * 100) : 0;
    const pd     = pointDiff(t);
    const bestPlc = t.placements.length ? Math.min(...t.placements) : null;

    return `
      <div onclick="openTeamModal('${t.id}')"
           style="background:var(--bg-primary);border:0.5px solid var(--border-light);
                  border-radius:var(--radius-md);padding:0.85rem 1rem;margin-bottom:8px;
                  cursor:pointer;transition:border-color .15s,box-shadow .15s;
                  display:flex;align-items:center;justify-content:space-between;gap:12px;"
           onmouseover="this.style.borderColor='var(--accent)';this.style.boxShadow='0 2px 10px rgba(29,158,117,0.12)'"
           onmouseout="this.style.borderColor='var(--border-light)';this.style.boxShadow='none'">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);">
            ${escHtml(t.name)}
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">
            ${t.category ? escHtml(t.category) + ' · ' : ''}
            ${t.tournaments} tournament${t.tournaments !== 1 ? 's' : ''}
            ${bestPlc ? ' · Best: ' + placementLabel(bestPlc) : ''}
          </div>
        </div>
        <div style="display:flex;gap:16px;flex-shrink:0;">
          <div style="text-align:center;">
            <div style="font-size:16px;font-weight:700;color:var(--accent);">${t.wins}</div>
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;">Wins</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:16px;font-weight:700;color:var(--accent);">${winPct}%</div>
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;">Win %</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:16px;font-weight:700;
                        color:${pd >= 0 ? 'var(--accent)' : 'var(--danger)'};">
              ${pd >= 0 ? '+' : ''}${pd}
            </div>
            <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;">+/-</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── TEAM DETAIL MODAL ─────────────────────────────────────────────────────────
function openTeamModal(teamId) {
  const t = aggregated[teamId];
  if (!t) return;

  const total      = t.wins + t.losses;
  const winPct     = total > 0 ? Math.round((t.wins / total) * 100) : 0;
  const pd         = pointDiff(t);
  const avgPtsFor  = total > 0 ? (t.points_for  / total).toFixed(1) : '—';
  const avgPtsAgst = total > 0 ? (t.points_against / total).toFixed(1) : '—';
  const bestPlc    = t.placements.length ? Math.min(...t.placements) : null;

  document.getElementById('team-modal-title').textContent =
    t.name + (t.category ? ` — ${t.category}` : '');

  const historyRows = [...t.history]
    .sort((a, b) => b.wins - a.wins)
    .map(h => `
      <tr>
        <td>
          <div style="font-weight:500;font-size:12px;">${escHtml(h.tournamentName)}</div>
          ${h.eventName  ? `<div style="font-size:10px;color:var(--text-tertiary);">${escHtml(h.eventName)}</div>` : ''}
          ${h.group_name ? `<div style="font-size:10px;color:var(--text-tertiary);">${escHtml(h.group_name)}</div>` : ''}
        </td>
        <td style="text-align:center;font-weight:600;color:var(--accent);font-size:12px;">${h.wins}</td>
        <td style="text-align:center;font-size:12px;">${h.losses}</td>
        <td style="text-align:center;font-size:12px;
                   color:${(h.points_for-h.points_against)>=0?'var(--accent)':'var(--danger)'}">
          ${h.points_for - h.points_against >= 0 ? '+' : ''}${h.points_for - h.points_against}
        </td>
        <td style="text-align:center;font-size:12px;">
          ${h.placement ? placementBadge(h.placement) : '—'}
        </td>
      </tr>`).join('');

  document.getElementById('team-modal-body').innerHTML = `
    <!-- Summary stat boxes -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:1rem;">
      ${[
        [t.tournaments, 'Tournaments'],
        [winPct + '%', 'Win rate'],
        [(pd >= 0 ? '+' : '') + pd, 'Point diff', pd >= 0 ? 'var(--accent)' : 'var(--danger)'],
        [bestPlc ? placementLabel(bestPlc) : '—', 'Best finish'],
      ].map(([val, lbl, color]) => `
        <div style="background:var(--bg-secondary);border-radius:var(--radius-md);
                    padding:10px 8px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:${color || 'var(--accent)'};">${val}</div>
          <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;
                      letter-spacing:.05em;margin-top:2px;">${lbl}</div>
        </div>`).join('')}
    </div>

    <!-- Record and averages -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;">
      <div style="background:var(--bg-secondary);border-radius:var(--radius-md);
                  padding:10px 8px;text-align:center;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
          ${t.wins}W – ${t.losses}L
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">Overall record</div>
      </div>
      <div style="background:var(--bg-secondary);border-radius:var(--radius-md);
                  padding:10px 8px;text-align:center;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
          ${avgPtsFor} / ${avgPtsAgst}
        </div>
        <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">
          Avg pts for / against
        </div>
      </div>
    </div>

    <!-- Tournament history -->
    <div style="font-size:12px;font-weight:600;color:var(--text-secondary);
                text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">
      Tournament history
    </div>
    ${t.history.length ? `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:var(--bg-secondary);">
              <th style="padding:6px 8px;text-align:left;font-weight:600;
                         color:var(--text-tertiary);font-size:10px;text-transform:uppercase;">
                Tournament
              </th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;
                         color:var(--text-tertiary);font-size:10px;">W</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;
                         color:var(--text-tertiary);font-size:10px;">L</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;
                         color:var(--text-tertiary);font-size:10px;">+/-</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;
                         color:var(--text-tertiary);font-size:10px;">Finish</th>
            </tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>` :
      `<div style="color:var(--text-tertiary);font-size:12px;">No history yet.</div>`}`;

  document.getElementById('team-modal-overlay').style.display = 'block';
}

function closeTeamModal(event) {
  if (event && event.target !== document.getElementById('team-modal-overlay')) return;
  document.getElementById('team-modal-overlay').style.display = 'none';
}

// ── HEAD TO HEAD TAB ──────────────────────────────────────────────────────────
async function loadH2H() {
  const t1Id = document.getElementById('h2h-team1')?.value;
  const t2Id = document.getElementById('h2h-team2')?.value;
  const out  = document.getElementById('h2h-result');

  if (!t1Id || !t2Id || t1Id === t2Id) {
    out.innerHTML = `<div class="empty-state">
      <span class="empty-icon">⚔️</span>
      Select two different teams to see their head-to-head record.
    </div>`;
    return;
  }

  out.innerHTML = `<div class="empty-state">
    <span class="empty-icon">⏳</span> Loading...
  </div>`;

  try {
    const t1 = aggregated[t1Id];
    const t2 = aggregated[t2Id];

    // Fetch all tournament instances for both master teams in parallel
    // requestKey: null disables auto-cancellation entirely
    const [t1Instances, t2Instances] = await Promise.all([
      pb.collection('teams').getFullList({
        filter: `master_team="${t1Id}"`, requestKey: null,
      }),
      pb.collection('teams').getFullList({
        filter: `master_team="${t2Id}"`, requestKey: null,
      }),
    ]);

    if (!t1Instances.length || !t2Instances.length) {
      out.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🤝</span>
        One or both teams have no tournament records yet.
      </div>`;
      return;
    }

    // Find shared tournaments (tournaments both teams appeared in)
    const t1TournIds      = new Set(t1Instances.map(t => t.tournament));
    const sharedTournIds  = [...new Set(
      t2Instances.map(t => t.tournament).filter(id => t1TournIds.has(id))
    )];

    if (!sharedTournIds.length) {
      out.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🤝</span>
        ${escHtml(t1?.name || 'Team A')} and ${escHtml(t2?.name || 'Team B')}
        have never been in the same tournament.
      </div>`;
      return;
    }

    // Fire all fixture queries simultaneously — no sequential loop
    // This prevents PocketBase auto-cancellation of earlier requests
    const fixtureArrays = await Promise.all(
      sharedTournIds.map(tournId => {
        const ti1 = t1Instances.find(t => t.tournament === tournId);
        const ti2 = t2Instances.find(t => t.tournament === tournId);
        if (!ti1 || !ti2) return Promise.resolve([]);

        return pb.collection('fixtures').getFullList({
          filter     : `tournament="${tournId}"&&status="completed"&&((home_team="${ti1.id}"&&away_team="${ti2.id}")||(home_team="${ti2.id}"&&away_team="${ti1.id}"))`,
          expand     : 'home_team,away_team,winner,tournament',
          requestKey : null,   // disables auto-cancellation per request
        }).catch(e => {
          console.warn('H2H fixture fetch failed for tournament', tournId, e.message);
          return [];
        });
      })
    );

    const t1Ids   = new Set(t1Instances.map(t => t.id));
    const meetings = fixtureArrays.flat();

    if (!meetings.length) {
      out.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🤝</span>
        ${escHtml(t1?.name || 'Team A')} and ${escHtml(t2?.name || 'Team B')}
        were in the same tournament but never played each other directly.
      </div>`;
      return;
    }

    // Tally wins and points
    let t1Wins = 0, t2Wins = 0, t1PtsFor = 0, t1PtsAgainst = 0;

    meetings.forEach(f => {
      const resolveId = v => typeof v === 'object' ? v?.id : v;
      const homeId    = resolveId(f.home_team);
      const winnerId  = resolveId(f.winner);
      const homeIsT1  = t1Ids.has(homeId);
      const t1Won     = homeIsT1 ? t1Ids.has(winnerId) : !t1Ids.has(winnerId);

      if (t1Won) t1Wins++; else t2Wins++;

      if (homeIsT1) {
        t1PtsFor     += (f.home_score || 0);
        t1PtsAgainst += (f.away_score || 0);
      } else {
        t1PtsFor     += (f.away_score || 0);
        t1PtsAgainst += (f.home_score || 0);
      }
    });

    const matchRows = meetings.map(f => {
      const resolveId = v => typeof v === 'object' ? v?.id : v;
      const homeIsT1  = t1Ids.has(resolveId(f.home_team));
      const t1Score   = homeIsT1 ? (f.home_score || 0) : (f.away_score || 0);
      const t2Score   = homeIsT1 ? (f.away_score || 0) : (f.home_score || 0);
      const t1Won     = t1Score > t2Score;
      const tournName = f.expand?.tournament?.name || 'Unknown';
      const roundLbl  = f.round_label || '';

      return `<tr>
        <td style="font-size:11px;padding:8px;">
          <div style="color:var(--text-primary)">${escHtml(tournName)}</div>
          ${roundLbl ? `<div style="color:var(--text-tertiary)">${escHtml(roundLbl)}</div>` : ''}
        </td>
        <td style="text-align:center;padding:8px;font-size:13px;
                   font-weight:${t1Won ? '700' : '400'};
                   color:${t1Won ? 'var(--accent)' : 'var(--text-primary)'}">
          ${t1Score}
        </td>
        <td style="text-align:center;padding:8px;font-size:13px;
                   font-weight:${!t1Won ? '700' : '400'};
                   color:${!t1Won ? 'var(--accent)' : 'var(--text-primary)'}">
          ${t2Score}
        </td>
        <td style="text-align:center;padding:8px;font-size:11px;">
          <span style="color:var(--accent)">
            ▲ ${escHtml(t1Won ? (t1?.name || '') : (t2?.name || ''))}
          </span>
        </td>
      </tr>`;
    }).join('');

    out.innerHTML = `
      <!-- H2H summary -->
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;
                  background:var(--bg-secondary);border-radius:var(--radius-md);
                  padding:1rem;margin-bottom:1rem;text-align:center;">
        <div>
          <div style="font-size:36px;font-weight:800;color:var(--accent);">${t1Wins}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
            ${escHtml(t1?.name || 'Team A')}
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;
                    font-size:20px;color:var(--text-tertiary);font-weight:300;">—</div>
        <div>
          <div style="font-size:36px;font-weight:800;color:var(--accent);">${t2Wins}</div>
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
            ${escHtml(t2?.name || 'Team B')}
          </div>
        </div>
      </div>

      <!-- Sub-summary -->
      <div style="font-size:11px;color:var(--text-tertiary);text-align:center;margin-bottom:1rem;">
        ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} ·
        ${escHtml(t1?.name || '')} avg ${(t1PtsFor / meetings.length).toFixed(1)} pts ·
        ${escHtml(t2?.name || '')} avg ${(t1PtsAgainst / meetings.length).toFixed(1)} pts
      </div>

      <!-- Match log -->
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;
                      background:var(--bg-primary);border-radius:var(--radius-md);
                      overflow:hidden;border:0.5px solid var(--border-light);">
          <thead>
            <tr style="background:var(--bg-secondary);">
              <th style="padding:6px 8px;text-align:left;font-size:10px;
                         font-weight:600;color:var(--text-tertiary);text-transform:uppercase;">
                Tournament
              </th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;
                         font-weight:600;color:var(--text-tertiary);">
                ${escHtml(t1?.name || 'A')}
              </th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;
                         font-weight:600;color:var(--text-tertiary);">
                ${escHtml(t2?.name || 'B')}
              </th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;
                         font-weight:600;color:var(--text-tertiary);">Winner</th>
            </tr>
          </thead>
          <tbody>${matchRows}</tbody>
        </table>
      </div>`;

  } catch (e) {
    console.error('loadH2H error:', e);
    out.innerHTML = `<div class="empty-state">
      <span class="empty-icon">⚠️</span>
      Failed to load: ${escHtml(e.message)}
    </div>`;
  }
}

// ── RANKINGS TAB — one table per category ─────────────────────────────────────
function renderRankings() {
  const filterCategory = document.getElementById('rankings-category')?.value || '';
  const sortBy         = document.getElementById('rankings-sort')?.value || 'win_pct';
  const wrap           = document.getElementById('rankings-table-wrap');

  const allTeams = Object.values(aggregated).filter(t => t.tournaments > 0);

  if (!allTeams.length) {
    wrap.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🏅</span>No data yet.
    </div>`;
    return;
  }

  // Group by category — filter if one selected
  const byCategory = {};
  allTeams.forEach(t => {
    const cat = t.category || 'Uncategorised';
    if (filterCategory && cat !== filterCategory) return;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  });

  if (!Object.keys(byCategory).length) {
    wrap.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🏅</span>
      No data for ${escHtml(filterCategory)}.
    </div>`;
    return;
  }

  const sortFn = (a, b) => {
    switch (sortBy) {
      case 'win_pct'    : return b.win_pct    - a.win_pct    || b.wins - a.wins;
      case 'wins'       : return b.wins       - a.wins       || b.win_pct - a.win_pct;
      case 'point_diff' : return b.point_diff - a.point_diff;
      case 'points_for' : return b.points_for - a.points_for;
      case 'tournaments': return b.tournaments - a.tournaments;
      default           : return b.win_pct - a.win_pct;
    }
  };

  // Render one ranked table per category
  wrap.innerHTML = Object.keys(byCategory).sort().map(cat => {
    const sorted = byCategory[cat].map(t => {
      const total    = t.wins + t.losses;
      const win_pct  = total > 0 ? t.wins / total : 0;
      const point_diff = pointDiff(t);
      return { ...t, total, win_pct, point_diff };
    }).sort(sortFn);

    const rows = sorted.map((t, i) => {
      const rank    = i + 1;
      const winPct  = Math.round(t.win_pct * 100);
      const pd      = t.point_diff;
      const bestPlc = t.placements.length ? Math.min(...t.placements) : null;
      const rankColor = rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#b45309' : 'var(--text-tertiary)';

      return `<tr style="cursor:pointer;" onclick="openTeamModal('${t.id}')">
        <td style="padding:8px 10px;font-size:11px;font-weight:700;
                   color:${rankColor};width:28px;">${rank}</td>
        <td style="padding:8px 10px;font-weight:500;font-size:13px;">
          ${escHtml(t.name)}
        </td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;">${t.tournaments}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;
                   font-weight:600;color:var(--accent);">${t.wins}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;">${t.losses}</td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;">
          ${winPct}%
          <span style="display:inline-block;width:40px;height:4px;background:var(--bg-secondary);
                       border-radius:99px;overflow:hidden;vertical-align:middle;margin-left:4px;">
            <span style="display:block;height:100%;width:${winPct}%;
                         background:var(--accent);border-radius:99px;"></span>
          </span>
        </td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;
                   color:${pd >= 0 ? 'var(--accent)' : 'var(--danger)'};">
          ${pd >= 0 ? '+' : ''}${pd}
        </td>
        <td style="padding:8px 10px;text-align:center;font-size:12px;">
          ${bestPlc ? placementBadge(bestPlc) : '—'}
        </td>
      </tr>`;
    }).join('');

    return `
      <div style="margin-bottom:2rem;">
        <!-- Category header -->
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;
                    letter-spacing:.07em;color:var(--text-tertiary);
                    padding-bottom:8px;
                    border-bottom:0.5px solid var(--border-light);
                    margin-bottom:8px;display:flex;justify-content:space-between;
                    align-items:baseline;">
          <span>${escHtml(cat)}</span>
          <span style="font-weight:400;">${sorted.length} team${sorted.length !== 1 ? 's' : ''}</span>
        </div>
        <!-- Rankings table -->
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;
                        background:var(--bg-primary);border-radius:var(--radius-md);
                        overflow:hidden;border:0.5px solid var(--border-light);">
            <thead>
              <tr style="background:var(--bg-secondary);">
                <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);text-transform:uppercase;">#</th>
                <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);text-transform:uppercase;">Team</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Tournaments played">T</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Wins">W</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Losses">L</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Win percentage">Win %</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Point differential">+/-</th>
                <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:600;
                           color:var(--text-tertiary);" title="Best placement">Best</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pointDiff(t) {
  return (t.points_for || 0) - (t.points_against || 0);
}

function placementLabel(p) {
  if (p === 1) return '🥇 1st';
  if (p === 2) return '🥈 2nd';
  if (p === 3) return '🥉 3rd';
  return `${p}th`;
}

function placementBadge(p) {
  const bg  = p === 1 ? '#fef3c7' : p === 2 ? '#f1f5f9' : p === 3 ? '#fef3c7' : 'var(--bg-secondary)';
  const col = p === 1 ? '#f59e0b' : p === 2 ? '#94a3b8' : p === 3 ? '#b45309' : 'var(--text-tertiary)';
  const lbl = p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : p;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;
                       width:22px;height:22px;border-radius:50%;font-size:11px;
                       font-weight:700;background:${bg};color:${col};">${lbl}</span>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
