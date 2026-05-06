/**
 * =============================================================================
 * generators.js — Fixture generation algorithms (pure functions, no DB calls)
 *
 * Depends on: config.js (escHtml), logger.js
 * =============================================================================
 */

/* =============================================================================
   ROUND ROBIN — circle rotation method
   Every team plays every other team once.
   Odd team counts get a synthetic BYE to keep pairs even.
   ============================================================================= */
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

/* =============================================================================
   SINGLE ELIMINATION — fixed-slot seed tree
   Pads to next power of 2. BYE slots auto-advance to round 2 on persist.
   ============================================================================= */
function genElimination(teams) {
  Logger.debug('genElimination', { count: teams.length });

  let size = 1;
  while (size < teams.length) size *= 2;
  const byes = size - teams.length;

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
      a, b, isBye,
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
        a: 'TBD', b: 'TBD', isBye: false,
        nextRound       : r < totalRounds ? r + 1 : null,
        nextMatchNumber : r < totalRounds ? Math.ceil(m / 2) : null,
        nextSlot        : m % 2 === 1 ? 'home' : 'away',
      });
    }
    allRounds.push({ roundNumber: r, label: _roundLabel(matchCount, totalRounds, r), matches });
  }

  const totalMatches = round1Matches.filter(m => !m.isBye).length +
    allRounds.slice(1).reduce((s, r) => s + r.matches.length, 0);

  Logger.info('genElimination done', {
    size, byes,
    rounds      : allRounds.length,
    totalMatches,
    roundSummary: allRounds.map(r => `${r.label}: ${r.matches.length} matches`),
  });

  return { type: 'elimination', rounds: allRounds, totalMatches };
}

/**
 * Derive display label for a bracket round.
 */
function _roundLabel(matchCount, totalRounds, roundNumber) {
  const fromEnd = totalRounds - roundNumber + 1;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semifinals';
  if (fromEnd === 3) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

/* =============================================================================
   GROUP STAGE — snake distribution + round robin per group + elimination KO
   ============================================================================= */
function genGroupStage(teams) {
  Logger.debug('genGroupStage', { count: teams.length });
  const numGroups = teams.length <= 8 ? 2 : teams.length <= 12 ? 3 : 4;
  const groups    = Array.from({ length: numGroups }, () => []);
  teams.forEach((t, i) => groups[i % numGroups].push(t));

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

/* =============================================================================
   LIVE GROUP STANDINGS COMPUTATION
   Derives team IDs from fixture records directly — robust even if team
   records have missing or incorrect group_name values.
   ============================================================================= */
function _computeGroupStandings(fixtures, teams, groupName) {
  const allGroupFx = fixtures.filter(f => f.group_name === groupName && !f.is_bye);
  if (!allGroupFx.length) {
    Logger.warn('_computeGroupStandings: no fixtures found', { groupName });
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
    const home = standingsMap[resolveId(f.home_team)];
    const away = standingsMap[resolveId(f.away_team)];
    if (!home || !away) return;

    home.played++; away.played++;
    home.ptsFor    += (f.home_score || 0); home.ptsAgainst += (f.away_score || 0);
    away.ptsFor    += (f.away_score || 0); away.ptsAgainst += (f.home_score || 0);

    if ((f.home_score || 0) > (f.away_score || 0)) { home.wins++; away.losses++; }
    else                                             { away.wins++; home.losses++; }
  });

  return Object.values(standingsMap).sort((a, b) => {
    if (b.wins !== a.wins)           return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    return b.ptsFor - a.ptsFor;
  });
}
