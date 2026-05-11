/**
 * =============================================================================
 * BASKETBALL TOURNAMENT MANAGER — bracket.js  v6.0.0
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
 *
 * CHANGES IN v6.0.0
 * ──────────────────
 * VISUAL OVERHAUL — Bracket Layout, Cards & Connectors
 *
 * Layout
 * • Switched from mirrored left↔right (UCL-style) to top-down cascade:
 *     - Finals at the top, rounds fan downward (QFs → Semis → Final)
 *     - Cards evenly distributed horizontally per round using actual match
 *       counts (fixes asymmetry bug where xCardLeft used cardsAt() instead
 *       of real roundMap lengths)
 * • Added _buildHorizontalBracket(): classic left-to-right elimination tree
 *     - Left column = earliest round, rightmost column = Final
 *     - Straight L-shaped connectors (child right-edge → midpoint → parent left-edge)
 * • New toggleOrientation() method — switches between vertical and horizontal
 *     - Default: horizontal on mobile (≤768 px), vertical on desktop
 *     - Orientation re-evaluated on every init() call
 *     - #btn-orientation button wired in bracket.html; hidden on desktop via CSS
 *
 * Cards
 * • Each team row redesigned — horizontal layout: badge | name | score
 *     - Badge is now a rounded square (22×22 px, rx=5) replacing the circle
 *     - Team initials always shown in badge (seed number toggle removed)
 *     - Winner badge fills with accent green (#1D9E75); others use muted team colour
 *     - Winner row gets a subtle green tint (fill-opacity 0.10)
 *     - Winner score rendered in accent green, loser score in dim tertiary
 *     - Unplayed slots render as dashed-border empty squares with a '?' glyph
 *       (dark mode: dim border; light mode: inherits via CSS variable)
 *     - Card background distinguishes played vs unplayed via fill colour
 *
 * Badges
 * • badgeColor() palette replaced with muted dark tones (40 % brightness)
 *   — previous palette was too saturated / visually noisy
 * • bc-seed-num elements removed; bc-badge opacity hardcoded to 1 (always on)
 * • Badges button in bracket.html retained but now a no-op visual toggle
 *
 * Connectors
 * • Cubic Bézier S-curves replaced with straight L-shaped polylines:
 *     - Vertical bracket: child top-centre → midpoint → parent bottom-centre
 *     - Horizontal bracket: child right-centre → midpoint → parent left-centre
 *     - stroke="#1D9E75", stroke-opacity=0.4, stroke-linecap="square"
 * • Removed conn-grad-l, conn-grad-r, conn-grad-v gradient defs (no longer used)
 *
 * Champion Box
 * • _renderChampion() now ignores tournament.status — shows only when the
 *   final fixture record itself has status === 'completed' and winner is set
 * • Champion badge added: rounded square with team initials and accent border
 * • styles.css: champion-appear animation gated behind .is-visible class to
 *   prevent the box flashing before JS hides it on page load
 * • bracket.html: champion-box initialised with display:none in markup
 *
 * Bug Fixes
 * • CP_OFFSET free-variable crash (v5.0.x): moved inside drawConnLeft /
 *   drawConnRight as a local const computed from actual x1/x2 arguments
 * • Duplicate card background block causing "missing } after property list"
 *   syntax error: stray closing brace and duplicate svg.push removed
 * • Missing closing }); for sideRounds.forEach outer loop causing
 *   "missing ) after argument list" syntax error: added correct closure
 * =============================================================================
 * 
 */
 

