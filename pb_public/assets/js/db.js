/**
 * =============================================================================
 * db.js — Database layer (all PocketBase calls) + Migration functions
 *
 * Depends on: config.js, logger.js, auth.js, state.js, generators.js
 * =============================================================================
 */

/* =============================================================================
   DATABASE LAYER
   ============================================================================= */
const DB = {

  /* ── HEALTH ─────────────────────────────────────────────────────────── */

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

  /* ── TOURNAMENTS ─────────────────────────────────────────────────────── */

  async getTournaments() {
    return pb.collection('tournaments').getFullList({ sort: '-created' });
  },

  async getEvents() {
    try {
      const all   = await pb.collection('tournaments').getFullList({ fields: 'event_name' });
      const names = [...new Set(all.map(t => t.event_name).filter(Boolean))].sort();
      Logger.debug('DB.getEvents', { count: names.length });
      return names;
    } catch (e) {
      Logger.warn('DB.getEvents failed', { error: e.message });
      return [];
    }
  },

  async createTournament(name, format, eventName = null) {
    Logger.info('DB.createTournament', { name, format, eventName });
    return pb.collection('tournaments').create({
      name, format,
      status     : 'pending',
      event_name : eventName || null,
    });
  },

  async updateTournament(id, data) {
    return pb.collection('tournaments').update(id, data);
  },

  async deleteTournament(id) {
    Logger.warn('DB.deleteTournament', { id });
    return pb.collection('tournaments').delete(id);
  },

  /* ── MASTER TEAMS (databank) ─────────────────────────────────────────── */

  /**
   * Fetch all master teams, sorted by name.
   * Optionally filter by category (e.g. "U16 Boys").
   */
  async getMasterTeams(category = null) {
    const filter = category ? `category = "${category}"` : '';
    return pb.collection('master_teams').getFullList({
      filter : filter || undefined,
      sort   : 'name',
    });
  },

  /**
   * Find a master team by name (case-insensitive).
   * Returns the record or null if not found.
   */
  async findMasterTeam(name) {
    try {
      const results = await pb.collection('master_teams').getFullList({
        filter: `name = "${name}"`,
      });
      return results[0] ?? null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Create a new master team record.
   */
  async createMasterTeam(name, category = null, shortName = null, homeCourt = null) {
    Logger.info('DB.createMasterTeam', { name, category });
    return pb.collection('master_teams').create({
      name,
      category   : category   || null,
      short_name : shortName  || null,
      home_court : homeCourt  || null,
      active     : true,
    });
  },

  /**
   * Get or create a master team by name.
   * Used during tournament setup so returning teams are linked automatically.
   *
   * @param {string} name       - Team name as entered
   * @param {string} category   - Tournament category (e.g. "U16 Boys")
   * @returns {string} master_team record ID
   */
  async getOrCreateMasterTeam(name, category = null) {
    const existing = await DB.findMasterTeam(name);
    if (existing) {
      Logger.debug('DB.getOrCreateMasterTeam: found existing', { name, id: existing.id });
      return existing.id;
    }
    const created = await DB.createMasterTeam(name, category);
    Logger.info('DB.getOrCreateMasterTeam: created new', { name, id: created.id });
    return created.id;
  },

  /* ── TOURNAMENT TEAMS ────────────────────────────────────────────────── */

  /**
   * Create a per-tournament team record, linked to its master_team.
   */
  async createTeam(tournamentId, name, seed, groupName, masterTeamId = null) {
    return pb.collection('teams').create({
      tournament  : tournamentId,
      name,
      seed        : seed      ?? null,
      group_name  : groupName ?? null,
      master_team : masterTeamId ?? null,
    });
  },

  async getTeams(tournamentId) {
    return pb.collection('teams').getFullList({
      filter : `tournament = "${tournamentId}"`,
      sort   : 'seed',
      expand : 'master_team',
    });
  },

  /* ── FIXTURES ────────────────────────────────────────────────────────── */

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

  /* ── TEAM STATS (databank) ───────────────────────────────────────────── */

  /**
   * Compute and save team stats after a tournament completes.
   * Called automatically when all fixtures are marked completed.
   *
   * @param {string} tournamentId
   * @param {Array}  fixtures     - All fixtures for the tournament
   * @param {Array}  teams        - All team records for the tournament
   */
  async saveTeamStats(tournamentId, fixtures, teams) {
    Logger.info('DB.saveTeamStats', { tournamentId });

    const realFx = fixtures.filter(f => !f.is_bye && f.status === 'completed');

    // Build per-team stats
    const statsMap = {};
    teams.forEach(t => {
      if (!t.master_team) return; // skip teams not linked to master
      const masterId = typeof t.master_team === 'object' ? t.master_team.id : t.master_team;
      statsMap[t.id] = {
        teamId      : t.id,
        masterId,
        wins        : 0,
        losses      : 0,
        points_for  : 0,
        points_against: 0,
        group_name  : t.group_name || null,
      };
    });

    realFx.forEach(f => {
      const resolveId = v => typeof v === 'object' ? v?.id : v;
      const homeId = resolveId(f.home_team);
      const awayId = resolveId(f.away_team);
      const home   = statsMap[homeId];
      const away   = statsMap[awayId];

      if (home) {
        home.points_for    += (f.home_score || 0);
        home.points_against += (f.away_score || 0);
        if ((f.home_score || 0) > (f.away_score || 0)) home.wins++;
        else home.losses++;
      }
      if (away) {
        away.points_for    += (f.away_score || 0);
        away.points_against += (f.home_score || 0);
        if ((f.away_score || 0) > (f.home_score || 0)) away.wins++;
        else away.losses++;
      }
    });

    // Determine final placement from knockout results
    const placements = DB._computePlacements(fixtures, teams);

    // Upsert team_stats records
    for (const stat of Object.values(statsMap)) {
      if (!stat.masterId) continue;
      try {
        // Check if a record already exists for this master_team + tournament
        const existing = await pb.collection('team_stats').getFullList({
          filter: `master_team="${stat.masterId}"&&tournament="${tournamentId}"`,
        });

        const data = {
          master_team    : stat.masterId,
          tournament     : tournamentId,
          wins           : stat.wins,
          losses         : stat.losses,
          points_for     : stat.points_for,
          points_against : stat.points_against,
          placement      : placements[stat.teamId] ?? null,
          group_name     : stat.group_name,
        };

        if (existing.length) {
          await pb.collection('team_stats').update(existing[0].id, data);
          Logger.debug('DB.saveTeamStats: updated', { masterId: stat.masterId });
        } else {
          await pb.collection('team_stats').create(data);
          Logger.debug('DB.saveTeamStats: created', { masterId: stat.masterId });
        }
      } catch (e) {
        Logger.warn('DB.saveTeamStats: failed for team', { masterId: stat.masterId, error: e.message });
      }
    }

    Logger.info('DB.saveTeamStats: complete', { count: Object.keys(statsMap).length });
  },

  /**
   * Compute final placements (1st, 2nd, etc.) from fixture results.
   * Uses the knockout bracket winner as 1st, finalist as 2nd, etc.
   *
   * @returns {object} { teamId: placement }
   */
  _computePlacements(fixtures, teams) {
    const placements = {};
    const knockoutFx = fixtures
      .filter(f => !f.group_name && !f.is_bye && f.status === 'completed')
      .sort((a, b) => b.round - b.round || b.match_number - a.match_number);

    if (!knockoutFx.length) return placements;

    const resolveId = v => typeof v === 'object' ? v?.id : v;

    // Final — winner gets 1st, loser gets 2nd
    const finalFx = knockoutFx.find(f => f.round_label === 'Final');
    if (finalFx) {
      const winnerId = resolveId(finalFx.winner);
      const homeId   = resolveId(finalFx.home_team);
      const awayId   = resolveId(finalFx.away_team);
      const loserId  = winnerId === homeId ? awayId : homeId;
      if (winnerId) placements[winnerId] = 1;
      if (loserId)  placements[loserId]  = 2;
    }

    // Semifinalists — losers get 3rd/4th
    const semiFx = knockoutFx.filter(f => f.round_label === 'Semifinals');
    let placement = 3;
    semiFx.forEach(f => {
      const winnerId = resolveId(f.winner);
      const homeId   = resolveId(f.home_team);
      const awayId   = resolveId(f.away_team);
      const loserId  = winnerId === homeId ? awayId : homeId;
      if (loserId && !placements[loserId]) placements[loserId] = placement++;
    });

    return placements;
  },

  /**
   * Fetch cross-tournament stats for a master team.
   * Returns all team_stats records with tournament expanded.
   */
  async getMasterTeamStats(masterTeamId) {
    return pb.collection('team_stats').getFullList({
      filter : `master_team = "${masterTeamId}"`,
      sort   : '-created',
      expand : 'tournament',
    });
  },

  /**
   * Fetch head-to-head record between two master teams.
   * Scans all fixtures where both teams appeared.
   */
  async getHeadToHead(masterTeamId1, masterTeamId2) {
    Logger.info('DB.getHeadToHead', { masterTeamId1, masterTeamId2 });
    try {
      // Get per-tournament team IDs for both master teams
      const [team1Instances, team2Instances] = await Promise.all([
        pb.collection('teams').getFullList({ filter: `master_team = "${masterTeamId1}"` }),
        pb.collection('teams').getFullList({ filter: `master_team = "${masterTeamId2}"` }),
      ]);

      const team1Ids = new Set(team1Instances.map(t => t.id));
      const team2Ids = new Set(team2Instances.map(t => t.id));

      // Find all fixtures where they met
      const meetings = [];
      for (const t1 of team1Instances) {
        for (const t2 of team2Instances) {
          if (t1.tournament !== t2.tournament) continue;
          try {
            const fx = await pb.collection('fixtures').getFullList({
              filter : `tournament = "${t1.tournament}" && ((home_team = "${t1.id}" && away_team = "${t2.id}") || (home_team = "${t2.id}" && away_team = "${t1.id}")) && status = "completed"`,
              expand : 'home_team,away_team,winner,tournament',
              requestKey : `h2h-db-${t1.id}-${t2.id}`,
            });
            meetings.push(...fx);
            
          } catch (e) {
            Logger.warn('DB.getHeadToHead: fixture query failed', { error: e.message });
          }
        }
      }

      Logger.info('DB.getHeadToHead: found meetings', { count: meetings.length });
      return { meetings, team1Ids, team2Ids };
    } catch (e) {
      Logger.error('DB.getHeadToHead failed', { error: e.message });
      return { meetings: [], team1Ids: new Set(), team2Ids: new Set() };
    }
  },

  /* ── FAVOURITES ──────────────────────────────────────────────────────── */

  async getFavourites() {
    if (!Auth.canFavourite()) return [];
    try {
      return await pb.collection('favourites').getFullList({
        filter : `user = "${Auth.user().id}"`,
        expand : 'tournament',
      });
    } catch (e) {
      Logger.warn('getFavourites failed', { error: e.message });
      return [];
    }
  },

  async addFavourite(tournamentId) {
    return pb.collection('favourites').create({
      user       : Auth.user().id,
      tournament : tournamentId,
    });
  },

  async removeFavourite(favouriteId) {
    return pb.collection('favourites').delete(favouriteId);
  },

  /* ── BRACKET ADVANCEMENT ─────────────────────────────────────────────── */

  async advanceWinnerElimination(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    Logger.info('DB.advanceWinner', {
      from: `R${currentRound}M${currentMatchNumber}`,
      to  : `R${nextRound}M${nextMatchNumber}`, slot,
    });

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber}`,
      });
      if (!nextFx.length) { Logger.warn('advanceWinner: no next fixture'); return; }
      await pb.collection('fixtures').update(nextFx[0].id, { [slot]: winnerTeamId });
      Logger.info('Winner placed', { nextFixtureId: nextFx[0].id, slot });
    } catch (e) {
      Logger.warn('advanceWinner failed', { error: e.message });
    }
  },

  async clearAdvancedWinner(tournamentId, currentRound, currentMatchNumber) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      const nextFx = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber}`,
      });
      if (!nextFx.length) return;
      await pb.collection('fixtures').update(nextFx[0].id, {
        [slot]: null, status: 'scheduled', winner: null,
        home_score: null, away_score: null,
      });
    } catch (e) {
      Logger.warn('clearAdvancedWinner failed', { error: e.message });
    }
  },

  async repairNextFixture(tournamentId, currentRound, currentMatchNumber, winnerTeamId) {
    const nextRound       = currentRound + 1;
    const nextMatchNumber = Math.ceil(currentMatchNumber / 2);
    const slot            = currentMatchNumber % 2 === 1 ? 'home_team' : 'away_team';

    try {
      const expected = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && round = ${nextRound} && match_number = ${nextMatchNumber} && !is_bye`,
      });

      if (expected.length) {
        const fx      = expected[0];
        const current = typeof fx[slot] === 'object' ? fx[slot]?.id : fx[slot];
        if (current === winnerTeamId) return;
        await pb.collection('fixtures').update(fx.id, { [slot]: winnerTeamId });
        Logger.warn('repairNextFixture: corrected slot', { fixtureId: fx.id, slot });
        return;
      }

      // Fallback scan for old buggy round numbers
      const allKnockout = await pb.collection('fixtures').getFullList({
        filter: `tournament = "${tournamentId}" && group_name = "" && !is_bye`,
        sort  : 'round,match_number',
      });

      const rounds          = [...new Set(allKnockout.map(f => f.round))].sort((a, b) => a - b);
      const currentRoundIdx = rounds.indexOf(currentRound);
      if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) return;

      const actualNextRound  = rounds[currentRoundIdx + 1];
      const nextRoundFx      = allKnockout.filter(f => f.round === actualNextRound).sort((a, b) => a.match_number - b.match_number);
      const currentRoundFx   = allKnockout.filter(f => f.round === currentRound).sort((a, b) => a.match_number - b.match_number);
      const positionInRound  = currentRoundFx.findIndex(f => f.match_number === currentMatchNumber);
      const targetFixtureIdx = Math.floor(positionInRound / 2);
      const targetSlot       = positionInRound % 2 === 0 ? 'home_team' : 'away_team';

      if (targetFixtureIdx >= nextRoundFx.length) return;

      const targetFx   = nextRoundFx[targetFixtureIdx];
      const currentVal = typeof targetFx[targetSlot] === 'object' ? targetFx[targetSlot]?.id : targetFx[targetSlot];
      if (currentVal === winnerTeamId) return;

      await pb.collection('fixtures').update(targetFx.id, { [targetSlot]: winnerTeamId });
      Logger.warn('repairNextFixture: patched via scan', { fixtureId: targetFx.id, slot: targetSlot });

    } catch (e) {
      Logger.warn('repairNextFixture failed', { error: e.message });
    }
  },

  async seedKnockoutFromGroups(tournamentId, allTeams) {
    Logger.info('DB.seedKnockoutFromGroups: checking group completion');

    const freshFixtures = await pb.collection('fixtures').getFullList({
      filter: `tournament = "${tournamentId}"`,
      sort  : 'round,match_number',
      expand: 'home_team,away_team,winner',
    });

    const groupFxAll = freshFixtures.filter(f => f.group_name && !f.is_bye);
    if (!groupFxAll.length) return false;
    if (!groupFxAll.every(f => f.status === 'completed')) return false;

    Logger.info('seedKnockoutFromGroups: seeding knockout');

    const groupNames    = [...new Set(groupFxAll.map(f => f.group_name))].sort();
    const groupRankings = groupNames.map(gName => {
      const top2 = _computeGroupStandings(freshFixtures, allTeams, gName).slice(0, 2);
      Logger.info(`${gName} top 2`, top2.map(s => `${s.name} W:${s.wins}`));
      return top2;
    });

    const firsts  = groupRankings.map(g => g[0]);
    const seconds = groupRankings.map(g => g[1]);
    const advancers = [];
    for (let i = 0; i < firsts.length; i++) {
      advancers.push(firsts[i]);
      advancers.push(seconds[(i + 1) % seconds.length]);
    }

    if (advancers.some(a => !a?.teamId)) {
      Logger.error('seedKnockoutFromGroups: missing teamId — aborting');
      return false;
    }

    const knockoutFx = freshFixtures
      .filter(f => !f.group_name && !f.is_bye)
      .sort((a, b) => a.round !== b.round ? a.round - b.round : a.match_number - b.match_number);

    if (!knockoutFx.length) return false;

    const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
    const firstRoundFx = knockoutFx
      .filter(f => f.round === firstKoRound)
      .sort((a, b) => a.match_number - b.match_number);

    for (let i = 0; i < firstRoundFx.length; i++) {
      await pb.collection('fixtures').update(firstRoundFx[i].id, {
        home_team: advancers[i * 2].teamId,
        away_team: advancers[i * 2 + 1].teamId,
      });
    }

    return true;
  },

};  // ← end of DB object

/* =============================================================================
   MIGRATION — repair tournaments created with old buggy round numbering.
   Standalone async functions (NOT inside DB).
   ============================================================================= */
async function migrateExistingTournaments() {
  Logger.info('Migration: checking for broken tournaments');
  let tournaments;
  try {
    tournaments = await pb.collection('tournaments').getFullList({ sort: '-created' });
  } catch (e) {
    Logger.error('Migration: failed to fetch', { error: e.message });
    return;
  }

  const active = tournaments.filter(t => t.status === 'active' && t.format === 'group_stage');
  for (const tournament of active) {
    try { await _migrateTournament(tournament); }
    catch (e) { Logger.error('Migration failed', { id: tournament.id, error: e.message }); }
  }
  Logger.info('Migration: complete');
}

async function _migrateTournament(tournament) {
  const [allTeams, allFixtures] = await Promise.all([
    pb.collection('teams').getFullList({ filter: `tournament = "${tournament.id}"`, sort: 'seed' }),
    pb.collection('fixtures').getFullList({
      filter: `tournament = "${tournament.id}"`,
      sort  : 'round,match_number',
      expand: 'home_team,away_team,winner',
    }),
  ]);

  const groupFx    = allFixtures.filter(f => f.group_name && !f.is_bye);
  const knockoutFx = allFixtures.filter(f => !f.group_name && !f.is_bye);
  if (!groupFx.length || !knockoutFx.length) return;
  if (!groupFx.every(f => f.status === 'completed')) return;

  const firstKoRound    = Math.min(...knockoutFx.map(f => f.round));
  const knockoutUnseeded = knockoutFx
    .filter(f => f.round === firstKoRound)
    .every(f => !f.home_team && !f.away_team);

  if (knockoutUnseeded) {
    await _migrateSeeding(tournament.id, allTeams, allFixtures, knockoutFx);
    return;
  }

  const rounds    = [...new Set(knockoutFx.map(f => f.round))].sort((a, b) => a - b);
  const completed = knockoutFx
    .filter(f => f.status === 'completed' && f.winner)
    .sort((a, b) => a.round - b.round || a.match_number - b.match_number);

  for (const fx of completed) {
    const idx = rounds.indexOf(fx.round);
    if (idx === -1 || idx + 1 >= rounds.length) continue;

    const nextRound      = rounds[idx + 1];
    const currentRoundFx = knockoutFx.filter(f => f.round === fx.round).sort((a, b) => a.match_number - b.match_number);
    const posInRound     = currentRoundFx.findIndex(f => f.id === fx.id);
    const slot           = posInRound % 2 === 0 ? 'home_team' : 'away_team';
    const nextRoundFx    = knockoutFx.filter(f => f.round === nextRound).sort((a, b) => a.match_number - b.match_number);
    const nextFx         = nextRoundFx[Math.floor(posInRound / 2)];
    if (!nextFx) continue;

    const winnerId   = typeof fx.winner === 'object' ? fx.winner.id : fx.winner;
    const currentVal = typeof nextFx[slot] === 'object' ? nextFx[slot]?.id : nextFx[slot];
    if (currentVal === winnerId) continue;

    await pb.collection('fixtures').update(nextFx.id, { [slot]: winnerId });
    Logger.warn('Migration: fixed winner slot', { from: `R${fx.round}M${fx.match_number}`, slot });
  }
}

async function _migrateSeeding(tournamentId, allTeams, allFixtures, knockoutFx) {
  const groupNames    = [...new Set(allFixtures.filter(f => f.group_name && !f.is_bye).map(f => f.group_name))].sort();
  const groupRankings = groupNames.map(gName => _computeGroupStandings(allFixtures, allTeams, gName).slice(0, 2));
  const firsts        = groupRankings.map(g => g[0]);
  const seconds       = groupRankings.map(g => g[1]);
  const advancers     = [];
  for (let i = 0; i < firsts.length; i++) {
    advancers.push(firsts[i]);
    advancers.push(seconds[(i + 1) % seconds.length]);
  }
  if (advancers.some(a => !a?.teamId)) { Logger.error('Migration: missing teamId'); return; }

  const firstKoRound = Math.min(...knockoutFx.map(f => f.round));
  const firstRoundFx = knockoutFx.filter(f => f.round === firstKoRound).sort((a, b) => a.match_number - b.match_number);
  for (let i = 0; i < firstRoundFx.length; i++) {
    await pb.collection('fixtures').update(firstRoundFx[i].id, {
      home_team: advancers[i * 2].teamId,
      away_team: advancers[i * 2 + 1].teamId,
    });
  }
}
