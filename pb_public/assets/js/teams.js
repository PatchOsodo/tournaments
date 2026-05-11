/**
 * =============================================================================
 * teams.js — Team registry page logic
 *
 * Self-contained — only needs pocketbase.umd.js + config.js.
 * No dependency on the main app modules (auth.js, db.js, etc.)
 *
 * FEATURES
 * --------
 * - Searchable / filterable list of all master_teams
 * - Filter by gender, age group
 * - Admin: add / edit / delete teams
 * - Everyone: view team profile with tournament history
 * =============================================================================
 */

const pb = new PocketBase(CONFIG.API_BASE_URL);

/* =============================================================================
   AUTH HELPERS (local — no dependency on auth.js)
   ============================================================================= */
const _Auth = {
  user()         { return pb.authStore.isValid ? pb.authStore.model : null; },
  role()         { return _Auth.user()?.role ?? 'visitor'; },
  isAdmin()      { return _Auth.role() === 'super_admin' || _Auth.role() === 'tournament_admin'; },
  isSuperAdmin() { return _Auth.role() === 'super_admin'; },
};

/* =============================================================================
   PAGE STATE
   ============================================================================= */
let _masterTeams   = [];   // all fetched master_team records
let _allStats      = {};   // { masterId → [team_stats records] }
let _editingTeamId = null; // ID of team currently being edited in form modal
let _profileTeamId = null; // ID of team currently shown in profile modal

/* =============================================================================
   BOOT
   ============================================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  _setConnStatus(await _checkHealth());
  _renderAuthBar();
  await Teams.load();
});

async function _checkHealth() {
  try { await pb.health.check(); return true; } catch (e) { return false; }
}

function _setConnStatus(online) {
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if (dot)   dot.className     = 'conn-dot ' + (online ? 'online' : 'offline');
  if (label) label.textContent = online ? 'Connected' : 'Offline';
}

function _renderAuthBar() {
  const ctrl = document.getElementById('auth-controls');
  if (!ctrl) return;
  const user = _Auth.user();
  if (user) {
    const roleLabel = {
      super_admin      : '⚡ Super Admin',
      tournament_admin : '✏️ Tournament Admin',
      guest            : '⭐ Guest',
    }[user.role] || user.role;
    ctrl.innerHTML = `
      <span style="font-size:12px;color:var(--text-secondary);">
        ${_esc(user.name || user.email)}
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

  // Show add button for admins
  const addBtn = document.getElementById('admin-add-btn');
  if (addBtn) addBtn.style.display = _Auth.isAdmin() ? '' : 'none';
  // Sync bottom nav Account tab — teams.js
  const bottomAuthItem = document.getElementById('bottom-nav-auth');
      if (bottomAuthItem) {
        const u = _Auth.user();
        if (u) {
          bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>${u.name?.split(' ')[0] || 'Account'}`;
          bottomAuthItem.href      = '#';
          bottomAuthItem.onclick   = (e) => {
            e.preventDefault();
            // Inline sheet — same pattern as app.js
            document.getElementById('_acct-sheet')?.remove();
            const roleLabel = { super_admin: '⚡ Super Admin', tournament_admin: '✏️ Admin', guest: '⭐ Guest' }[u.role] || '';
            const sheet = document.createElement('div');
            sheet.id    = '_acct-sheet';
            sheet.innerHTML = `
              <div style="position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.4);"
                   onclick="document.getElementById('_acct-sheet').remove()"></div>
              <div style="position:fixed;bottom:60px;left:0;right:0;z-index:300;
                          background:var(--bg-primary);border-top:0.5px solid var(--border-light);
                          border-radius:var(--radius-lg) var(--radius-lg) 0 0;
                          padding:1.25rem 1.5rem 1.5rem;max-width:480px;margin:0 auto;">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
                  ${u.name || u.email}
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:1.25rem;">
                  ${u.email}${roleLabel ? ` <span style="margin-left:8px;padding:2px 6px;border-radius:4px;background:var(--bg-secondary);border:0.5px solid var(--border-light);">${roleLabel}</span>` : ''}
                </div>
                <button onclick="pb.authStore.clear();window.location.href='login.html';"
                        class="btn sm ghost"
                        style="width:100%;justify-content:center;color:var(--danger);border-color:var(--danger);">
                  Sign out
                </button>
              </div>`;
            document.body.appendChild(sheet);
          };
        } else {
          bottomAuthItem.innerHTML = `<span class="nav-icon">👤</span>Sign in`;
          bottomAuthItem.href      = 'login.html';
          bottomAuthItem.onclick   = null;
        }
      }
}

/* =============================================================================
   TEAMS OBJECT — all page actions
   ============================================================================= */