const CONFIG = {
  API_BASE_URL : window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8090'
    : window.location.origin,
  VERSION : '6.0.1',
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

window.GsTabs = {
      show(name, btn) {
        document.querySelectorAll('.gs-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.gs-tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('gs-panel-' + name)?.classList.add('active');
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
    '#2E7D5E','#6B3A3A','#3A5A8C','#7A6020',
    '#5B3A7A','#7A4A1E','#1E6B6B','#6B3A50',
    '#3A5A3A','#6B5A2E',
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
    const box = document.getElementById('champion-box');
    if (box) { box.style.display = 'none'; box.style.animation = 'none'; box.classList.remove('is-visible'); }
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
      BracketPage._bracketOrientation = window.innerWidth <= 768 ? 'horizontal' : 'vertical';
      const orientBtn = document.getElementById('btn-orientation');
      if (orientBtn) orientBtn.classList.toggle('active', BracketPage._bracketOrientation === 'horizontal');
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
  _bracketOrientation: window.innerWidth <= 768 ? 'horizontal' : 'vertical',

  toggleOrientation() {
    BracketPage._bracketOrientation =
      BracketPage._bracketOrientation === 'vertical' ? 'horizontal' : 'vertical';
    BracketPage._renderBracket();
    const btn = document.getElementById('btn-orientation');
    if (btn) btn.classList.toggle('active');
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
    
    if (BracketPage._bracketOrientation === 'horizontal') {
      return BracketPage._buildHorizontalBracket(allFixtures, roundMap, roundNums);
    }

    const finalRoundNum  = roundNums[roundNums.length - 1];
    const nonFinalRounds = roundNums.slice(0, -1);  // sorted earliest→latest
    const numSide        = nonFinalRounds.length;   // columns on each side
    const sideRoundsRef  = [...nonFinalRounds].reverse(); // innermost first, index matches rowIdx-1

    /* ── 1. Layout constants ───────────────────────────────────────────────── *
    const TEAM_H   = 28;   // height of one team row
    const CARD_H   = TEAM_H * 2 + 1;  // two team rows + 1px divider
    const CARD_W   = 160;  // wider — horizontal layout: seed | name | score
    const ROW_PAD  = 12;   // vertical gap between sibling cards in same round
    const COL_GAP  = 48;   // vertical gap between rounds (top-down)
    const LABEL_H  = 20;
    const MARGIN_X = 24;
    const MARGIN_Y = 16;
    const TROPHY_H = 44;
    const BADGE_R  = 9;    // small pill badge — left side of row*/
    
    /* ── 1. Layout constants ───────────────────────────────────────────────── */
    const TEAM_H   = 28;
    const CARD_H   = TEAM_H * 2 + 1;
    const CARD_W   = 170;
    const ROW_PAD  = 20;   // more breathing room between siblings
    const COL_GAP  = 64;   // taller gap between rounds
    const LABEL_H  = 20;
    const MARGIN_X = 32;
    const MARGIN_Y = 16;
    const TROPHY_H = 44;
    const BADGE_R  = 9;

    /* TOP-DOWN CASCADE: round 0 = Finals (top), deeper rounds fan down
       numSide = number of rounds below the Final
       depth 0 = innermost side round (Semis), depth numSide-1 = outermost (R1)
    */

    /* Cards per column at each depth */
    const cardsAt  = d => Math.pow(2, d + 1);  // depth 0 → 2 cards, depth 1 → 4, etc.

    /* Horizontal span of each round column */
    const outerRoundKey = nonFinalRounds[0]; // earliest = most cards
    const outerCards    = roundMap[outerRoundKey]?.length ?? Math.pow(2, numSide);
    const outerSpan     = outerCards * CARD_W + (outerCards - 1) * ROW_PAD;
    const totalW        = Math.max(outerSpan + MARGIN_X * 2, CARD_W * 3 + ROW_PAD * 2 + MARGIN_X * 2);

    /* Y positions: Final at top, each successive round shifted down by CARD_H + COL_GAP */
    const rowY = ri => MARGIN_Y + TROPHY_H + LABEL_H + ri * (CARD_H + COL_GAP);

    /* Final is row 0, side rounds are rows 1..numSide */
    const finalY  = rowY(0);
    const trophyY = MARGIN_Y;
    const totalH  = rowY(numSide) + CARD_H + MARGIN_Y;

    /* X centre of card at (roundIndex ri, cardIndex ci) — evenly spaced horizontally */
    const xCardLeft = (ri, ci) => {
      // ri=0 → Final (1 card), ri=1 → sideRoundsRef[0] (Semis), ri=2 → sideRoundsRef[1] (QFs)…
      let count;
      if (ri === 0) {
        count = 1;
      } else {
        const roundKey = sideRoundsRef[ri - 1];
        count = roundMap[roundKey]?.length ?? Math.pow(2, ri);
      }
      const span   = count * CARD_W + (count - 1) * ROW_PAD;
      const startX = MARGIN_X + (totalW - MARGIN_X * 2 - span) / 2;
      return startX + ci * (CARD_W + ROW_PAD);
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

    /* ── 3. Draw a single team row (horizontal: badge | name | score) ──────── */
    const drawSlot = (x, slotY, name, teamId, isWinner, score, isDone) => {
      const isTBD  = !teamId;
      const bgCol  = isTBD ? 'transparent' : badgeColor(name);
      const parts  = [];

      /* ── winner row tint ── */
      if (isWinner) {
        parts.push(
          `<rect x="${x+1}" y="${slotY}" width="${CARD_W-2}" height="${TEAM_H}"
            fill="${green}" fill-opacity="0.10"/>`
        );
      }

      /* ── badge: rounded square, 22×22, left-padded 5px ── */
      const BW = 22; const BH = 22;
      const bx = x + 5;
      const by = slotY + (TEAM_H - BH) / 2;

      if (isTBD) {
        /* unplayed: dim dashed border square, no fill */
        parts.push(
          `<rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="5"
            fill="none"
            stroke="var(--text-tertiary,#555)" stroke-width="1"
            stroke-dasharray="3 2" opacity="0.5"/>`
        );
        parts.push(
          `<text x="${bx + BW/2}" y="${by + BH/2}" dominant-baseline="central"
            text-anchor="middle" font-size="9" font-weight="400"
            fill="var(--text-tertiary,#666)" font-family="inherit">?</text>`
        );
      } else {
        const badgeFill   = isWinner ? green : bgCol;
        const badgeStroke = isWinner ? green : 'none';
        parts.push(
          `<rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="5"
            fill="${badgeFill}" fill-opacity="${isWinner ? 1 : 0.82}"
            stroke="${badgeStroke}" stroke-width="${isWinner ? 1.5 : 0}"/>`
        );
        /* seed number — hidden when badges active */
        parts.push(
          `<text x="${bx + BW/2}" y="${by + BH/2}" dominant-baseline="central"
            text-anchor="middle" font-size="9" font-weight="600"
            fill="#fff" font-family="inherit"
            class="bc-seed-num">${escHtml(teamInitials(name)) || '?'}</text>`
        );
        /* initials — shown when badges active */
        parts.push(
          `<text x="${bx + BW/2}" y="${by + BH/2}" dominant-baseline="central"
            text-anchor="middle" font-size="9" font-weight="700"
            fill="#fff" font-family="inherit"
            class="bc-badge">${escHtml(teamInitials(name))}</text>`
        );
      }

      /* ── team name ── */
      const nameX = x + 5 + BW + 6;  // badge left + badge width + gap
      const nameFill = isTBD
        ? 'var(--text-tertiary,#555)'
        : isWinner
          ? 'var(--text-primary,#fff)'
          : 'var(--text-secondary,#bbb)';
      parts.push(
        `<text x="${nameX}" y="${slotY + TEAM_H/2}" dominant-baseline="central"
          font-size="10" font-weight="${isWinner ? '600' : '400'}"
          font-style="${isTBD ? 'italic' : 'normal'}"
          fill="${nameFill}" font-family="inherit"
          >${escHtml(isTBD ? 'TBD' : trunc(name, 11))}</text>`
      );

      /* ── score — right-aligned, winner accented ── */
      if (isDone && score !== null && score !== undefined) {
        parts.push(
          `<text x="${x + CARD_W - 7}" y="${slotY + TEAM_H/2}" dominant-baseline="central"
            text-anchor="end" font-size="11" font-weight="800"
            fill="${isWinner ? green : 'var(--text-tertiary,#666)'}"
            font-family="inherit">${score}</text>`
        );
      }

      svg.push(parts.join(''));
    };

    /* ── 4. Draw a match card (two horizontal team rows) ───────────────────── */
    const drawCard = (x, y, fixture, label, showLabel) => {
      const hn    = fixture.expand?.home_team?.name || 'TBD';
      const an    = fixture.expand?.away_team?.name || 'TBD';
      const done  = fixture.status === 'completed';
      const hId   = rid(fixture.home_team);
      const aId   = rid(fixture.away_team);
      const wId   = rid(fixture.winner);
      const wH    = done && wId && wId === hId;
      const wA    = done && wId && wId === aId;
      const noTeams = !hId && !aId;
      const border  = done  ? green
                    : (hId || aId) ? 'var(--border-light,#3a3a3a)'
                    : 'var(--border-light,#2a2a2a)';
      const bw      = done ? 1.5 : 0.75;

      /* card background */
      svg.push(
        `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"
          rx="6"
          fill="${done ? 'var(--bg-secondary,#1e1e1e)' : 'var(--bg-primary,#161616)'}"
          stroke="${border}" stroke-width="${bw}"
          opacity="${noTeams ? 0.22 : 1}"/>`
      );
      /* divider */
      svg.push(
        `<line x1="${x + 1}" y1="${y + TEAM_H}" x2="${x + CARD_W - 1}" y2="${y + TEAM_H}"
          stroke="var(--border-light,#2e2e2e)" stroke-width="0.75"/>`
      );

      /* team rows */
      drawSlot(x, y,          hn, hId, wH, fixture.home_score, done);
      drawSlot(x, y + TEAM_H, an, aId, wA, fixture.away_score, done);
    };

  /* ── 5. Straight L-shaped connectors ────────────────────────────────────
       Vertical layout: child top-centre → vertical up → horizontal → parent bottom-centre
    ─────────────────────────────────────────────────────────────────────────── */
    const drawConn = (childMidX, childTopY, parentMidX, parentBotY) => {
      const midY = parentBotY + (childTopY - parentBotY) / 2;  // halfway between
      svg.push(
        `<path d="M${childMidX},${childTopY} L${childMidX},${midY} L${parentMidX},${midY} L${parentMidX},${parentBotY}"
          fill="none" stroke="#1D9E75" stroke-width="1.25"
          stroke-opacity="0.45" stroke-linecap="square"/>`
      );
    };
   /* ── 6. Trophy ──────────────────────────────────────────────────────────── */
    const trophyX = totalW / 2;
    svg.push(
      `<text x="${trophyX}" y="${trophyY + TROPHY_H - 4}"
        text-anchor="middle" font-size="26" font-family="inherit">🏆</text>`
    );

    /* ── 7. Final card (row 0, centred) ─────────────────────────────────────── */
    const finalMatches = roundMap[finalRoundNum];
    finalMatches.forEach((m, mi) => {
      const x = xCardLeft(0, mi);
      drawCard(x, finalY, m, 'Final', mi === 0);
    });

    /* ── 8. Side rounds — rows 1..numSide, left half then right half ─────────
       nonFinalRounds[0] = earliest round (most cards), [...last] = innermost (fewest).
       We reverse so ri=0 is the innermost (Semis, row 1) and ri=numSide-1 is outermost.
    ─────────────────────────────────────────────────────────────────────────── */
    const sideRounds = [...nonFinalRounds].reverse(); // innermost first

    sideRounds.forEach((roundNum, ri) => {
      const rowIdx  = ri + 1;   // row 1 = Semis, row 2 = QFs, …
      const allM    = roundMap[roundNum];
      const label   = allM[0]?.round_label || `Round ${roundNum}`;
      const count   = allM.length;

      allM.forEach((m, mi) => {
        const x = xCardLeft(rowIdx, mi);
        const y = rowY(rowIdx);
        drawCard(x, y, m, label, mi === 0);

        /* ── connector: bottom-centre of child card → top-centre of parent card ── */
        const childMidX  = x + CARD_W / 2;
        const childTopY  = y;                         // top of child card

        /* parent index: two adjacent children share one parent */
        const parentIdx  = Math.floor(mi / 2);
        const parentRowIdx = rowIdx - 1;
        const parentX    = xCardLeft(parentRowIdx, parentIdx);
        const parentBotY = rowY(parentRowIdx) + CARD_H; // bottom of parent card

        const parentMidX = parentX + CARD_W / 2;

        /* straight L: child top-centre → up to midpoint → across → parent bottom-centre */
        const midY = parentBotY + (childTopY - parentBotY) / 2;
        svg.push(
          `<path d="M${childMidX},${childTopY} L${childMidX},${midY} L${parentMidX},${midY} L${parentMidX},${parentBotY}"
            fill="none" stroke="#1D9E75" stroke-width="1.2"
            stroke-opacity="0.4" stroke-linecap="square"/>`
                );
      });  
    });  

    /* ── 9. SVG string ───────────────────────────────────────────────────────── */
    const svgDefs = `<defs></defs>`;

    return `
      <div id="bc-wrap" style="overflow-x:auto;overflow-y:auto;padding:12px 8px;">
        <svg width="${totalW}" height="${totalH}"
             viewBox="0 0 ${totalW} ${totalH}"
             xmlns="http://www.w3.org/2000/svg" id="bc-svg"
             style="display:block;margin:0 auto;">
          ${svgDefs}
          <style>
            .bc-seed-num { opacity: 1; transition: opacity .15s; }
            .bc-badge    { opacity: 0; transition: opacity .15s; }
            #bc-wrap.show-badges .bc-seed-num { opacity: 0; }
            #bc-wrap.show-badges .bc-badge    { opacity: 1; }
          </style>
          ${svg.join('\n')}
        </svg>
      </div>`;
  },

/* ═══════════════════════════════════════════════════════════════════════════
     HORIZONTAL BRACKET — classic left-to-right elimination tree
     Left column = earliest round, rightmost = Final
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildHorizontalBracket(allFixtures, roundMap, roundNums) {
    const TEAM_H  = 28;
    const CARD_H  = TEAM_H * 2 + 1;
    const CARD_W  = 170;
    const COL_GAP = 56;
    const ROW_PAD = 16;
    const MARGIN_X = 32;
    const MARGIN_Y = 24;
    const BADGE_R  = 9;
    const LABEL_H  = 18;

    const green = '#1D9E75';
    const rid   = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const trunc = (s, n = 14) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s || '');
    const seedOf = id => id ? BracketPage.teams.findIndex(t => rid(t.id) === id) + 1 : 0;

    const numRounds   = roundNums.length;
    const firstRound  = roundNums[0];
    const maxCards    = roundMap[firstRound].length;

    const totalH = MARGIN_Y * 2 + maxCards * CARD_H + (maxCards - 1) * ROW_PAD + LABEL_H;
    const totalW = MARGIN_X * 2 + numRounds * CARD_W + (numRounds - 1) * COL_GAP;

    /* X left edge of column ci */
    const colX = ci => MARGIN_X + ci * (CARD_W + COL_GAP);

    /* Y top of card at (colIdx, cardIdx) — evenly spaced, centred in their slot */
    const yCardTop = (ci, idx) => {
      const count  = roundMap[roundNums[ci]].length;
      const slotH  = (totalH - MARGIN_Y * 2 - LABEL_H) / count;
      return MARGIN_Y + LABEL_H + idx * slotH + (slotH - CARD_H) / 2;
    };

    const svg = [];

    const drawSlotH = (x, y, name, teamId, isWinner, score, isDone) => {
      const isTBD  = !teamId;
      const bgCol  = badgeColor(name);
      const badgeCX = x + 14;
      const badgeCY = y + TEAM_H / 2;
      const parts  = [];

      if (isWinner) parts.push(
        `<rect x="${x+1}" y="${y}" width="${CARD_W-2}" height="${TEAM_H}"
          fill="${green}" fill-opacity="0.08"/>`
      );
      parts.push(
        `<circle cx="${badgeCX}" cy="${badgeCY}" r="${BADGE_R}"
          fill="${isTBD ? 'var(--bg-secondary,#2a2a2a)' : bgCol}"
          stroke="${isWinner ? green : 'none'}" stroke-width="1"
          opacity="${isTBD ? 0.35 : 0.85}"/>`
      );
      parts.push(
        `<text x="${badgeCX}" y="${badgeCY}" dominant-baseline="central"
          text-anchor="middle" font-size="8" font-weight="700"
          fill="#fff" font-family="inherit"
          >${escHtml(isTBD ? '?' : teamInitials(name))}</text>`
      );
      parts.push(
        `<text x="${x + 28}" y="${badgeCY}" dominant-baseline="central"
          font-size="10" font-weight="${isWinner ? '700' : '400'}"
          fill="${isTBD ? 'var(--text-tertiary,#555)' : isWinner ? '#fff' : 'var(--text-secondary,#bbb)'}"
          font-family="inherit">${escHtml(trunc(name))}</text>`
      );
      if (isDone && score !== null && score !== undefined) {
        parts.push(
          `<text x="${x + CARD_W - 8}" y="${badgeCY}" dominant-baseline="central"
            text-anchor="end" font-size="11" font-weight="800"
            fill="${isWinner ? green : 'var(--text-tertiary,#666)'}"
            font-family="inherit">${score}</text>`
        );
      }
      svg.push(parts.join(''));
    };

    roundNums.forEach((roundNum, ci) => {
      const matches = roundMap[roundNum];
      const label   = matches[0]?.round_label || `Round ${roundNum}`;
      const x       = colX(ci);

      /* column label */
      svg.push(
        `<text x="${x + CARD_W / 2}" y="${MARGIN_Y + LABEL_H - 4}"
          text-anchor="middle" font-size="8" font-weight="700"
          letter-spacing="0.10em" fill="var(--text-tertiary,#666)"
          font-family="inherit" style="text-transform:uppercase">${escHtml(label)}</text>`
      );

      matches.forEach((m, mi) => {
        const y      = yCardTop(ci, mi);
        const hId    = rid(m.home_team);
        const aId    = rid(m.away_team);
        const wId    = rid(m.winner);
        const done   = m.status === 'completed';
        const wH     = done && wId === hId;
        const wA     = done && wId === aId;
        const border = done ? green : 'var(--border-light,#3a3a3a)';

        svg.push(
          `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"
            rx="6" fill="var(--bg-secondary,#1e1e1e)"
            stroke="${border}" stroke-width="${done ? 1.5 : 0.75}"
            opacity="${!hId && !aId ? 0.25 : 1}"/>`
        );
        svg.push(
          `<line x1="${x+1}" y1="${y+TEAM_H}" x2="${x+CARD_W-1}" y2="${y+TEAM_H}"
            stroke="var(--border-light,#2e2e2e)" stroke-width="0.75"/>`
        );
        drawSlotH(x, y,        m.expand?.home_team?.name || 'TBD', hId, wH, m.home_score, done);
        drawSlotH(x, y+TEAM_H, m.expand?.away_team?.name || 'TBD', aId, wA, m.away_score, done);

        /* connector to next round */
        if (ci < numRounds - 1) {
          const childMidY  = y + CARD_H / 2;
          const childRightX = x + CARD_W;
          const parentCi   = ci + 1;
          const parentMi   = Math.floor(mi / 2);
          const parentY    = yCardTop(parentCi, parentMi);
          const parentMidY = parentY + CARD_H / 2;
          const parentLeftX = colX(parentCi);
          const midX = childRightX + (parentLeftX - childRightX) / 2;

          svg.push(
            `<path d="M${childRightX},${childMidY} L${midX},${childMidY} L${midX},${parentMidY} L${parentLeftX},${parentMidY}"
              fill="none" stroke="#1D9E75" stroke-width="1.25"
              stroke-opacity="0.45" stroke-linecap="square"/>`
          );
        }
      });
    });

    return `
      <div id="bc-wrap" style="overflow-x:auto;padding:12px 8px;">
        <svg width="${totalW}" height="${totalH}"
             viewBox="0 0 ${totalW} ${totalH}"
             xmlns="http://www.w3.org/2000/svg"
             style="display:block;margin:0 auto;">
          <style>
            .bc-badge { opacity:1; } .bc-seed-num { display:none; }
          </style>
          ${svg.join('\n')}
        </svg>
      </div>`;
  },

/* ═══════════════════════════════════════════════════════════════════════════
     SCHEDULE LIST — round-by-round match cards (used for group KO bracket tab)
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildScheduleList(fixtures) {
    const rounds = {};
    fixtures.filter(f => !f.is_bye).forEach(f => {
      const key = f.round_label || `Round ${f.round}`;
      if (!rounds[key]) rounds[key] = [];
      rounds[key].push(f);
    });

    if (!Object.keys(rounds).length) {
      return '<div class="no-bracket" style="padding:1rem 0;">No matches yet.</div>';
    }

    return Object.entries(rounds).map(([label, matches]) => {
      const cards = matches.map((m, i) => {
        const hn   = m.expand?.home_team?.name || 'TBD';
        const an   = m.expand?.away_team?.name || 'TBD';
        const done = m.status === 'completed';
        const wH   = done && m.winner === m.home_team;
        const wA   = done && m.winner === m.away_team;
        return `<div class="match-card ${done ? 'completed' : ''}">
          <span class="match-num">M${i + 1}</span>
          <span class="team-a ${wH ? 'winner-bold' : ''}">${escHtml(hn)}</span>
          <span class="vs">vs</span>
          <span class="team-b ${wA ? 'winner-bold' : ''}">${escHtml(an)}</span>
          ${done ? `<span class="match-score">${m.home_score} – ${m.away_score}</span>` : ''}
        </div>`;
      }).join('');
      return `<div class="round-section">
        <div class="round-label">${escHtml(label)}</div>
        ${cards}
      </div>`;
    }).join('');
  },


  /* ═══════════════════════════════════════════════════════════════════════════
     GROUP STAGE
   ═══════════════════════════════════════════════════════════════════════════ */
  _buildGroupStageBracket(allFixtures) {
    const groupFx    = allFixtures.filter(f => !f.is_bye && f.group_name);
    const knockoutFx = allFixtures.filter(f => !f.is_bye && !f.group_name);

    // ── Group stage HTML (match cards) ────────────────────────────────────
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
      return `<div class="round-section">
        <div class="round-label">${escHtml(name)}</div>${rows}
      </div>`;
    }).join('');

    // ── Knockout bracket — SVG on desktop, schedule list on mobile ────────
    const koHtml = knockoutFx.length
      ? `<div class="ko-bracket-desktop">${BracketPage._buildMirroredBracket(knockoutFx)}</div>
         <div class="ko-bracket-mobile">${BracketPage._buildScheduleList(knockoutFx)}</div>`
      : `<div class="no-bracket" style="padding:1rem 0;">
           Knockout stage not yet generated.
         </div>`;

    // ── Tab wrapper — Groups tab + Bracket tab ────────────────────────────
    return `
      <style>
        .ko-bracket-desktop { display: block; }
        .ko-bracket-mobile  { display: none;  }
        .gs-tab-bar {
          display         : flex;
          border-bottom   : 0.5px solid var(--border-light, #333);
          background      : var(--bg-secondary, #1e1e1e);
          margin-bottom   : 1rem;
        }
        .gs-tab-btn {
          flex            : 1;
          padding         : 10px 0;
          font-size       : 11px;
          font-weight     : 700;
          text-transform  : uppercase;
          letter-spacing  : 0.08em;
          color           : var(--text-tertiary, #888);
          background      : transparent;
          border          : none;
          cursor          : pointer;
          font-family     : inherit;
          position        : relative;
          transition      : color 0.2s;
          -webkit-tap-highlight-color: transparent;
        }
        .gs-tab-btn::after {
          content          : '';
          position         : absolute;
          bottom           : 0;
          left             : 20%;
          width            : 60%;
          height           : 2px;
          border-radius    : 2px 2px 0 0;
          background       : #1D9E75;
          transform        : scaleX(0);
          transform-origin : center;
          transition       : transform 0.25s cubic-bezier(0.4,0,0.2,1);
        }
        .gs-tab-btn.active        { color: #1D9E75; }
        .gs-tab-btn.active::after { transform: scaleX(1); }
        .gs-panel                 { display: none; }
        .gs-panel.active          { display: block; }
      </style>

      <div class="gs-tab-bar">
        <button class="gs-tab-btn active"
                onclick="GsTabs.show('groups',this)">
          ⊞ Groups
        </button>
        <button class="gs-tab-btn"
                onclick="GsTabs.show('bracket',this)">
          🏆 Bracket
        </button>
      </div>

      <div class="gs-panel active" id="gs-panel-groups">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">
          ${groupHtml}
        </div>
      </div>

      <div class="gs-panel" id="gs-panel-bracket">
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
    const box = document.getElementById('champion-box');
    if (!box) return;

    // Always hide + kill animation first
    box.style.display   = 'none';
    box.style.animation = 'none';
    box.classList.remove('is-visible');

    const realFx = BracketPage.fixtures.filter(f => !f.is_bye);
    if (!realFx.length) return;

    const maxRound = Math.max(...realFx.map(f => f.round));
    const final    = realFx.find(f => f.round === maxRound);
    if (!final || final.status !== 'completed') return;

    const rid    = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const wId    = rid(final.winner);
    if (!wId) return;

    const winner = final.expand?.winner?.name
      || BracketPage.teams.find(t => rid(t.id) === wId)?.name
      || 'Unknown';

    box.innerHTML = `
      <div class="trophy">🏆</div>
      <h2>Tournament Champion</h2>
      <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-top:6px;">
        <span style="
          display:inline-flex;align-items:center;justify-content:center;
          width:36px;height:36px;border-radius:8px;
          background:${badgeColor(winner)};color:#fff;font-weight:700;font-size:14px;
          border:2px solid #1D9E75;flex-shrink:0;">
          ${escHtml(teamInitials(winner))}
        </span>
        <div class="champion-name">${escHtml(winner)}</div>
      </div>`;

    // Re-enable animation only at the moment of intentional show
    box.style.animation = '';
    box.style.display   = 'block';
    // Trigger reflow so the animation restarts cleanly from frame 0
    void box.offsetHeight;
    box.classList.add('is-visible');
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
