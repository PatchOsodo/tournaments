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
  // ═══════════════════════════════════════════════════════════════════════════
  // REPLACE the entire _buildMirroredBracket method with this block.
  // Everything from   _buildMirroredBracket(allFixtures) {
  //             to the closing  },
  // ═══════════════════════════════════════════════════════════════════════════

  _buildMirroredBracket(allFixtures) {

    // ── Filter and group fixtures ────────────────────────────────────────────
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
    const numSide        = nonFinalRounds.length;   // columns on each side of Final
    const totalCols      = numSide + 1 + numSide;
    const finalColIdx    = numSide;

    // ── Layout constants ─────────────────────────────────────────────────────
    const CARD_W        = 180;
    const CARD_H        = 72;
    const ROW_PAD       = 16;
    const COL_GAP       = 48;
    const LABEL_H       = 28;
    const MARGIN_X      = 20;
    const MARGIN_Y      = 20;
    const TROPHY_H      = 44;   // space reserved above Final for trophy
    const GAP_BELOW_FINAL = 72; // vertical gap from bottom of Final card to SF centre

    const baseSpacing = CARD_H + ROW_PAD;   // 88 — base slot height

    // X left-edge of column ci
    const colX = ci => MARGIN_X + ci * (CARD_W + COL_GAP);

    // ── Y positioning — shared-centre top-down tree ──────────────────────────
    //
    // Layout:
    //   Final sits at the top (just below trophy).
    //   All side rounds share a common vertical centre point (sfCentre) that
    //   sits GAP_BELOW_FINAL below the bottom of the Final card.
    //
    //   depth 0 = the round directly feeding the Final (SF for 8-team)
    //             → 1 card per side, centred on sfCentre
    //   depth 1 = the round feeding depth-0 (QF for 8-team)
    //             → 2 cards per side, spread symmetrically around sfCentre
    //   depth d → 2^d cards per side, slot = baseSpacing × 2^d
    //
    //   Card top-edge at (depth d, index i within that side):
    //     groupTop = sfCentre − (2^d / 2) × slot_d
    //     y        = groupTop + i × slot_d + slot_d/2 − CARD_H/2
    //
    //   This guarantees every parent is exactly centred between its two children.

    const startY    = MARGIN_Y + TROPHY_H + LABEL_H;   // below trophy and label row
    const finalY    = startY;                           // Final card top-edge
    const sfCentre  = finalY + CARD_H + GAP_BELOW_FINAL; // shared vertical axis

    const yCard = (depth, index) => {
      const count    = Math.pow(2, depth);
      const slotH    = baseSpacing * Math.pow(2, depth);
      const groupTop = sfCentre - (count / 2) * slotH;
      return groupTop + index * slotH + slotH / 2 - CARD_H / 2;
    };

    // Total SVG height: bottom of the deepest card (outermost round) + margin
    const maxDepth  = numSide - 1;   // ri=0 feeds Final directly, ri=numSide-1 is outermost
    // Outermost round: depth = numSide-1, has 2^(numSide-1) cards per side
    const outerCount = Math.pow(2, maxDepth);
    const bottomCardY = yCard(maxDepth, outerCount - 1) + CARD_H;
    const totalH    = Math.max(bottomCardY, finalY + CARD_H) + 40;
    const totalW    = MARGIN_X * 2 + totalCols * CARD_W + (totalCols - 1) * COL_GAP;

    // ── Helpers ───────────────────────────────────────────────────────────────
    const svg   = [];
    const green = '#1D9E75';
    const greenBg = '#E6F7F1';

    const rid    = v => (typeof v === 'object' ? v?.id : v) ?? null;
    const trunc  = (s, n = 19) => s.length > n ? s.slice(0, n - 1) + '…' : s;
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

      const border = done ? green : 'var(--border-light,#555)';
      const bw     = done ? 1.5 : 0.75;
      const op     = noTeams ? 0.35 : 1;
      const rowH   = (CARD_H - 1) / 2;
      const parts  = [];

      if (showLabel) {
        parts.push(
          `<text x="${x + CARD_W / 2}" y="${y - 8}"
            text-anchor="middle" font-size="9" font-weight="600"
            letter-spacing="0.08em" fill="var(--text-tertiary,#888)"
            font-family="inherit" style="text-transform:uppercase">
            ${escHtml(label)}
          </text>`
        );
      }

      parts.push(
        `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}"
          rx="8" fill="var(--bg-primary,#2a2a2a)"
          stroke="${border}" stroke-width="${bw}" opacity="${op}"/>`
      );

      // Home row
      if (wH) parts.push(
        `<rect x="${x+1}" y="${y+1}" width="${CARD_W-2}" height="${rowH-1}" rx="7" fill="${greenBg}"/>`
      );
      const hs = seedOf(hId);
      if (hs > 0) parts.push(
        `<text x="${x+11}" y="${y+rowH/2}" dominant-baseline="central"
          text-anchor="middle" font-size="9"
          fill="var(--text-tertiary,#888)" font-family="inherit">${hs}</text>`
      );
      parts.push(
        `<text x="${x+22}" y="${y+rowH/2}" dominant-baseline="central"
          font-size="12" font-weight="${wH ? '600' : '400'}"
          fill="${wH ? green : !hId ? 'var(--text-tertiary,#888)' : 'var(--text-primary,#eee)'}"
          font-family="inherit"
          style="${!hId ? 'font-style:italic' : ''}">${escHtml(trunc(hn))}</text>`
      );
      if (done) parts.push(
        `<text x="${x+CARD_W-8}" y="${y+rowH/2}" dominant-baseline="central"
          text-anchor="end" font-size="12" font-weight="700"
          fill="${wH ? green : 'var(--text-tertiary,#888)'}"
          font-family="inherit">${fixture.home_score ?? ''}</text>`
      );

      // Divider
      parts.push(
        `<line x1="${x+1}" y1="${y+rowH}" x2="${x+CARD_W-1}" y2="${y+rowH}"
          stroke="var(--border-light,#444)" stroke-width="0.5"/>`
      );

      // Away row
      const ay = y + rowH + 1;
      if (wA) parts.push(
        `<rect x="${x+1}" y="${ay}" width="${CARD_W-2}" height="${rowH}" rx="7" fill="${greenBg}"/>`
      );
      const as_ = seedOf(aId);
      if (as_ > 0) parts.push(
        `<text x="${x+11}" y="${ay+rowH/2}" dominant-baseline="central"
          text-anchor="middle" font-size="9"
          fill="var(--text-tertiary,#888)" font-family="inherit">${as_}</text>`
      );
      parts.push(
        `<text x="${x+22}" y="${ay+rowH/2}" dominant-baseline="central"
          font-size="12" font-weight="${wA ? '600' : '400'}"
          fill="${wA ? green : !aId ? 'var(--text-tertiary,#888)' : 'var(--text-primary,#eee)'}"
          font-family="inherit"
          style="${!aId ? 'font-style:italic' : ''}">${escHtml(trunc(an))}</text>`
      );
      if (done) parts.push(
        `<text x="${x+CARD_W-8}" y="${ay+rowH/2}" dominant-baseline="central"
          text-anchor="end" font-size="12" font-weight="700"
          fill="${wA ? green : 'var(--text-tertiary,#888)'}"
          font-family="inherit">${fixture.away_score ?? ''}</text>`
      );

      svg.push(parts.join(''));
    };

    // ── Connector: L-shaped elbow between two card midpoints ─────────────────
    const drawConn = (x1, y1, x2, y2) => {
      const midX = (x1 + x2) / 2;
      svg.push(
        `<path d="M${x1},${y1} H${midX} V${y2} H${x2}"
          fill="none" stroke="var(--border-mid,#555)"
          stroke-width="1" opacity="0.6"/>`
      );
    };

    // ── Trophy above Final ────────────────────────────────────────────────────
    const trophyX = colX(finalColIdx) + CARD_W / 2;
    const trophyY = startY - TROPHY_H + 4;
    svg.push(
      `<use href="#icon-trophy"
        x="${trophyX - 12}" y="${trophyY}"
        width="24" height="24"
        stroke="${green}" fill="none"/>`
    );

    // ── Final card ────────────────────────────────────────────────────────────
    const finalMatches = roundMap[finalRoundNum];
    finalMatches.forEach((m, mi) => {
      drawCard(colX(finalColIdx), finalY + mi * (CARD_H + ROW_PAD), m, 'Final', mi === 0);
    });

    // ── Left side: top half of each non-final round ───────────────────────────
    // ri=0 is the round directly feeding the Final (innermost, depth=0)
    // ri=numSide-1 is the outermost round (depth=numSide-1)
    nonFinalRounds.forEach((roundNum, ri) => {
      const depth   = ri;               // 0 = innermost (SF), increases outward
      const colIdx  = numSide - 1 - ri; // innermost is closest to Final col
      const x       = colX(colIdx);
      const allM    = roundMap[roundNum];
      const half    = Math.ceil(allM.length / 2);
      const topHalf = allM.slice(0, half);
      const label   = allM[0]?.round_label || `Round ${roundNum}`;

      topHalf.forEach((m, mi) => {
        const y = yCard(depth, mi);
        drawCard(x, y, m, label, mi === 0);

        // Connector to parent (next column toward Final)
        const parentColIdx = colIdx + 1;
        const parentX      = colX(parentColIdx);
        let   parentY;

        if (ri === 0) {
          // Direct feed to Final
          parentY = finalY + CARD_H / 2;
        } else {
          // Parent is the previous ri (depth-1), index floor(mi/2)
          parentY = yCard(depth - 1, Math.floor(mi / 2)) + CARD_H / 2;
        }

        drawConn(x + CARD_W, y + CARD_H / 2, parentX, parentY);
      });
    });

    // ── Right side: bottom half, mirrored ─────────────────────────────────────
    nonFinalRounds.forEach((roundNum, ri) => {
      const depth   = ri;
      const colIdx  = finalColIdx + 1 + ri;   // innermost is adjacent to Final
      const x       = colX(colIdx);
      const allM    = roundMap[roundNum];
      const half    = Math.ceil(allM.length / 2);
      const botHalf = allM.slice(half);
      const label   = allM[0]?.round_label || `Round ${roundNum}`;

      botHalf.forEach((m, mi) => {
        const y = yCard(depth, mi);
        drawCard(x, y, m, label, mi === 0);

        // Connector goes LEFT toward Final
        const parentColIdx = colIdx - 1;
        const parentRightX = colX(parentColIdx) + CARD_W;
        let   parentY;

        if (ri === 0) {
          parentY = finalY + CARD_H / 2;
        } else {
          parentY = yCard(depth - 1, Math.floor(mi / 2)) + CARD_H / 2;
        }

        drawConn(x, y + CARD_H / 2, parentRightX, parentY);
      });
    });

    // ── Wrap in zoomable container ────────────────────────────────────────────
    return `
      <style>
        .bc-zoom-wrap {
          position      : relative;
          width         : 100%;
          overflow      : hidden;
          background    : var(--bg-secondary, #1e1e1e);
          border-radius : var(--radius-lg, 10px);
          border        : 0.5px solid var(--border-light, #333);
          touch-action  : pan-x pan-y pinch-zoom;
          user-select   : none;
          cursor        : grab;
        }
        .bc-zoom-wrap:active { cursor: grabbing; }
        .bc-zoom-controls {
          position  : absolute;
          top       : 8px;
          right     : 10px;
          display   : flex;
          gap       : 4px;
          z-index   : 10;
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
      </style>

      <div class="bc-zoom-wrap" id="bc-wrap"
           style="height:${Math.min(totalH, 560)}px; min-height:260px;">
        <div class="bc-zoom-controls">
          <button class="bc-zoom-btn" onclick="BracketZoom.zoomIn()"  title="Zoom in">+</button>
          <button class="bc-zoom-btn" onclick="BracketZoom.zoomOut()" title="Zoom out">−</button>
          <button class="bc-zoom-btn" onclick="BracketZoom.reset()"   title="Fit"
                  style="font-size:11px;">⤢</button>
        </div>

        <div class="bc-inner" id="bc-inner">
          <svg width="${totalW}" height="${totalH}"
               viewBox="0 0 ${totalW} ${totalH}"
               xmlns="http://www.w3.org/2000/svg">
            ${svg.join('\n')}
          </svg>
        </div>

        <div class="bc-zoom-hint">Scroll or pinch to zoom · Drag to pan</div>
      </div>

      <script>
      (function() {
        if (window.BracketZoom && window.BracketZoom._active) return;
        window.BracketZoom = {
          _active  : true,
          scale    : 1,
          minScale : 0.2,
          maxScale : 3,
          ox: 0, oy: 0,
          _drag: false, _lx: 0, _ly: 0, _pinchD: null,
          wrap: null, inner: null,

          init() {
            this.wrap  = document.getElementById('bc-wrap');
            this.inner = document.getElementById('bc-inner');
            if (!this.wrap || !this.inner) return;

            // Fit to container on load
            this.scale = this.wrap.clientWidth / ${totalW};
            this.ox = 0; this.oy = 0;
            this._apply();

            // Resize → re-fit
            window.addEventListener('resize', () => {
              this.scale = this.wrap.clientWidth / ${totalW};
              this.ox = 0; this.oy = 0;
              this._apply();
            });

            // Mouse wheel
            this.wrap.addEventListener('wheel', e => {
              e.preventDefault();
              const r = this.wrap.getBoundingClientRect();
              this._zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 0.85 : 1.18);
            }, { passive: false });

            // Mouse drag
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

            // Touch
            this.wrap.addEventListener('touchstart', e => {
              if (e.touches.length === 2) {
                this._pinchD = this._dist(e.touches);
              } else {
                this._lx = e.touches[0].clientX;
                this._ly = e.touches[0].clientY;
              }
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
            const dx = t[0].clientX - t[1].clientX;
            const dy = t[0].clientY - t[1].clientY;
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
      </script>`;
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
