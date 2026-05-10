/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — bracket.js  v5.0.0
 *
 * CHANGES IN v5.0.0
 * ──────────────────
 * • _buildMirroredBracket completely rewritten:
 *     - UCL-style top-to-bottom flow on each side
 *     - Trophy centred between the two sides at the top
 *     - Final centred below the trophy
 *     - Left side feeds into the Final from the left
 *     - Right side feeds into the Final from the right
 *     - Connector lines: horizontal stubs → vertical runs → horizontal into parent
 * • Initial-letter badges (coloured circles) — toggled via .show-badges class
 * • Mobile swipe-tab layout — toggled via .mobile-tabs class (or auto at ≤480 px)
 * • Two new BracketPage methods: toggleBadges(), toggleTabs()
 * =============================================================================
 */

const CONFIG = {
  API_BASE_URL : window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8090'
    : window.location.origin,
  VERSION : '5.0.0',
};

const pb = new PocketBase(CONFIG.API_BASE_URL);

window.BracketTabs = {
        show(name, btn) {
          document.querySelectorAll('.bc-tab-panel').forEach(p => p.classList.remove('active'));
          document.querySelectorAll('.bc-tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('bc-tab-' + name)?.classList.add('active');
          btn.classList.add('active');
        },
      };

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
   BADGE HELPERS
   ============================================================================= */

/** Derive 2-letter initials from a team name */
function teamInitials(name) {
  if (!name || name === 'TBD') return '?';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Deterministic accent colour from team name — one of 10 palette entries */
function badgeColor(name) {
  const palette = [
    '#1D9E75','#E84040','#4A7FE5','#E5A020',
    '#9B59B6','#E67E22','#16A085','#C0392B',
    '#2980B9','#F39C12',
  ];
  let h = 0;
  for (const c of (name || '')) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF;
  return palette[h % palette.length];
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
    if      (t.format === 'elimination') canvas.innerHTML = BracketPage._buildMirroredBracket(BracketPage.fixtures);
    else if (t.format === 'round_robin') canvas.innerHTML = BracketPage._buildRoundRobinView(BracketPage.fixtures);
    else if (t.format === 'group_stage') canvas.innerHTML = BracketPage._buildGroupStageBracket(BracketPage.fixtures);
    else canvas.innerHTML = `<div class="no-bracket">Unknown format: ${escHtml(t.format)}</div>`;
    BracketPage._renderChampion();
  },

  /* ─────────────────────────────────────────────────────────────────────────
     TOGGLE HELPERS  (called by buttons in bracket.html)
   ───────────────────────────────────────────────────────────────────────── */
  toggleBadges() {
    document.getElementById('bc-wrap')?.classList.toggle('show-badges');
  },
  toggleTabs() {
    document.getElementById('bc-wrap')?.classList.toggle('mobile-tabs');
  },

  /* ═══════════════════════════════════════════════════════════════════════════
     MIRRORED BRACKET v5.0 — UCL top-to-bottom style
     ───────────────────────────────────────────────────────────────────────────
     GEOMETRY
     ─────────
     The bracket is split into three visual zones:
       • Left half  — rounds stacked top-to-bottom, outermost round at the top
       • Centre     — trophy icon + Final card
       • Right half — same as left, mirrored horizontally

     Round columns:
       Left side  (outermost→innermost, left→right): col 0 … col (numSide-1)
       Final:     col numSide
       Right side (innermost→outermost, left→right): col (numSide+1) … col (2*numSide)

     Y positioning — top-to-bottom tree:
       Every round column has a fixed number of cards: 2^depth, where depth=0
       is the innermost round (feeds Final directly).
       Cards are evenly spaced within a total allocated height.
       Parent card is always centred between its two children.

     Connectors:
       Left side : right edge of card → horizontal stub right → vertical run
                   → horizontal run into left edge of parent card
       Right side: left edge of card → horizontal stub left → vertical run
                   → horizontal run into right edge of parent card

     Badges:
       Both a seed-number text AND a coloured-circle badge are rendered for
       every team row. The CSS class .show-badges on #bc-wrap hides seed numbers
       and reveals badges. Default shows seed numbers.

     Mobile tabs:
       .mobile-tabs on #bc-wrap activates a tab bar (Left / Final / Right).
       At ≤480 px viewport width this class is auto-applied via a CSS @media rule.
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildMirroredBracket(allFixtures) {

    /* ── 0. Filter & group ─────────────────────────────────────────────────── */
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
    const nonFinalRounds = roundNums.slice(0, -1);  // sorted earliest→latest
    const numSide        = nonFinalRounds.length;   // columns on each side

    /* ── 1. Layout constants ───────────────────────────────────────────────── */
    const CARD_W    = 188;
    const CARD_H    = 74;
    const ROW_PAD   = 14;   // vertical gap between cards in the same column
    const COL_GAP   = 52;   // horizontal gap between adjacent columns
    const LABEL_H   = 22;   // height of round label above first card
    const MARGIN_X  = 16;
    const MARGIN_Y  = 16;
    const TROPHY_H  = 48;   // reserved above Final for trophy
    const STUB_LEN  = 20;   // horizontal stub length on each connector end
    const BADGE_R   = 9;    // badge circle radius

    /* depth: 0 = innermost (feeds Final), numSide-1 = outermost */
    /* For depth d, the round has 2^d cards per side */

    /* The innermost side round has 1 card per side.
       It must connect to the Final. We fix the Final Y so that:
         - Trophy sits TROPHY_H above the Final card
         - The Final card is vertically centred between the two SF cards */

    /* Total vertical span of the outermost round (depth = numSide-1): */
    const outerCount  = Math.pow(2, Math.max(numSide - 1, 0));
    const outerSpan   = outerCount * CARD_H + (outerCount - 1) * ROW_PAD;

    /* All rounds share the same total vertical span (outermost drives it) */
    const totalSpan   = outerSpan;

    const startY      = MARGIN_Y + TROPHY_H + LABEL_H;            // top of first card
    const endY        = startY + totalSpan;             // bottom of last card

    /* Final card is centred in the same vertical span */
    const finalCardH  = CARD_H;
    const finalY      = startY + (totalSpan - finalCardH) / 2;

    /* trophy sits above Final */
    const trophyY     = MARGIN_Y;

    /* Total SVG height */
    const totalH = endY + MARGIN_Y;

    /* X helpers */
    const totalCols = numSide + 1 + numSide;
    const colX = ci => MARGIN_X + ci * (CARD_W + COL_GAP);
    const finalColIdx = numSide;
    const totalW = MARGIN_X * 2 + totalCols * CARD_W + (totalCols - 1) * COL_GAP;

    /* Y centre of card at (depth, index) — evenly distributed within totalSpan */
    const yCardTop = (depth, index) => {
      const count  = Math.pow(2, depth);
      const slotH  = totalSpan / count;
      return startY + index * slotH + (slotH - CARD_H) / 2;
    };

    /* ── 2. SVG accumulator & helpers ─────────────────────────────────────── */
    const svg   = [];
    const green = '#1D9E75';
    const rid   = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const trunc = (s, n = 17) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
    const seedOf = id => {
      if (!id) return 0;
      return BracketPage.teams.findIndex(t => rid(t.id) === id) + 1;
    };

    /* ── 3. Draw a single team row inside a card ─────────────────────────── */
    const drawRow = (x, rowY, rowH, name, teamId, isWinner, rowIdx) => {
      const isHome  = rowIdx === 0;
      const isTBD   = !teamId;
      const color   = isTBD
        ? 'var(--text-tertiary,#888)'
        : isWinner
          ? green
          : 'var(--text-primary,#eee)';
      const fw      = isWinner ? '700' : '400';
      const fi      = isTBD   ? 'italic' : 'normal';
      const seed    = seedOf(teamId);
      const initStr = teamInitials(name);
      const bgCol   = badgeColor(name);
      const cy      = rowY + rowH / 2;
      const parts   = [];

      /* winner row highlight */
      if (isWinner) {
        parts.push(
          `<rect x="${x+1}" y="${rowY}" width="${CARD_W-2}" height="${rowH}"
            rx="5" fill="${green}" fill-opacity="0.12"/>`
        );
      }

      /* ── Seed number (default visible, hidden in .show-badges) ── */
      if (seed > 0) {
        parts.push(
          `<text x="${x+13}" y="${cy}" dominant-baseline="central"
            text-anchor="middle" font-size="9" font-weight="500"
            fill="var(--text-tertiary,#888)" font-family="inherit"
            class="bc-seed-num">${seed}</text>`
        );
      }

      /* ── Badge circle + initials (hidden by default, shown in .show-badges) ── */
      parts.push(
        `<circle cx="${x+13}" cy="${cy}" r="${BADGE_R}"
          fill="${bgCol}" class="bc-badge" opacity="0.9"/>`,
        `<text x="${x+13}" y="${cy}" dominant-baseline="central"
          text-anchor="middle" font-size="8" font-weight="700"
          fill="#fff" font-family="inherit"
          class="bc-badge">${escHtml(teamInitials(name))}</text>`
      );

      /* team name */
      parts.push(
        `<text x="${x+27}" y="${cy}" dominant-baseline="central"
          font-size="12" font-weight="${fw}" font-style="${fi}"
          fill="${color}" font-family="inherit">${escHtml(trunc(name))}</text>`
      );

      svg.push(parts.join(''));
    };

    /* ── 4. Draw a complete match card ───────────────────────────────────── */
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
      const border  = done ? green : 'var(--border-light,#444)';
      const bw      = done ? 1.5 : 0.75;
      const rowH    = (CARD_H - 1) / 2;

      if (showLabel) {
        svg.push(
          `<text x="${x + CARD_W / 2}" y="${y - 7}"
            text-anchor="middle" font-size="9" font-weight="700"
            letter-spacing="0.10em" fill="var(--text-tertiary,#888)"
            font-family="inherit" style="text-transform:uppercase">
            ${escHtml(label)}
          </text>`
        );
      }

      /* card background */
      svg.push(
        `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"
          rx="8" fill="var(--bg-primary,#252525)"
          stroke="${border}" stroke-width="${bw}"
          opacity="${noTeams ? 0.3 : 1}"/>`
      );

      /* home row */
      drawRow(x, y + 1, rowH - 1, hn, hId, wH, 0);

      /* score — home */
      if (done) svg.push(
        `<text x="${x+CARD_W-9}" y="${y + rowH/2}" dominant-baseline="central"
          text-anchor="end" font-size="13" font-weight="800"
          fill="${wH ? green : 'var(--text-secondary,#999)'}"
          font-family="inherit">${fixture.home_score ?? ''}</text>`
      );

      /* divider */
      svg.push(
        `<line x1="${x+2}" y1="${y+rowH}" x2="${x+CARD_W-2}" y2="${y+rowH}"
          stroke="var(--border-light,#3a3a3a)" stroke-width="0.5"/>`
      );

      /* away row */
      drawRow(x, y + rowH + 1, rowH, an, aId, wA, 1);

      /* score — away */
      if (done) svg.push(
        `<text x="${x+CARD_W-9}" y="${y + rowH + 1 + rowH/2}" dominant-baseline="central"
          text-anchor="end" font-size="13" font-weight="800"
          fill="${wA ? green : 'var(--text-secondary,#999)'}"
          font-family="inherit">${fixture.away_score ?? ''}</text>`
      );
    };

    /* ── 5. Draw an L-shaped connector ───────────────────────────────────── */
    /* Left side: card right-edge → stub right → vertical → stub right into parent left-edge */
    /* Right side: card left-edge → stub left → vertical → stub left into parent right-edge */
    const drawConnLeft = (x1, midY1, x2, midY2) => {
      /* x1 = right edge of child card, x2 = left edge of parent card */
      const elbowX = x1 + STUB_LEN;
      svg.push(
        `<path d="M${x1},${midY1} H${elbowX} V${midY2} H${x2}"
          fill="none" stroke="var(--border-mid,#555)"
          stroke-width="1.2" opacity="0.55"/>`
      );
    };
    const drawConnRight = (x1, midY1, x2, midY2) => {
      /* x1 = left edge of child card, x2 = right edge of parent card */
      const elbowX = x1 - STUB_LEN;
      svg.push(
        `<path d="M${x1},${midY1} H${elbowX} V${midY2} H${x2}"
          fill="none" stroke="var(--border-mid,#555)"
          stroke-width="1.2" opacity="0.55"/>`
      );
    };

    /* ── 6. Trophy ───────────────────────────────────────────────────────── */
    const trophyX = colX(finalColIdx) + CARD_W / 2;
    svg.push(
      `<text x="${trophyX}" y="${trophyY + TROPHY_H - 4}"
        text-anchor="middle" font-size="28"
        font-family="inherit">🏆</text>`
    );

    /* ── 7. Final card ───────────────────────────────────────────────────── */
    const finalMatches = roundMap[finalRoundNum];
    finalMatches.forEach((m, mi) => {
      drawCard(
        colX(finalColIdx),
        finalY + mi * (CARD_H + ROW_PAD),
        m, 'Final', mi === 0
      );
    });

    /* ── 8. Left side — outermost round in col 0, innermost in col (numSide-1) ── */
    /* nonFinalRounds[0] = earliest (outermost), nonFinalRounds[numSide-1] = innermost */
    nonFinalRounds.forEach((roundNum, ri) => {
      /* ri=0 → outermost (depth = numSide-1), ri=numSide-1 → innermost (depth=0) */
      const depth   = numSide - 1 - ri;
      const colIdx  = ri;               /* left: col 0=outermost, col numSide-1=innermost */
      const x       = colX(colIdx);
      const allM    = roundMap[roundNum];
      const half    = Math.ceil(allM.length / 2);
      const topHalf = allM.slice(0, half);
      const label   = allM[0]?.round_label || `Round ${roundNum}`;

      topHalf.forEach((m, mi) => {
        const y         = yCardTop(depth, mi);
        const cardMidY  = y + CARD_H / 2;
        drawCard(x, y, m, label, mi === 0);

        /* connector to parent (col to the right) */
        const parentColIdx = colIdx + 1;
        const parentX_left = colX(parentColIdx);     /* left edge of parent */

        let parentMidY;
        if (ri === numSide - 1) {
          /* innermost — connects to Final */
          parentMidY = finalY + CARD_H / 2;
        } else {
          /* parent is depth-1, index floor(mi/2) */
          const parentDepth = depth - 1;
          parentMidY = yCardTop(parentDepth, Math.floor(mi / 2)) + CARD_H / 2;
        }

        drawConnLeft(x + CARD_W, cardMidY, parentX_left, parentMidY);
      });
    });

    /* ── 9. Right side — innermost in col (numSide+1), outermost in last col ── */
    nonFinalRounds.forEach((roundNum, ri) => {
      const depth   = numSide - 1 - ri;
      /* right side: innermost adjacent to Final, outermost at far right */
      const colIdx  = finalColIdx + numSide - ri;
      const x       = colX(colIdx);
      const allM    = roundMap[roundNum];
      const half    = Math.ceil(allM.length / 2);
      const botHalf = allM.slice(half);
      const label   = allM[0]?.round_label || `Round ${roundNum}`;

      botHalf.forEach((m, mi) => {
        const y        = yCardTop(depth, mi);
        const cardMidY = y + CARD_H / 2;
        drawCard(x, y, m, label, mi === 0);

        /* connector to parent (col to the left) */
        const parentColIdx  = colIdx - 1;
        const parentX_right = colX(parentColIdx) + CARD_W;   /* right edge of parent */

        let parentMidY;
        if (ri === numSide - 1) {
          parentMidY = finalY + CARD_H / 2;
        } else {
          const parentDepth = depth - 1;
          parentMidY = yCardTop(parentDepth, Math.floor(mi / 2)) + CARD_H / 2;
        }

        drawConnRight(x, cardMidY, parentX_right, parentMidY);
      });
    });

    /* ── 10. Build the SVG string ─────────────────────────────────────────── */
    const svgStr = `
      <svg width="${totalW}" height="${totalH}"
           viewBox="0 0 ${totalW} ${totalH}"
           xmlns="http://www.w3.org/2000/svg"
           id="bc-svg">
        <style>
          /* Badge/seed toggle */
          .bc-badge    { opacity: 0; transition: opacity 0.2s; }
          .bc-seed-num { opacity: 1; transition: opacity 0.2s; }
          #bc-wrap.show-badges .bc-badge    { opacity: 1; }
          #bc-wrap.show-badges .bc-seed-num { opacity: 0; }
        </style>
        ${svg.join('\n')}
      </svg>`;

    /* ── 11. Tab HTML for mobile view ─────────────────────────────────────── */
    /* Split the SVG into three viewBox sub-views for left / final / right */
    
    const PAD = 12;   // breathing room around card edges in each tab panel

    // Left tab: from left edge of outermost left card to right edge of innermost left card
    // Outermost left card is at colX(0), innermost left card right edge is colX(numSide-1) + CARD_W
    // Also include the connector stub that extends rightward from the innermost card
    const leftVB_x = colX(0) - PAD;
    const leftVB_w = (colX(numSide - 1) + CARD_W + STUB_LEN + PAD) - leftVB_x;
    const leftVB   = `${leftVB_x} 0 ${leftVB_w} ${totalH}`;

    // Centre tab: from left edge of Final card to right edge, with padding
    const centreVB_x = colX(finalColIdx) - PAD;
    const centreVB_w = CARD_W + PAD * 2;
    const centreVB   = `${centreVB_x} 0 ${centreVB_w} ${totalH}`;

    // Right tab: from left edge of innermost right card (minus stub) to right edge of outermost right card
    // Innermost right card is at colX(finalColIdx + 1), outermost is colX(finalColIdx + numSide)
    const rightVB_x = colX(finalColIdx + 1) - STUB_LEN - PAD;
    const rightVB_w = (colX(finalColIdx + numSide) + CARD_W + PAD) - rightVB_x;
    const rightVB   = `${rightVB_x} 0 ${rightVB_w} ${totalH}`;

    /* Re-use the same SVG content in three tab panels via viewBox clipping */
    const tabSvg = (vb, w, align = 'xMidYMid') =>
      `<svg width="100%" height="${totalH}" viewBox="${vb}"
        style="max-width:${w}px;display:block;margin:0 auto;" xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet">
        <style>
          .bc-badge    { opacity: 0; }
          .bc-seed-num { opacity: 1; }
          #bc-wrap.show-badges .bc-badge    { opacity: 1; }
          #bc-wrap.show-badges .bc-seed-num { opacity: 0; }
        </style>
        ${svg.join('\n')}
      </svg>`;

    /* ── 12. Outer container with zoom + tab layout ───────────────────────── */
    return `
      <style>
        /* ── Container ── */
        .bc-zoom-wrap {
          position      : relative;
          width         : 100%;
          overflow      : hidden;
          box-sizing    : border-box;
          background    : var(--bg-secondary, #1e1e1e);
          border-radius : var(--radius-lg, 10px);
          border        : 0.5px solid var(--border-light, #333);
          touch-action  : pan-x pan-y pinch-zoom;
          user-select   : none;
          cursor        : grab;
        }
        .bc-zoom-wrap:active { cursor: grabbing; }

        /* ── Zoom controls (full-bracket mode) ── */
        .bc-zoom-controls {
          position : absolute;
          top      : 8px;
          right    : 10px;
          display  : flex;
          gap      : 4px;
          z-index  : 10;
        }
        .bc-zoom-btn {
          width           : 28px;
          height          : 28px;
          border          : 0.5px solid var(--border-light, #444);
          border-radius   : 6px;
          background      : var(--bg-primary, #2a2a2a);
          color           : var(--text-primary, #eee);
          font-size       : 16px;
          cursor          : pointer;
          display         : flex;
          align-items     : center;
          justify-content : center;
          line-height     : 1;
        }
        .bc-zoom-btn:hover { opacity: 0.8; }
        .bc-zoom-hint {
          position       : absolute;
          bottom         : 8px;
          right          : 10px;
          font-size      : 10px;
          color          : var(--text-tertiary, #666);
          pointer-events : none;
        }
        .bc-inner {
          transform-origin : top left;
          will-change      : transform;
          display          : inline-block;
        }

        /* ── Tab bar (hidden in full-bracket mode) ── */
        .bc-tab-bar {
          display : none;
        }
        .bc-tab-btn {
          flex            : 1;
          padding         : 8px 0;
          font-size       : 12px;
          font-weight     : 600;
          text-transform  : uppercase;
          letter-spacing  : 0.06em;
          border          : none;
          background      : transparent;
          color           : var(--text-tertiary, #888);
          cursor          : pointer;
          border-bottom   : 2px solid transparent;
          transition      : color 0.15s, border-color 0.15s;
        }
        .bc-tab-btn.active {
          color              : #1D9E75;
          border-bottom-color: #1D9E75;
        }
        .bc-tab-panel        { display: none; overflow-x: auto; padding: 8px; }
        .bc-tab-panel.active { display: block; }

        /* ── .mobile-tabs mode: show tab bar, hide zoom controls ── */
        #bc-wrap.mobile-tabs .bc-zoom-controls { display: none; }
        #bc-wrap.mobile-tabs .bc-zoom-hint     { display: none; }
        #bc-wrap.mobile-tabs .bc-tab-bar       { display: flex; border-bottom: 0.5px solid var(--border-light,#333); }
        #bc-wrap.mobile-tabs .bc-inner         { display: none; }

        /* ── Auto-switch to tabs on narrow screens ── */
        @media (max-width: 768px) {
          #bc-wrap .bc-zoom-controls { display: none; }
          #bc-wrap .bc-zoom-hint     { display: none; }
          #bc-wrap .bc-tab-bar       { display: flex; border-bottom: 0.5px solid var(--border-light,#333); }
          #bc-wrap .bc-inner         { display: none; }
          #bc-wrap .bc-tab-panel     { display: none; }
          #bc-wrap .bc-tab-panel.active { display: block; }
          #bc-wrap { cursor: default; height: auto !important; min-height: 320px; }
          #bc-wrap .bc-tab-panel svg { height: auto !important; max-height: 75vh; }
        }
        @media (min-width: 769px) {
          /* Desktop: always show full tree, always hide tab bar and panels */
          #bc-wrap .bc-tab-bar    { display: none !important; }
          #bc-wrap .bc-tab-panel  { display: none !important; }
          #bc-wrap .bc-inner      { display: inline-block !important; }
          #bc-wrap .bc-zoom-controls { display: flex !important; }
        }
      </style>

      <div class="bc-zoom-wrap" id="bc-wrap"
           style="height:${Math.min(totalH, 580)}px; min-height:280px;"
           data-total-h="${totalH}">

        <!-- Zoom controls (full-bracket mode) -->
        <div class="bc-zoom-controls">
          <button class="bc-zoom-btn" onclick="BracketZoom.zoomIn()"  title="Zoom in">+</button>
          <button class="bc-zoom-btn" onclick="BracketZoom.zoomOut()" title="Zoom out">−</button>
          <button class="bc-zoom-btn" onclick="BracketZoom.reset()"   title="Fit" style="font-size:11px;">⤢</button>
        </div>

        <!-- Full-bracket zoomable view -->
        <div class="bc-inner" id="bc-inner">
          ${svgStr}
        </div>

        <!-- Tab bar (mobile tabs mode) -->
        <div class="bc-tab-bar" id="bc-tab-bar">
          <button class="bc-tab-btn active" onclick="BracketTabs.show('left',this)">◀ Left</button>
          <button class="bc-tab-btn"        onclick="BracketTabs.show('final',this)">🏆 Final</button>
          <button class="bc-tab-btn"        onclick="BracketTabs.show('right',this)">Right ▶</button>
        </div>

        <!-- Tab panels -->
        <div class="bc-tab-panel active" id="bc-tab-left">
          ${tabSvg(leftVB,   leftVB_w)}
        </div>
        <div class="bc-tab-panel" id="bc-tab-final">
          ${tabSvg(centreVB, centreVB_w)}
        </div>
        <div class="bc-tab-panel" id="bc-tab-right">
          ${tabSvg(rightVB,  rightVB_w)}
        </div>

        <div class="bc-zoom-hint">Scroll or pinch to zoom · Drag to pan</div>
      </div>

      <script>
      /* ── Tab controller ── */
      window.BracketTabs = {
        show(name, btn) {
          document.querySelectorAll('.bc-tab-panel').forEach(p => p.classList.remove('active'));
          document.querySelectorAll('.bc-tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById('bc-tab-' + name)?.classList.add('active');
          btn.classList.add('active');
        },
      };
    /* ── Zoom controller (full-bracket mode) ── */
      (function() {
        if (window.BracketZoom && window.BracketZoom._active) return;
        window.BracketZoom = {
          _active : true,
          scale   : 1,
          minScale: 0.15,
          maxScale: 3,
          ox: 0, oy: 0,
          _drag: false, _lx: 0, _ly: 0, _pinchD: null,
          wrap: null, inner: null,

          init() {
            this.wrap  = document.getElementById('bc-wrap');
            this.inner = document.getElementById('bc-inner');
            if (!this.wrap || !this.inner) return;

            this.scale = this.wrap.clientWidth / ${totalW};
            this.ox = 0; this.oy = 0;
            this._apply();

            window.addEventListener('resize', () => {
              this.scale = this.wrap.clientWidth / ${totalW};
              this.ox = 0; this.oy = 0;
              this._apply();
            });

            this.wrap.addEventListener('wheel', e => {
              e.preventDefault();
              const r = this.wrap.getBoundingClientRect();
              this._zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 0.85 : 1.18);
            }, { passive: false });

            this.wrap.addEventListener('mousedown', e => {
              this._drag = true; this._lx = e.clientX; this._ly = e.clientY;
            });
            window.addEventListener('mousemove', e => {
              if (!this._drag) return;
              this.ox += e.clientX - this._lx; this.oy += e.clientY - this._ly;
              this._lx = e.clientX; this._ly = e.clientY;
              this._apply();
            });
            window.addEventListener('mouseup', () => { this._drag = false; });

            this.wrap.addEventListener('touchstart', e => {
              if (e.touches.length === 2) this._pinchD = this._dist(e.touches);
              else { this._lx = e.touches[0].clientX; this._ly = e.touches[0].clientY; }
            }, { passive: true });

            this.wrap.addEventListener('touchmove', e => {
              if (e.touches.length === 2) {
                e.preventDefault();
                const d = this._dist(e.touches);
                if (this._pinchD) {
                  const r  = this.wrap.getBoundingClientRect();
                  const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
                  const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
                  this._zoomAt(cx, cy, d / this._pinchD);
                }
                this._pinchD = d;
              } else if (e.touches.length === 1) {
                this.ox += e.touches[0].clientX - this._lx;
                this.oy += e.touches[0].clientY - this._ly;
                this._lx = e.touches[0].clientX;
                this._ly = e.touches[0].clientY;
                this._apply();
              }
            }, { passive: false });

            this.wrap.addEventListener('touchend', () => { this._pinchD = null; });
          },

          _dist(t) {
            const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
            return Math.sqrt(dx*dx + dy*dy);
          },
          _zoomAt(px, py, factor) {
            const ns = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
            const r  = ns / this.scale;
            this.ox  = px - r * (px - this.ox);
            this.oy  = py - r * (py - this.oy);
            this.scale = ns;
            this._apply();
          },
          _apply() {
            if (this.inner)
              this.inner.style.transform =
                'translate(' + this.ox + 'px,' + this.oy + 'px) scale(' + this.scale + ')';
          },
          zoomIn()  { const r=this.wrap.getBoundingClientRect(); this._zoomAt(r.width/2,r.height/2,1.25); },
          zoomOut() { const r=this.wrap.getBoundingClientRect(); this._zoomAt(r.width/2,r.height/2,0.8);  },
          reset()   { this.scale=this.wrap.clientWidth/${totalW}; this.ox=0; this.oy=0; this._apply(); },
        };
        setTimeout(() => window.BracketZoom.init(), 60);
      })();
      <\/script>`;
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
          <span class="team-a ${wH?'winner-bold':''}\">${escHtml(hn)}</span>
          <span class="vs">vs</span>
          <span class="team-b ${wA?'winner-bold':''}\">${escHtml(an)}</span>
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
              <span class="team-a ${wH?'winner-bold':''}\">${escHtml(hn)}</span>
              <span class="vs">vs</span>
              <span class="team-b ${wA?'winner-bold':''}\">${escHtml(an)}</span>
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