const Teams = {

  /* ── LOAD DATA ───────────────────────────────────────────────────────── */

  async load() {
    const list = document.getElementById('teams-registry-list');
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>Loading...</div>';

    try {
      [_masterTeams] = await Promise.all([
        pb.collection('master_teams').getFullList({
          sort      : 'name',
          requestKey: null,
        }),
      ]);

      // Fetch stats summary per team (just counts — not full expand)
      const allStats = await pb.collection('team_stats').getFullList({
        requestKey: null,
      });
      _allStats = {};
      allStats.forEach(s => {
        const mid = typeof s.master_team === 'object' ? s.master_team?.id : s.master_team;
        if (!_allStats[mid]) _allStats[mid] = [];
        _allStats[mid].push(s);
      });

      // Populate age group filter with distinct values from data
      const ageGroups = [...new Set(_masterTeams.map(t => t.age_group).filter(Boolean))].sort();
      const ageFilter = document.getElementById('filter-age');
      if (ageFilter) {
        ageFilter.innerHTML = '<option value="">All age groups</option>' +
          ageGroups.map(ag => `<option value="${_esc(ag)}">${_esc(ag)}</option>`).join('');
      }

      const total = _masterTeams.length;
      const active = _masterTeams.filter(t => t.active !== false).length;
      document.getElementById('registry-summary').textContent =
        `${total} registered team${total !== 1 ? 's' : ''} · ${active} active`;

      Teams.renderList();

    } catch (e) {
      console.error('Teams.load failed:', e);
      list.innerHTML = `<div class="empty-state">
        <span class="empty-icon">⚠️</span>
        Failed to load: ${_esc(e.message)}
      </div>`;
    }
  },

  /* ── RENDER LIST ─────────────────────────────────────────────────────── */

  renderList() {
    const search    = (document.getElementById('registry-search')?.value || '').toLowerCase();
    const gender    = document.getElementById('filter-gender')?.value || '';
    const ageGroup  = document.getElementById('filter-age')?.value || '';
    const list      = document.getElementById('teams-registry-list');

    const filtered = _masterTeams.filter(t => {
      if (t.active === false) return false;           // exclude inactive
      if (!t.gender || !t.age_group) return false;   // exclude uncategorised
      const matchSearch = !search   || t.name.toLowerCase().includes(search) ||
                          (t.short_name||'').toLowerCase().includes(search);
      const matchGender = !gender   || t.gender === gender;
      const matchAge    = !ageGroup || t.age_group === ageGroup;
      return matchSearch && matchGender && matchAge;
    });

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">
        <span class="empty-icon">🔍</span>
        No teams found${search ? ` matching "${_esc(search)}"` : ''}.
      </div>`;
      return;
    }

    // Group by age_group + gender category
    const byCategory = {};
    filtered.forEach(t => {
      const cat = _categoryStr(t);
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(t);
    });

    list.innerHTML = Object.keys(byCategory).sort().map(cat => {
      const teams = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name));
      const rows  = teams.map(t => {
        const stats       = _allStats[t.id] || [];
        const totalWins   = stats.reduce((s, r) => s + (r.wins   || 0), 0);
        const totalPlayed = stats.length; // number of tournaments
        const isInactive  = t.active === false;

        return `
          <div onclick="Teams.openProfile('${t.id}')"
               style="display:flex; align-items:center; justify-content:space-between;
                padding:.7rem 1rem; border-bottom:.5px solid var(--border-light);
                cursor:pointer; transition:background .12s;"
         onmouseover="this.style.background='var(--bg-secondary)'"
         onmouseout="this.style.background='transparent'">
            <div>
              <div style="font-size:13px;font-weight:500;color:var(--text-primary);
                          display:flex;align-items:center;gap:8px;">
                ${_esc(t.name)}
                ${t.club_name && t.club_name !== t.name ? `<span style="font-size:10px;color:var(--text-tertiary);">${_esc(t.club_name)}</span>` : ''}
                ${t.short_name ? `<span style="font-size:10px;color:var(--text-tertiary);background:var(--bg-secondary);padding:1px 6px;border-radius:4px;border:.5px solid var(--border-light);">${_esc(t.short_name)}</span>` : ''}
                ${isInactive ? `<span style="font-size:10px;color:var(--text-tertiary);">inactive</span>` : ''}
              </div>
              ${t.home_court ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">🏟 ${_esc(t.home_court)}</div>` : ''}
            </div>
            <div style="display:flex;gap:16px;flex-shrink:0;align-items:center;">
              ${totalPlayed ? `
                <div style="text-align:center;">
                  <div style="font-size:14px;font-weight:700;color:var(--accent);">${totalWins}</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;">Wins</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:14px;font-weight:700;color:var(--text-secondary);">${totalPlayed}</div>
                  <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.05em;">Tournaments</div>
                </div>` : `<span style="font-size:11px;color:var(--text-tertiary);">No data yet</span>`}
              <span style="font-size:16px;color:var(--text-tertiary);">›</span>
            </div>
          </div>`;
      }).join('');

      return `
        <div style="background:var(--bg-primary);border:.5px solid var(--border-light);
                    border-radius:var(--radius-lg);margin-bottom:12px;overflow:hidden;">
          <div style="padding:.6rem 1rem;background:var(--bg-secondary);
                      border-bottom:.5px solid var(--border-light);
                      display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;
                        letter-spacing:.07em;color:var(--text-tertiary);">
              ${_esc(cat)}
            </div>
            <div style="font-size:11px;color:var(--text-tertiary);">
              ${teams.length} team${teams.length !== 1 ? 's' : ''}
            </div>
          </div>
          ${rows}
        </div>`;
    }).join('');
  },

  /* ── ADD TEAM MODAL ──────────────────────────────────────────────────── */

  openAddModal() {
    _editingTeamId = null;
    document.getElementById('form-modal-title').textContent = 'Register team';
    document.getElementById('btn-save-team').textContent    = 'Save team';
    document.getElementById('form-error').style.display     = 'none';

    // Clear all fields
    ['form-name','form-club-name','form-short-name','form-home-court'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const fg = document.getElementById('form-gender');
    const fa = document.getElementById('form-age-group');
    const fc = document.getElementById('form-age-custom');
    const fk = document.getElementById('form-active');
    if (fg) fg.value = '';
    if (fa) fa.value = '';
    if (fc) { fc.value = ''; fc.style.display = 'none'; }
    if (fk) fk.checked = true;

    document.getElementById('team-form-overlay').style.display = 'block';
    document.getElementById('form-name').focus();
  },

  openEditFromProfile() {
    if (!_profileTeamId) return;
    const team = _masterTeams.find(t => t.id === _profileTeamId);
    if (!team) return;

    _editingTeamId = team.id;
    document.getElementById('form-modal-title').textContent = 'Edit team';
    document.getElementById('btn-save-team').textContent    = 'Save changes';
    document.getElementById('form-error').style.display     = 'none';

    document.getElementById('form-name').value       = team.name       || '';
    document.getElementById('form-short-name').value = team.short_name || '';
    document.getElementById('form-home-court').value = team.home_court || '';
    document.getElementById('form-gender').value     = team.gender     || '';
    document.getElementById('form-active').checked   = team.active !== false;

    const ageGroup = team.age_group || '';
    const ageEl    = document.getElementById('form-age-group');
    const customEl = document.getElementById('form-age-custom');
    const knownAgeGroups = ['U8','U10','U12','U13','U14','U15','U16','U17','U18','Senior'];

    if (knownAgeGroups.includes(ageGroup)) {
      ageEl.value             = ageGroup;
      customEl.style.display  = 'none';
      customEl.value          = '';
    } else if (ageGroup) {
      ageEl.value             = 'custom';
      customEl.style.display  = 'block';
      customEl.value          = ageGroup;
    } else {
      ageEl.value             = '';
      customEl.style.display  = 'none';
      customEl.value          = '';
    }

    // Close profile, open form
    document.getElementById('team-profile-overlay').style.display = 'none';
    document.getElementById('team-form-overlay').style.display    = 'block';
    document.getElementById('form-name').focus();
  },

  onFormAgeGroupChange(value) {
    const customEl = document.getElementById('form-age-custom');
    if (value === 'custom') {
      customEl.style.display = 'block';
      customEl.focus();
    } else {
      customEl.style.display = 'none';
      customEl.value         = '';
    }
  },

  /* ── SAVE TEAM (add or edit) ─────────────────────────────────────────── */

  async saveTeam() {
    const errEl = document.getElementById('form-error');
    errEl.style.display = 'none';

    const name      = document.getElementById('form-name')?.value.trim()       || '';
    const gender    = document.getElementById('form-gender')?.value             || '';
    const ageGroupEl = document.getElementById('form-age-group');
    const ageCustom  = document.getElementById('form-age-custom')?.value.trim() || '';
    const ageGroup   = ageGroupEl?.value === 'custom' ? ageCustom : (ageGroupEl?.value || '');
    const shortName  = document.getElementById('form-short-name')?.value.trim() || '';
    const homeCourt  = document.getElementById('form-home-court')?.value.trim() || '';
    const active     = document.getElementById('form-active')?.checked ?? true;

    // Validate
    if (!name) {
      _showFormError('Team name is required.');
      document.getElementById('form-name').focus();
      return;
    }
    if (!gender) {
      _showFormError('Please select a gender.');
      return;
    }
    if (!ageGroup) {
      _showFormError('Please select or enter an age group.');
      return;
    }

    // Check for duplicate name + gender + age_group (excluding self when editing)
    const duplicate = _masterTeams.find(t =>
      t.name.toLowerCase() === name.toLowerCase() &&
      t.gender    === gender &&
      t.age_group === ageGroup &&
      t.id        !== _editingTeamId
    );
    if (duplicate) {
      _showFormError(`A "${_categoryStr({gender, age_group: ageGroup})}" team named "${name}" already exists.`);
      return;
    }

    const btn = document.getElementById('btn-save-team');
    btn.disabled    = true;
    btn.textContent = 'Saving...';

    try {
      const clubName = document.getElementById('form-club-name')?.value.trim() || '';
      const data = {
        name,
        club_name  : clubName  || null,
        gender     : gender    || null,
        age_group  : ageGroup  || null,
        short_name : shortName || null,
        home_court : homeCourt || null,
        active,
      };

      if (_editingTeamId) {
        await pb.collection('master_teams').update(_editingTeamId, data);
      } else {
        await pb.collection('master_teams').create(data);
      }

      document.getElementById('team-form-overlay').style.display = 'none';
      _editingTeamId = null;
      await Teams.load();

    } catch (e) {
      console.error('saveTeam failed:', e);
      _showFormError(`Save failed: ${e.message}`);
    } finally {
      btn.disabled    = false;
      btn.textContent = _editingTeamId ? 'Save changes' : 'Save team';
    }
  },

  closeFormModal(event) {
    if (event && event.target !== document.getElementById('team-form-overlay')) return;
    document.getElementById('team-form-overlay').style.display = 'none';
    _editingTeamId = null;
  },

  /* ── TEAM PROFILE MODAL ──────────────────────────────────────────────── */

  async openProfile(teamId) {
    _profileTeamId = teamId;
    const team = _masterTeams.find(t => t.id === teamId);
    if (!team) return;

    // Show modal immediately with basic info, load stats async
    document.getElementById('team-profile-overlay').style.display = 'block';
    document.getElementById('profile-name').textContent     = team.name;
    document.getElementById('profile-category').textContent = _categoryStr(team);

    // Admin buttons
    const adminBtns = document.getElementById('profile-admin-btns');
    if (adminBtns) {
      adminBtns.style.display = _Auth.isAdmin() ? 'flex' : 'none';
      const deleteBtn = document.getElementById('btn-delete-team');
      if (deleteBtn) deleteBtn.style.display = _Auth.isSuperAdmin() ? '' : 'none';
    }

    const body = document.getElementById('profile-body');
    body.innerHTML = `<div class="empty-state" style="padding:1.5rem 0;">
      <span class="empty-icon">⏳</span>Loading history...
    </div>`;

    try {
      // Fetch stats with tournament expanded
      const stats = await pb.collection('team_stats').getFullList({
        filter    : `master_team="${teamId}"`,
        sort      : '-created',
        expand    : 'tournament',
        requestKey: null,
      });

      const totalWins   = stats.reduce((s, r) => s + (r.wins   || 0), 0);
      const totalLosses = stats.reduce((s, r) => s + (r.losses || 0), 0);
      const totalPtsFor = stats.reduce((s, r) => s + (r.points_for || 0), 0);
      const totalPtsAgst = stats.reduce((s, r) => s + (r.points_against || 0), 0);
      const total       = totalWins + totalLosses;
      const winPct      = total > 0 ? Math.round((totalWins / total) * 100) : 0;
      const pd          = totalPtsFor - totalPtsAgst;
      const bestPlc     = stats.filter(s => s.placement).map(s => s.placement);
      const best        = bestPlc.length ? Math.min(...bestPlc) : null;

      const infoRows = [
        team.short_name  ? ['Short name',  team.short_name]  : null,
        team.home_court  ? ['Home court',  team.home_court]  : null,
        ['Status',       team.active !== false ? '✅ Active' : '⏸ Inactive'],
      ].filter(Boolean);

      const historyRows = stats.map(s => {
        const tName  = s.expand?.tournament?.name    || 'Unknown';
        const evName = s.expand?.tournament?.event_name || '';
        const w = s.wins || 0, l = s.losses || 0;
        const spd = (s.points_for||0) - (s.points_against||0);
        const plc = s.placement;
        return `<tr>
          <td style="padding:7px 8px;">
            <div style="font-size:12px;font-weight:500;">${_esc(tName)}</div>
            ${evName ? `<div style="font-size:10px;color:var(--text-tertiary);">${_esc(evName)}</div>` : ''}
            ${s.group_name ? `<div style="font-size:10px;color:var(--text-tertiary);">${_esc(s.group_name)}</div>` : ''}
          </td>
          <td style="padding:7px 8px;text-align:center;font-weight:600;font-size:12px;color:var(--accent);">${w}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;">${l}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:${spd>=0?'var(--accent)':'var(--danger)'};">${spd>=0?'+':''}${spd}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;">${plc ? _placementBadge(plc) : '—'}</td>
        </tr>`;
      }).join('');

      body.innerHTML = `
        <!-- Team details -->
        ${infoRows.length ? `
          <div style="background:var(--bg-secondary);border-radius:var(--radius-md);
                      padding:.75rem 1rem;margin-bottom:1rem;font-size:12px;">
            ${infoRows.map(([label, val]) =>
              `<div style="display:flex;justify-content:space-between;padding:3px 0;">
                 <span style="color:var(--text-tertiary);">${_esc(label)}</span>
                 <span style="color:var(--text-primary);font-weight:500;">${_esc(val)}</span>
               </div>`
            ).join('')}
          </div>` : ''}

        <!-- Career stats -->
        ${stats.length ? `
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:1rem;">
            ${[
              [stats.length, 'Tournaments'],
              [winPct + '%', 'Win rate'],
              [(pd >= 0 ? '+' : '') + pd, 'Point diff', pd >= 0 ? 'var(--accent)' : 'var(--danger)'],
              [best ? _placementLabel(best) : '—', 'Best finish'],
            ].map(([val, lbl, color]) => `
              <div style="background:var(--bg-secondary);border-radius:var(--radius-md);
                          padding:10px 8px;text-align:center;">
                <div style="font-size:18px;font-weight:700;color:${color||'var(--accent)'};">${val}</div>
                <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;
                            letter-spacing:.05em;margin-top:2px;">${lbl}</div>
              </div>`).join('')}
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:1rem;">
            <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 8px;text-align:center;">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${totalWins}W – ${totalLosses}L</div>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">Overall record</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 8px;text-align:center;">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
                ${total > 0 ? (totalPtsFor/total).toFixed(1) : '—'} / ${total > 0 ? (totalPtsAgst/total).toFixed(1) : '—'}
              </div>
              <div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">Avg pts for / against</div>
            </div>
          </div>

          <!-- Tournament history table -->
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
                      color:var(--text-tertiary);margin-bottom:8px;">Tournament history</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;
                          background:var(--bg-primary);border-radius:var(--radius-md);
                          overflow:hidden;border:.5px solid var(--border-light);">
              <thead>
                <tr style="background:var(--bg-secondary);">
                  <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;">Tournament</th>
                  <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:var(--text-tertiary);">W</th>
                  <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:var(--text-tertiary);">L</th>
                  <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:var(--text-tertiary);">+/-</th>
                  <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;color:var(--text-tertiary);">Finish</th>
                </tr>
              </thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>` :
          `<div style="color:var(--text-tertiary);font-size:12px;padding:1rem 0;text-align:center;">
             No tournament data recorded yet.
           </div>`}`;

    } catch (e) {
      console.error('openProfile failed:', e);
      body.innerHTML = `<div class="empty-state">
        <span class="empty-icon">⚠️</span>
        Failed to load profile: ${_esc(e.message)}
      </div>`;
    }
  },

  closeProfileModal(event) {
    if (event && event.target !== document.getElementById('team-profile-overlay')) return;
    document.getElementById('team-profile-overlay').style.display = 'none';
    _profileTeamId = null;
  },

  /* ── DELETE TEAM ─────────────────────────────────────────────────────── */

  async deleteTeamFromProfile() {
    if (!_profileTeamId || !_Auth.isSuperAdmin()) return;
    const team = _masterTeams.find(t => t.id === _profileTeamId);
    if (!team) return;

    if (!confirm(`Delete "${team.name}" (${_categoryStr(team)})?\n\nThis will permanently remove the team from the registry. Existing tournament records and stats will not be deleted but will lose the link to this master record.\n\nThis cannot be undone.`)) return;

    try {
      await pb.collection('master_teams').delete(_profileTeamId);
      document.getElementById('team-profile-overlay').style.display = 'none';
      _profileTeamId = null;
      await Teams.load();
    } catch (e) {
      console.error('deleteTeam failed:', e);
      alert(`Delete failed: ${e.message}`);
    }
  },

};  // ← end of Teams object

/* =============================================================================
   PRIVATE HELPERS
   ============================================================================= */
function _esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _categoryStr(team) {
  const ag = (team?.age_group || '').trim();
  const g  = (team?.gender    || '').trim();
  if (ag && g)  return `${ag} ${g}`;
  if (ag)       return ag;
  if (g)        return g;
  return 'Uncategorised';
}

function _placementLabel(p) {
  if (p === 1) return '🥇 1st';
  if (p === 2) return '🥈 2nd';
  if (p === 3) return '🥉 3rd';
  return `${p}th`;
}

function _placementBadge(p) {
  const bg  = p === 1 ? '#fef3c7' : p === 2 ? '#f1f5f9' : p === 3 ? '#fef3c7' : 'var(--bg-secondary)';
  const col = p === 1 ? '#f59e0b' : p === 2 ? '#94a3b8' : p === 3 ? '#b45309' : 'var(--text-tertiary)';
  const lbl = p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : p;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;
                       width:22px;height:22px;border-radius:50%;font-size:11px;
                       font-weight:700;background:${bg};color:${col};">${lbl}</span>`;
}

function _showFormError(msg) {
  const el = document.getElementById('form-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
