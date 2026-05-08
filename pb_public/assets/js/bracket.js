/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — bracket.js  v4.2.0
 *
 * FIXES IN v4.2.0 vs v4.1.0
 * ──────────────────────────
 * BUG 1 — Y positions wrong (cards overlapped).
 *   Old formula: startY + i * spacing  (always anchored at top)
 *   This placed the Semifinals card at the same Y as the first Quarterfinals
 *   card instead of vertically centred between both QF children.
 *
 *   Correct formula: startY + i * spacing + spacing/2 - CARD_H/2
 *   Each card sits centred in its allocated vertical slot, so every parent
 *   is geometrically centred between its two children. Verified:
 *     QF centres:  88, 176  →  SF centre = (88+176)/2 = 132  ✓
 *
 * BUG 2 — Right-side depth was computed with wrong index arithmetic.
 *   Fix: both sides now share one yTopEdge(depth, index) helper.
 *   Depth for each side round is simply its index in nonFinalRounds (0=outermost).
 *
 * Column layout (unchanged from v4.1.0):
 *   Split by match_number within each round — top half left, bottom half right.
 *   4-team  (2 rounds): SF-top | FINAL | SF-bot              (3 cols)
 *   6-team  (3 rounds): QF-top | SF-top | FINAL | SF-bot | QF-bot  (5 cols)
 *   8-team  (3 rounds): QF-top | SF-top | FINAL | SF-bot | QF-bot  (5 cols)
 *   16-team (4 rounds): R1-top | QF-top | SF-top | FINAL | SF-bot | QF-bot | R1-bot  (7 cols)
 * =============================================================================
 */

const CONFIG = {
  API_BASE_URL : window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8090'
    : window.location.origin,
  VERSION : '4.2.0',
};

const pb = new PocketBase(CONFIG.API_BASE_URL);

const Logger = {
  debug : (m, c) => console.debug(`[DEBUG] ${m}`, c || ''),
  info  : (m, c) => console.info (`[INFO]  ${m}`, c || ''),
  warn  : (m, c) => console.warn (`[WARN]  ${m}`, c || ''),
  error : (m, c) => console.error(`[ERROR] ${m}`, c || ''),
};

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

  async init() {
    Logger.info('BracketPage.init', { version: CONFIG.VERSION });
    const params = new URLSearchParams(window.location.search);
    const id     = params.get('id');

    if (!id) {
      BracketPage._showError('No tournament ID in URL. Open this page from the tournament list.');
      return;
    }
    BracketPage._setLoading(true);
    try {
      const [tournament, teams, fixtures] = await Promise.all([
        pb.collection('tournaments').getOne(id),
        pb.collection('teams').getFullList({ filter: `tournament = "${id}"`, sort: 'seed' }),
        pb.collection('fixtures').getFullList({
          filter : `tournament = "${id}"`,
          sort   : 'round,match_number',
          expand : 'home_team,away_team,winner',
        }),
      ]);
      BracketPage.tournament = tournament;
      BracketPage.teams      = teams;
      BracketPage.fixtures   = fixtures;
      BracketPage._renderHeader();
      BracketPage._renderBracket();
    } catch (e) {
      Logger.error('Failed to load tournament', { error: e.message });
      BracketPage._showError(`Could not load tournament: ${e.message}`);
    } finally {
      BracketPage._setLoading(false);
    }
  },

  _renderHeader() {
    const t    = BracketPage.tournament;
    const fx   = BracketPage.fixtures.filter(f => !f.is_bye);
    const done = fx.filter(f => f.status === 'completed').length;
    const titleEl = document.getElementById('bracket-title');
    const metaEl  = document.getElementById('bracket-meta');
    const badgeEl = document.getElementById('bracket-status');
    if (titleEl) titleEl.textContent = t.name;
    if (metaEl)  metaEl.textContent  =
      `${BracketPage.teams.length} teams · ${t.format.replace(/_/g,' ')} · ${done}/${fx.length} matches played`;
    if (badgeEl) { badgeEl.textContent = t.status; badgeEl.className = `status-badge badge-${t.status}`; }
  },

  _renderBracket() {
    const t      = BracketPage.tournament;
    const canvas = document.getElementById('bracket-canvas-area');
    if (!canvas) return;
    if      (t.format === 'elimination')  canvas.innerHTML = BracketPage._buildMirroredBracket(BracketPage.fixtures);
    else if (t.format === 'round_robin')  canvas.innerHTML = BracketPage._buildRoundRobinView(BracketPage.fixtures);
    else if (t.format === 'group_stage')  canvas.innerHTML = BracketPage._buildGroupStageBracket(BracketPage.fixtures);
    else canvas.innerHTML = `<div class="no-bracket">Unknown format: ${escHtml(t.format)}</div>`;
    BracketPage._renderChampion();
  },

  /* ═══════════════════════════════════════════════════════════════════════════
     MIRRORED BRACKET — v4.2.0

     Structure: left half (top of draw) flows right → Final ← left (bottom of draw)

     Y-centring formula (verified):
       Each match at (depth, index) occupies a vertical slot of height:
           slot = baseSpacing × 2^depth
       Top edge of card within that slot:
           y = startY + index × slot + slot/2 − CARD_H/2
       This ensures every parent is exactly centred between its two children.

     Column split:
       nonFinalRounds[0..k] each split by match_number:
         top half (M1..Mceil(N/2))  → left columns, depth=ri (ri=0 outermost)
         bot half (Mceil(N/2)+1..N) → right columns, depth=ri (ri=0 outermost)
       Final always in centre column.
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildMirroredBracket(allFixtures) {

    // Keep only real (non-bye) bracket matches
    const fx = allFixtures
      .filter(f => !f.is_bye && !f.group_name)
      .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

    const roundMap = {};
    fx.forEach(f => {
      if (!roundMap[f.round]) roundMap[f.round] = [];
      roundMap[f.round].push(f);
    });
    Object.values(roundMap).forEach(arr => arr.sort((a, b) => a.match_number - b.match_number));

    const roundNums      = Object.keys(roundMap).map(Number).sort((a, b) => a - b);
    if (!roundNums.length) return '<div class="no-bracket">No bracket data yet.</div>';

    const finalRoundNum  = roundNums[roundNums.length - 1];
    const nonFinalRounds = roundNums.slice(0, -1);
    const numSide        = nonFinalRounds.length;
    const totalCols      = numSide + 1 + numSide;   // left + final + right
    const finalColIdx    = numSide;

    // ── Layout constants ─────────────────────────────────────────────────────
    const CARD_W       = 180;
    const CARD_H       = 72;
    const ROW_PAD      = 16;   // min gap between cards in same column
    const COL_GAP      = 48;
    const LABEL_H      = 28;
    const MARGIN_X     = 20;
    const MARGIN_Y     = 52;
    const baseSpacing  = CARD_H + ROW_PAD;  // slot height at depth 0

    // X left-edge of column ci
    const colX = ci => MARGIN_X + ci * (CARD_W + COL_GAP);

    // ── Y centring formula (BUG FIX v4.2.0) ──────────────────────────────────
    // slot at depth d = baseSpacing × 2^d
    // card top-edge at (depth d, index i) = startY + i×slot + slot/2 - CARD_H/2
    // This places the card centre at: startY + (i + 0.5) × slot
    // Parent at depth d+1, index j = floor(i/2):
    //   centre = startY + (j + 0.5) × slot_{d+1}
    //          = startY + (j + 0.5) × 2 × slot_d
    // which equals the midpoint of children j*2 and j*2+1 centres. ✓
    const startY = MARGIN_Y + LABEL_H;
    const yTopEdge = (depth, index) => {
      const slot = baseSpacing * Math.pow(2, depth);
      return startY + index * slot + slot / 2 - CARD_H / 2;
    };

    // Total SVG height: driven by the outermost round (depth 0, most matches)
    const r1Count = roundMap[roundNums[0]].length;
    const totalH  = startY + r1Count * baseSpacing + MARGIN_Y;
    const totalW  = MARGIN_X * 2 + totalCols * CARD_W + (totalCols - 1) * COL_GAP;

    // ── SVG accumulator ───────────────────────────────────────────────────────
    const svg = [];
    const green = '#1D9E75';
    const greenBg = '#E6F7F1';

    const rid   = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const trunc = (s, n = 19) => s.length > n ? s.slice(0, n - 1) + '…' : s;
    const seedOf = id => {
      if (!id) return 0;
      return BracketPage.teams.findIndex(t => rid(t.id) === id) + 1;
    };

    // ── Draw one match card ───────────────────────────────────────────────────
    const drawCard = (x, y, fixture, label, showLabel) => {
      const hn   = fixture.expand?.home_team?.name || 'TBD';
      const an   = fixture.expand?.away_team?.name || 'TBD';
      const done = fixture.status === 'completed';
      const hId  = rid(fixture.home_team);
      const aId  = rid(fixture.away_team);
      const wId  = rid(fixture.winner);
      const wH   = done && wId && wId === hId;
      const wA   = done && wId && wId === aId;
      const noTeams = !hId && !aId;

      const border  = done ? green : 'var(--border-light,#ccc)';
      const bw      = done ? 1.5 : 0.75;
      const opacity = noTeams ? 0.38 : 1;
      const rowH    = (CARD_H - 1) / 2;
      const parts   = [];

      // Round label above first card only
      if (showLabel) {
        parts.push(`<text x="${x + CARD_W / 2}" y="${y - 8}"
          text-anchor="middle" font-size="9" font-weight="600"
          letter-spacing="0.08em" fill="var(--text-tertiary,#999)"
          font-family="inherit" text-decoration="none"
          style="text-transform:uppercase">${escHtml(label)}</text>`);
      }

      // Card background
      parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"
        rx="8" fill="var(--bg-primary,#fff)"
        stroke="${border}" stroke-width="${bw}" opacity="${opacity}"/>`);

      // Home row highlight
      if (wH) parts.push(`<rect x="${x+1}" y="${y+1}" width="${CARD_W-2}" height="${rowH-1}" rx="7" fill="${greenBg}"/>`);

      // Home seed
      const hs = seedOf(hId);
      if (hs > 0) parts.push(`<text x="${x+10}" y="${y+rowH/2}"
        dominant-baseline="central" text-anchor="middle"
        font-size="9" fill="var(--text-tertiary,#bbb)" font-family="inherit">${hs}</text>`);

      // Home name
      parts.push(`<text x="${x+22}" y="${y+rowH/2}"
        dominant-baseline="central" font-size="12"
        font-weight="${wH ? '600' : '400'}"
        fill="${wH ? green : !hId ? 'var(--text-tertiary,#bbb)' : 'var(--text-primary,#222)'}"
        font-family="inherit"
        style="${!hId ? 'font-style:italic' : ''}">${escHtml(trunc(hn))}</text>`);

      // Home score
      if (done) parts.push(`<text x="${x+CARD_W-8}" y="${y+rowH/2}"
        dominant-baseline="central" text-anchor="end"
        font-size="12" font-weight="700"
        fill="${wH ? green : 'var(--text-tertiary,#aaa)'}"
        font-family="inherit">${fixture.home_score ?? ''}</text>`);

      // Divider
      parts.push(`<line x1="${x+1}" y1="${y+rowH}" x2="${x+CARD_W-1}" y2="${y+rowH}"
        stroke="var(--border-light,#eee)" stroke-width="0.5"/>`);

      // Away row
      const ay = y + rowH + 1;
      if (wA) parts.push(`<rect x="${x+1}" y="${ay}" width="${CARD_W-2}" height="${rowH}" rx="7" fill="${greenBg}"/>`);

      const as_ = seedOf(aId);
      if (as_ > 0) parts.push(`<text x="${x+10}" y="${ay+rowH/2}"
        dominant-baseline="central" text-anchor="middle"
        font-size="9" fill="var(--text-tertiary,#bbb)" font-family="inherit">${as_}</text>`);

      parts.push(`<text x="${x+22}" y="${ay+rowH/2}"
        dominant-baseline="central" font-size="12"
        font-weight="${wA ? '600' : '400'}"
        fill="${wA ? green : !aId ? 'var(--text-tertiary,#bbb)' : 'var(--text-primary,#222)'}"
        font-family="inherit"
        style="${!aId ? 'font-style:italic' : ''}">${escHtml(trunc(an))}</text>`);

      if (done) parts.push(`<text x="${x+CARD_W-8}" y="${ay+rowH/2}"
        dominant-baseline="central" text-anchor="end"
        font-size="12" font-weight="700"
        fill="${wA ? green : 'var(--text-tertiary,#aaa)'}"
        font-family="inherit">${fixture.away_score ?? ''}</text>`);

      svg.push(parts.join(''));
    };

    // ── Draw connector elbow ─────────────────────────────────────────────────
    // L-shape: from (x1,y1) horizontal to midX, vertical to y2, horizontal to (x2,y2)
    const drawConn = (x1, y1, x2, y2) => {
      const midX = (x1 + x2) / 2;
      svg.push(`<path d="M${x1},${y1} H${midX} V${y2} H${x2}"
        fill="none" stroke="var(--border-mid,#ccc)" stroke-width="0.9" opacity="0.5"/>`);
    };

    // ── Final (centre column) ─────────────────────────────────────────────────
    const finalX = colX(finalColIdx);
    const finalMatches = roundMap[finalRoundNum];
    // Centre vertically in the SVG
    // Position Final near the top, aligned with the first card of the outermost round
    const finalY = yTopEdge(0, 0);

    // Trophy icon above the Final card
    const trophyY = finalY - 36;
    svg.push(`<text x="${finalX + CARD_W / 2}" y="${trophyY}"
      text-anchor="middle" font-size="22" font-family="Segoe UI Emoji,Apple Color Emoji,sans-serif"
      dominant-baseline="auto">🏆</text>`);

    finalMatches.forEach((m, mi) => {
      drawCard(finalX, finalY + mi * (CARD_H + ROW_PAD), m, 'Final', mi === 0);
    });

    // ── Left side: top half of each non-final round ───────────────────────────
    nonFinalRounds.forEach((roundNum, ri) => {
      const depth    = ri;           // 0 = outermost, increases toward Final
      const colIdx   = ri;           // col 0 = leftmost
      const x        = colX(colIdx);
      const allM     = roundMap[roundNum];
      const half     = Math.ceil(allM.length / 2);
      const topHalf  = allM.slice(0, half);
      const label    = allM[0]?.round_label || `Round ${roundNum}`;

      topHalf.forEach((m, mi) => {
        const y = yTopEdge(depth, mi);
        drawCard(x, y, m, label, mi === 0);

        // Connector to parent (next column toward Final)
        const isLastSide     = ri === nonFinalRounds.length - 1;
        const parentColIdx   = colIdx + 1;
        const parentX        = colX(parentColIdx) ;
        let   parentY;

        if (isLastSide) {
          // Parent is the Final — use finalY
          parentY = finalY + CARD_H / 2;
        } else {
          // Parent is the next side round at depth+1, index floor(mi/2)
          parentY = yTopEdge(depth + 1, Math.floor(mi / 2)) + CARD_H / 2;
        }

        drawConn(x + CARD_W, y + CARD_H / 2, parentX, parentY);
      });
    });

    // ── Right side: bottom half of each non-final round (mirrored) ───────────
    nonFinalRounds.forEach((roundNum, ri) => {
      const depth    = ri;
      // Right side outermost = rightmost column = totalCols-1
      // ri=0 → col totalCols-1, ri=1 → col totalCols-2 …
      const colIdx   = totalCols - 1 - ri;
      const x        = colX(colIdx);
      const allM     = roundMap[roundNum];
      const half     = Math.ceil(allM.length / 2);
      const botHalf  = allM.slice(half);
      const label    = allM[0]?.round_label || `Round ${roundNum}`;

      botHalf.forEach((m, mi) => {
        const y = yTopEdge(depth, mi);
        drawCard(x, y, m, label, mi === 0);

        // Connector goes LEFT toward Final
        const isLastSide   = ri === nonFinalRounds.length - 1;
        const parentColIdx = colIdx - 1;
        const parentRightX = colX(parentColIdx) + CARD_W;
        let   parentY;

        if (isLastSide) {
          parentY = finalY + CARD_H / 2;
        } else {
          parentY = yTopEdge(depth + 1, Math.floor(mi / 2)) + CARD_H / 2;
        }

        // Right side: connector exits from left edge of card toward centre
        drawConn(x, y + CARD_H / 2, parentRightX, parentY);
      });
    });

    return `
      <style>
        .bc-scroll {
          overflow-x : auto;
          overflow-y : hidden;
          padding    : 0 0 1.5rem;
          -webkit-overflow-scrolling: touch;
        }
        .bc-scroll svg { display:block; }
      </style>
      <div class="bc-scroll">
        <svg width="${totalW}" height="${totalH}"
             viewBox="0 0 ${totalW} ${totalH}"
             xmlns="http://www.w3.org/2000/svg">
          ${svg.join('\n')}
        </svg>
      </div>`;
  },

  /* ═══════════════════════════════════════════════════════════════════════════
     GROUP STAGE
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildGroupStageBracket(allFixtures) {
    const groupFx    = allFixtures.filter(f => !f.is_bye && f.group_name);
    const knockoutFx = allFixtures.filter(f => !f.is_bye && !f.group_name);

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
          <span class="team-a ${wH?'winner-bold':''}">${escHtml(hn)}</span>
          <span class="vs">vs</span>
          <span class="team-b ${wA?'winner-bold':''}">${escHtml(an)}</span>
          ${done ? `<span class="match-score">${m.home_score} – ${m.away_score}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="round-section"><div class="round-label">${escHtml(name)}</div>${rows}</div>`;
    }).join('');

    const koHtml = knockoutFx.length
      ? BracketPage._buildMirroredBracket(knockoutFx)
      : `<div class="no-bracket" style="padding:1rem 0;">Knockout stage not yet generated.</div>`;

    return `
      <div style="margin-bottom:2rem;">
        <h3 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
                   color:var(--text-tertiary);margin-bottom:1rem;">Group Stage</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
          ${groupHtml}
        </div>
      </div>
      <div>
        <h3 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
                   color:var(--text-tertiary);margin-bottom:1rem;">Knockout Bracket</h3>
        ${koHtml}
      </div>`;
  },

  /* ═══════════════════════════════════════════════════════════════════════════
     ROUND ROBIN
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildRoundRobinView(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.round_label || `Round ${f.round}`;
      if (!rounds[key]) rounds[key] = [];
      rounds[key].push(f);
    });
    return `<div style="max-width:600px;">${
      Object.entries(rounds).map(([label, matches]) =>
        `<div class="round-section"><div class="round-label">${escHtml(label)}</div>
          ${matches.map((m, i) => {
            const hn=m.expand?.home_team?.name||'TBD', an=m.expand?.away_team?.name||'TBD';
            const done=m.status==='completed', wH=done&&m.winner===m.home_team, wA=done&&m.winner===m.away_team;
            return `<div class="match-card ${done?'completed':''}">
              <span class="match-num">M${i+1}</span>
              <span class="team-a ${wH?'winner-bold':''}">${escHtml(hn)}</span>
              <span class="vs">vs</span>
              <span class="team-b ${wA?'winner-bold':''}">${escHtml(an)}</span>
              ${done?`<span class="match-score">${m.home_score} – ${m.away_score}</span>`:''}
            </div>`;
          }).join('')}
        </div>`).join('')
    }</div>`;
  },

  /* ═══════════════════════════════════════════════════════════════════════════
     CHAMPION BOX
   ═══════════════════════════════════════════════════════════════════════════ */
  _renderChampion() {
    const t = BracketPage.tournament;
    if (t.status !== 'completed') return;
    const realFx = BracketPage.fixtures.filter(f => !f.is_bye);
    if (!realFx.length) return;
    const maxRound = Math.max(...realFx.map(f => f.round));
    const final    = realFx.find(f => f.round === maxRound && f.status === 'completed');
    if (!final) return;
    const rid    = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const wId    = rid(final.winner);
    const winner = final.expand?.winner?.name
      || BracketPage.teams.find(t => rid(t.id) === wId)?.name || 'Unknown';
    const box = document.getElementById('champion-box');
    if (!box) return;
    box.innerHTML = `<div class="trophy">🏆</div><h2>Tournament Champion</h2>
      <div class="champion-name">${escHtml(winner)}</div>`;
    box.style.display = 'block';
  },

  _showError(msg) {
    const c = document.getElementById('bracket-canvas-area');
    if (c) c.innerHTML = `<div class="no-bracket">
      <span style="font-size:32px;display:block;margin-bottom:.75rem">⚠️</span>${escHtml(msg)}</div>`;
  },
  _setLoading(on) {
    const c = document.getElementById('bracket-canvas-area');
    if (!c || !on) return;
    c.innerHTML = `<div class="no-bracket">
      <span style="font-size:32px;display:block;margin-bottom:.75rem">⏳</span>Loading...</div>`;
  },
  print()  { window.print(); },
  async refresh() { BracketPage._setLoading(true); await BracketPage.init(); },
};

document.addEventListener('DOMContentLoaded', () => {
  Logger.info('Bracket page DOM ready', { version: CONFIG.VERSION });
  BracketPage.init().catch(e => Logger.error('BracketPage.init failed', { error: e.message }));
});
