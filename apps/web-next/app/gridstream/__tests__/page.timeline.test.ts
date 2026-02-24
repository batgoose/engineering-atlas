import { describe, expect, it } from 'vitest';

import type {
  ApiBoxscore,
  ApiGameDetailExtended,
  ApiPlayDetail,
  RunningPlayerMeta,
  RunningPlayerTotals,
} from '@atlas/sdk/gridstream/api-transforms';

import { __gridstreamTestUtils } from '../page';

function makePlay(overrides: Record<string, unknown>): ApiPlayDetail {
  return {
    id: 1,
    drive_id: 1,
    sequence: 1,
    quarter: 1,
    clock: '15:00',
    down: 1,
    distance: 10,
    yard_line: 75,
    side_of_field: 'SEA',
    down_distance_text: '1st & 10',
    possession_team_abbr: 'SEA',
    play_type: 'pass',
    description: '',
    short_description: '',
    yards_gained: 0,
    is_scoring_play: false,
    home_score_after: 0,
    away_score_after: 0,
    touchdown: false,
    interception: false,
    sack: false,
    penalty: false,
    penalty_yards: null,
    fumble_lost: false,
    complete_pass: false,
    first_down: false,
    end_down: null,
    end_distance: null,
    end_yard_line: null,
    epa: null,
    air_yards: null,
    pass_location: '',
    run_location: '',
    passer_player_name: '',
    rusher_player_name: '',
    receiver_player_name: '',
    field_goal_result: '',
    kick_distance: null,
    ...overrides,
  } as unknown as ApiPlayDetail;
}

function makeDetail(overrides: Record<string, unknown>): ApiGameDetailExtended {
  return {
    id: 1,
    espn_event_id: '401772988',
    nflverse_game_id: '2025_01_SEA_NE',
    season_id: 2025,
    week: 5,
    game_date: '2025-09-07',
    game_time: '20:20',
    season_type: 'REG',
    game_note: '',
    home_team_detail: {
      id: 2,
      abbreviation: 'NE',
      display_name: 'New England Patriots',
      short_display_name: 'Patriots',
      color_primary: '002244',
      color_secondary: 'c60c30',
      logo_url: '',
    },
    away_team_detail: {
      id: 1,
      abbreviation: 'SEA',
      display_name: 'Seattle Seahawks',
      short_display_name: 'Seahawks',
      color_primary: '002244',
      color_secondary: '69be28',
      logo_url: '',
    },
    status: 'in_progress',
    quarter: 1,
    clock: '14:00',
    home_score: 0,
    away_score: 0,
    home_score_q1: 0,
    home_score_q2: 0,
    home_score_q3: 0,
    home_score_q4: 0,
    home_score_ot: 0,
    away_score_q1: 0,
    away_score_q2: 0,
    away_score_q3: 0,
    away_score_q4: 0,
    away_score_ot: 0,
    possession_team: 1,
    spread: null,
    total: null,
    home_moneyline: null,
    away_moneyline: null,
    broadcast_network: '',
    broadcast_names: [],
    home_record: '',
    away_record: '',
    home_coach: '',
    away_coach: '',
    home_qb_name: '',
    away_qb_name: '',
    weather_temp: 72,
    weather_condition: 'Clear',
    weather_condition_id: null,
    weather_wind: '',
    weather_humidity: null,
    weather_detail: '',
    venue_name: 'Test Stadium',
    venue_detail: null,
    leaders: [],
    scoring_plays: [],
    ...overrides,
  } as unknown as ApiGameDetailExtended;
}

function makeTotals(overrides: Record<string, unknown> = {}): RunningPlayerTotals {
  return {
    passAtt: 0,
    passComp: 0,
    passYds: 0,
    passTd: 0,
    passInt: 0,
    rushAtt: 0,
    rushYds: 0,
    rushTd: 0,
    rec: 0,
    recYds: 0,
    recTd: 0,
    fgAtt: 0,
    fgMade: 0,
    fgMade0to39: 0,
    fgMade40to49: 0,
    fgMade50to59: 0,
    fgMade60plus: 0,
    fgMissed: 0,
    xpAtt: 0,
    xpMade: 0,
    fumblesLost: 0,
    sacks: 0,
    ...overrides,
  } as unknown as RunningPlayerTotals;
}

describe('Gridstream timeline derivation', () => {
  it('derives punt start from landing + kick_distance field (nflverse data)', () => {
    // nflverse data: kick_distance is populated, yard_line may use own-endzone convention.
    const puntPlay = makePlay({
      id: 6001,
      sequence: 6001,
      quarter: 2,
      clock: '14:37',
      down: 4,
      distance: 5,
      yard_line: 37, // ESPN "own-endzone" value (wrong for yardline100ToDisplay)
      possession_team_abbr: 'NE',
      play_type: 'punt',
      description: 'B.Baringer punts 39 yards to SEA 24, Center-J.Ashby, fair catch by R.Shaheed.',
      yards_gained: 39,
      kick_distance: 39, // explicit DB field available
      punt_attempt: true,
      punt_fair_catch: true,
      return_team: 'SEA',
      end_yard_line: 76,
    });

    const nextSnap = makePlay({
      id: 6002,
      sequence: 6002,
      quarter: 2,
      clock: '14:30',
      down: 1,
      distance: 10,
      yard_line: 76,
      possession_team_abbr: 'SEA',
      play_type: 'pass',
      description: 'S.Darnold pass incomplete.',
    });

    const animation = __gridstreamTestUtils.toPlayAnimation(
      puntPlay,
      nextSnap,
      'SEA',
      'NE',
      new Map(),
      new Map(),
      new Map()
    );

    expect(animation?.type).toBe('kick');
    expect(animation?.fromSide).toBe('NE');
    expect(animation?.fromYardline).toBe(37);
    expect(animation?.kickLandingSide).toBe('SEA');
    expect(animation?.kickLandingYardline).toBe(24);
  });

  it('derives punt start from play text yards when kick_distance field is null (ESPN data)', () => {
    // ESPN-sourced games do not populate kick_distance. The yards must be parsed from
    // the description: "B.Baringer punts 39 yards to SEA 24" → kickYards=39.
    const puntPlay = makePlay({
      id: 6003,
      sequence: 6003,
      quarter: 2,
      clock: '14:37',
      down: 4,
      distance: 5,
      yard_line: 37, // ESPN "own-endzone" value (wrong for yardline100ToDisplay)
      possession_team_abbr: 'NE',
      play_type: 'punt',
      description: 'B.Baringer punts 39 yards to SEA 24, Center-J.Ashby, fair catch by R.Shaheed.',
      yards_gained: 39,
      kick_distance: null, // ESPN does NOT set kick_distance
      punt_attempt: true,
      punt_fair_catch: true,
      return_team: 'SEA',
      end_yard_line: 76,
    });

    const nextSnap = makePlay({
      id: 6004,
      sequence: 6004,
      quarter: 2,
      clock: '14:30',
      down: 1,
      distance: 10,
      yard_line: 76,
      possession_team_abbr: 'SEA',
      play_type: 'pass',
      description: 'S.Darnold pass incomplete.',
    });

    const animation = __gridstreamTestUtils.toPlayAnimation(
      puntPlay,
      nextSnap,
      'SEA',
      'NE',
      new Map(),
      new Map(),
      new Map()
    );

    expect(animation?.type).toBe('kick');
    // Start should be NE 37 derived from: SEA 24 + 39 yards reversed = NE 37
    expect(animation?.fromSide).toBe('NE');
    expect(animation?.fromYardline).toBe(37);
    expect(animation?.kickLandingSide).toBe('SEA');
    expect(animation?.kickLandingYardline).toBe(24);
  });

  it('animates no-play penalties even when feed down is missing (down=0)', () => {
    const penaltyPlay = makePlay({
      id: 7001,
      sequence: 7001,
      quarter: 2,
      clock: '3:09',
      down: 0,
      distance: 0,
      yard_line: 83,
      down_distance_text: '3rd & 7 at NE 17',
      possession_team_abbr: 'NE',
      play_type: 'no_play',
      description: 'PENALTY on NE-W.Campbell, False Start, 5 yards, enforced at NE 17 - No Play.',
      short_description:
        'PENALTY on NE-W.Campbell, False Start, 5 yards, enforced at NE 17 - No Play.',
      yards_gained: 0,
      penalty: true,
      penalty_yards: 5,
      penalty_type: 'False Start',
      penalty_team: 'NE',
      penalty_player_name: 'W.Campbell',
      pass_attempt: true,
    });

    const nextSnap = makePlay({
      id: 7002,
      sequence: 7002,
      quarter: 2,
      clock: '3:02',
      down: 3,
      distance: 12,
      yard_line: 88,
      down_distance_text: '3rd & 12 at NE 12',
      possession_team_abbr: 'NE',
      play_type: 'pass',
      description: 'D.Maye pass incomplete short right.',
      short_description: 'D.Maye pass incomplete short right.',
    });

    const animation = __gridstreamTestUtils.toPlayAnimation(
      penaltyPlay,
      nextSnap,
      'SEA',
      'NE',
      new Map(),
      new Map(),
      new Map()
    );

    expect(animation).toBeTruthy();
    expect(animation?.type).toBe('pass');
    expect(animation?.isNoPlay).toBe(true);
    expect(animation?.penaltyYards).toBe(5);
    expect(animation?.penaltyType).toBe('False Start');
    expect(animation?.penaltyTeam).toBe('NE');
  });

  it('uses 0 return yards for punt returns with no gain', () => {
    const puntPlay = makePlay({
      id: 1001,
      sequence: 1001,
      quarter: 1,
      clock: '0:32',
      down: 4,
      distance: 15,
      yard_line: 77,
      down_distance_text: '4th & 15',
      possession_team_abbr: 'SEA',
      play_type: 'punt',
      description:
        'SEA M.Dickson punts 45 yards to NE 32, Center-C.Stoll. M.Jones to NE 32 for no gain (D.Thomas).',
      short_description: 'M.Dickson punts 45 yards to NE 32. M.Jones to NE 32 for no gain.',
      yards_gained: 45,
      kick_distance: 45,
      punt_attempt: true,
      return_team: 'NE',
      return_yards: 0,
      punt_returner_player_name: 'M.Jones',
      end_yard_line: 68,
    });

    const nextSnap = makePlay({
      id: 1002,
      sequence: 1002,
      quarter: 1,
      clock: '0:24',
      down: 1,
      distance: 10,
      yard_line: 68,
      down_distance_text: '1st & 10',
      possession_team_abbr: 'NE',
      play_type: 'pass',
      description: 'NE D.Maye pass short right to T.Henry for 3 yards.',
      short_description: 'D.Maye pass short right to T.Henry for 3 yards.',
      yards_gained: 3,
      complete_pass: true,
    });

    const runningTotals = new Map<string, RunningPlayerTotals>();
    const runningMeta = new Map<string, RunningPlayerMeta>();
    __gridstreamTestUtils.updateRunningTotalsFromPlay(puntPlay, runningTotals, runningMeta);

    const animation = __gridstreamTestUtils.toPlayAnimation(
      puntPlay,
      nextSnap,
      'SEA',
      'NE',
      new Map(),
      runningTotals,
      new Map()
    );

    expect(animation?.type).toBe('kick');
    expect(animation?.yardsGained).toBe(0);
    expect(animation?.actor?.summary).toBe('0 Yard Return');
  });

  it('infers first down on 4th-down conversions when feed first_down/end_down flags are missing', () => {
    const play = makePlay({
      id: 8101,
      sequence: 8101,
      quarter: 4,
      clock: '0:21',
      down: 4,
      distance: 7,
      yard_line: 50,
      possession_team_abbr: 'BAL',
      play_type: 'pass',
      description:
        'BAL (:21) (Shotgun) 8-L.Jackson pass deep left to 80-I.Likely to PIT 24 for 26 yards (5-J.Ramsey) [90-T.Watt].',
      short_description: 'L.Jackson pass deep left to I.Likely for 26 yards.',
      yards_gained: 0,
      first_down: false,
      end_down: null,
      end_yard_line: 24,
      complete_pass: true,
      pass_attempt: true,
    });

    const nextSnap = makePlay({
      id: 8102,
      sequence: 8102,
      quarter: 4,
      clock: '0:15',
      down: 1,
      distance: 10,
      yard_line: 24,
      possession_team_abbr: 'BAL',
      play_type: 'pass',
      description: 'BAL L.Jackson pass incomplete short right.',
      short_description: 'L.Jackson incomplete pass.',
      pass_attempt: true,
    });

    const animation = __gridstreamTestUtils.toPlayAnimation(
      play,
      nextSnap,
      'BAL',
      'PIT',
      new Map(),
      new Map(),
      new Map()
    );

    expect(animation?.type).toBe('pass');
    expect(animation?.isFirstDown).toBe(true);
  });

  it('classifies defensive fumble recovery as turnover when fumble_lost flag is false', () => {
    const play = makePlay({
      id: 8201,
      sequence: 8201,
      quarter: 4,
      clock: '3:10',
      down: 3,
      distance: 1,
      yard_line: 40,
      possession_team_abbr: 'WAS',
      play_type: 'run',
      description:
        '(3:10) (Shotgun) 73-T.Scott reported in as eligible. 5-J.Daniels FUMBLES (Aborted) at CHI 45, RECOVERED by CHI-26-N.Wright at CHI 44.',
      short_description:
        'J.Daniels FUMBLES (Aborted) at CHI 45, RECOVERED by CHI-26-N.Wright at CHI 44.',
      fumble_lost: false,
      interception: false,
      end_yard_line: null,
      return_yards: null,
      fumble_recovery_1_team: '',
      fumble_recovery_1_yards: null,
    });

    const nextSnap = makePlay({
      id: 8202,
      sequence: 8202,
      quarter: 4,
      clock: '3:02',
      down: 1,
      distance: 10,
      yard_line: 56,
      possession_team_abbr: 'CHI',
      play_type: 'run',
      description: 'CHI run up the middle for 2 yards.',
      short_description: 'CHI run for 2 yards.',
    });

    const animation = __gridstreamTestUtils.toPlayAnimation(
      play,
      nextSnap,
      'CHI',
      'WAS',
      new Map(),
      new Map(),
      new Map()
    );

    expect(animation?.type).toBe('turnover');
    expect(animation?.isTurnover).toBe(true);
    expect(animation?.turnoverBy).toBe('CHI');
    expect(animation?.turnoverSpotSide).toBe('CHI');
    expect(animation?.turnoverSpotYardline).toBe(45);
    expect(animation?.toSide).toBe('CHI');
    expect(animation?.toYardline).toBe(44);
  });

  it('builds frame team metrics/personnel/fantasy from game state at that play', () => {
    const detail = makeDetail({});
    const plays = [
      makePlay({
        id: 2001,
        sequence: 2001,
        quarter: 1,
        clock: '14:42',
        down: 1,
        distance: 10,
        yard_line: 75,
        down_distance_text: '1st & 10 at SEA 25',
        possession_team_abbr: 'SEA',
        play_type: 'pass',
        description: 'SEA (Shotgun) S.Darnold pass short right to T.Henry to SEA 35 for 10 yards.',
        short_description: 'S.Darnold pass short right to T.Henry for 10 yards.',
        yards_gained: 10,
        complete_pass: true,
        first_down: true,
        end_yard_line: 65,
      }),
      makePlay({
        id: 2002,
        sequence: 2002,
        quarter: 1,
        clock: '14:05',
        down: 1,
        distance: 10,
        yard_line: 65,
        down_distance_text: '1st & 10 at SEA 35',
        possession_team_abbr: 'SEA',
        play_type: 'run',
        description: 'SEA K.Walker up the middle to SEA 40 for 5 yards.',
        short_description: 'K.Walker up the middle for 5 yards.',
        yards_gained: 5,
        first_down: false,
        end_yard_line: 60,
      }),
    ];

    const boxscore = {
      team_stats: [
        {
          team_abbr: 'SEA',
          total_yards: 999,
          pass_yards: 777,
          rush_yards: 222,
          first_downs: 20,
          third_down_attempts: 8,
          third_down_conversions: 6,
          turnovers: 0,
          penalties: 1,
          penalty_yards: 5,
          sacks_made: 0,
          time_of_possession: '20:00',
        },
        {
          team_abbr: 'NE',
          total_yards: 888,
          pass_yards: 500,
          rush_yards: 388,
          first_downs: 18,
          third_down_attempts: 9,
          third_down_conversions: 5,
          turnovers: 1,
          penalties: 2,
          penalty_yards: 10,
          sacks_made: 1,
          time_of_possession: '10:00',
        },
      ],
      player_stats: {
        SEA: [],
        NE: [],
      },
      leaders: [
        {
          team_abbr: 'SEA',
          category: 'passing',
          athlete_name: 'Final QB',
          display_value: '30/40 · 400 YDS · 4 TD',
        },
      ],
    };

    const timeline = __gridstreamTestUtils.buildTimeline(
      detail,
      plays,
      [],
      boxscore as unknown as ApiBoxscore
    );

    const firstFrame = timeline.frames[0];
    expect(firstFrame).toBeTruthy();

    // Team metrics should reflect only play #1 (10 pass yards), not full-game boxscore totals.
    expect(firstFrame.teamStats?.away.passingYards).toBe(10);
    expect(firstFrame.teamStats?.away.totalYards).toBe(10);
    expect(firstFrame.teamStats?.away.totalYards).not.toBe(999);

    // Personnel leaders should come from in-frame running totals, not final leader feed.
    expect(firstFrame.leaders?.away.passing.name).toBe('S.Darnold');
    expect(firstFrame.leaders?.away.passing.name).not.toBe('Final QB');

    // Fantasy should only include players with production at that play.
    expect(firstFrame.fantasyAway.some((player) => player.name === 'S.Darnold')).toBe(true);
    expect(firstFrame.fantasyAway.some((player) => player.name === 'K.Walker')).toBe(false);
  });

  it('uses canonical cumulative EPA totals from play payload when available', () => {
    const detail = makeDetail({});
    const plays = [
      makePlay({
        id: 2101,
        sequence: 2101,
        quarter: 1,
        clock: '14:55',
        possession_team_abbr: 'SEA',
        play_type: 'pass',
        description: 'SEA pass for 8 yards.',
        yards_gained: 8,
        complete_pass: true,
        epa: 8.0, // intentionally unrealistic to verify canonical override.
        total_away_epa: 1.2,
        total_home_epa: -1.2,
      }),
      makePlay({
        id: 2102,
        sequence: 2102,
        quarter: 1,
        clock: '14:20',
        possession_team_abbr: 'NE',
        play_type: 'run',
        description: 'NE run for 4 yards.',
        yards_gained: 4,
        epa: 9.0,
        total_away_epa: 0.9,
        total_home_epa: -0.9,
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], {
      team_stats: [],
      player_stats: {},
      leaders: [],
    } as unknown as ApiBoxscore);

    expect(timeline.frames[0]?.epaTotals?.away).toBeCloseTo(1.2, 6);
    expect(timeline.frames[0]?.epaTotals?.home).toBeCloseTo(-1.2, 6);
    expect(timeline.frames[1]?.epaTotals?.away).toBeCloseTo(0.9, 6);
    expect(timeline.frames[1]?.epaTotals?.home).toBeCloseTo(-0.9, 6);
  });

  it('falls back to rolling offense EPA when cumulative totals are missing', () => {
    const detail = makeDetail({});
    const plays = [
      makePlay({
        id: 2201,
        sequence: 2201,
        quarter: 1,
        clock: '14:50',
        possession_team_abbr: 'SEA',
        play_type: 'pass',
        description: 'SEA pass for 10 yards.',
        yards_gained: 10,
        complete_pass: true,
        epa: 1.5,
      }),
      makePlay({
        id: 2202,
        sequence: 2202,
        quarter: 1,
        clock: '14:10',
        possession_team_abbr: 'NE',
        play_type: 'run',
        description: 'NE run for 3 yards.',
        yards_gained: 3,
        epa: -0.5,
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], {
      team_stats: [],
      player_stats: {},
      leaders: [],
    } as unknown as ApiBoxscore);

    expect(timeline.frames[0]?.epaTotals?.away).toBeCloseTo(1.5, 6);
    expect(timeline.frames[0]?.epaTotals?.home).toBeCloseTo(0, 6);
    expect(timeline.frames[1]?.epaTotals?.away).toBeCloseTo(1.5, 6);
    expect(timeline.frames[1]?.epaTotals?.home).toBeCloseTo(-0.5, 6);
  });

  it('keeps fantasy positions from player metadata and includes mixed rushing/receiving breakdown', () => {
    const detail = makeDetail({});
    const plays = [
      makePlay({
        id: 3001,
        sequence: 3001,
        quarter: 1,
        clock: '14:40',
        down: 1,
        distance: 10,
        yard_line: 75,
        down_distance_text: '1st & 10 at SEA 25',
        possession_team_abbr: 'SEA',
        play_type: 'pass',
        description: 'SEA (Shotgun) S.Darnold pass short right to R.Shaheed to SEA 32 for 7 yards.',
        short_description: 'S.Darnold pass short right to R.Shaheed for 7 yards.',
        yards_gained: 7,
        complete_pass: true,
        end_yard_line: 68,
      }),
      makePlay({
        id: 3002,
        sequence: 3002,
        quarter: 1,
        clock: '14:05',
        down: 2,
        distance: 3,
        yard_line: 68,
        down_distance_text: '2nd & 3 at SEA 32',
        possession_team_abbr: 'SEA',
        play_type: 'run',
        description: 'SEA R.Shaheed left end to SEA 36 for 4 yards.',
        short_description: 'R.Shaheed left end for 4 yards.',
        yards_gained: 4,
        end_yard_line: 64,
      }),
    ];

    const boxscore = {
      team_stats: [],
      player_stats: {
        SEA: [
          {
            player_name: 'R.Shaheed',
            player_headshot: null,
            player_position: 'WR',
            team_abbr: 'SEA',
            completions: 0,
            pass_attempts: 0,
            passing_yards: 0,
            passing_tds: 0,
            interceptions_thrown: 0,
            carries: 1,
            rushing_yards: 4,
            rushing_tds: 0,
            rushing_fumbles_lost: 0,
            receptions: 1,
            receiving_yards: 7,
            receiving_tds: 0,
            receiving_fumbles_lost: 0,
            fg_attempts: 0,
            fg_made: 0,
            pat_attempts: 0,
            pat_made: 0,
            sacks_made: 0,
            interceptions_caught: 0,
            fumble_recoveries: 0,
            fantasy_points_standard: 1.1,
            fantasy_points_ppr: 2.1,
            fantasy_points_half_ppr: 1.6,
          },
        ],
        NE: [],
      },
      leaders: [],
    };

    const timeline = __gridstreamTestUtils.buildTimeline(
      detail,
      plays,
      [],
      boxscore as unknown as ApiBoxscore
    );

    const secondFrame = timeline.frames[1];
    expect(secondFrame).toBeTruthy();

    const shaheed = secondFrame.fantasyAway.find((player) => player.name === 'R.Shaheed');
    expect(shaheed).toBeTruthy();
    expect(shaheed?.position).toBe('WR');
    expect(shaheed?.breakdown).toContain('REC 1 REC, 7 YDS');
    expect(shaheed?.breakdown).toContain('RUSH 1 CAR, 4 YDS');
    expect(shaheed?.pointsPpr).toBeGreaterThan(shaheed?.pointsHalfPpr ?? -999);
    expect(shaheed?.pointsHalfPpr).toBeGreaterThan(shaheed?.pointsStandard ?? -999);
  });

  it('scores kickers from made FG/XP attempts', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    // Use makeTotals to ensure all required fields (including fgMissed, fgMade0to39, etc.)
    // are present with default 0 values so the scoring formula doesn't produce NaN.
    totals.set('jmyers', makeTotals({ fgAtt: 3, fgMade: 3 }));

    const meta = new Map<string, RunningPlayerMeta>();
    meta.set('jmyers', { name: 'J.Myers', teamAbbr: 'SEA', position: 'K' });

    const fantasy = __gridstreamTestUtils.mapFantasyFromRunningTotals(totals, meta, 'SEA', 'NE');

    expect(fantasy.away).toHaveLength(1);
    expect(fantasy.away[0]?.position).toBe('K');
    expect(fantasy.away[0]?.pointsPpr).toBe(9);
    expect(fantasy.away[0]?.pointsHalfPpr).toBe(9);
    expect(fantasy.away[0]?.pointsStandard).toBe(9);
  });

  it('adds DEF fantasy entry from team state when frame totals are available', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    const meta = new Map<string, RunningPlayerMeta>();

    const fantasy = __gridstreamTestUtils.mapFantasyFromRunningTotals(
      totals,
      meta,
      'SEA',
      'NE',
      undefined,
      {
        away: {
          totalYards: 100,
          passingYards: 60,
          rushingYards: 40,
          firstDowns: 5,
          thirdDown: '1/5',
          turnovers: 0,
          top: '10:00',
          penalties: '2-10',
          sacks: 2,
        },
        home: {
          totalYards: 80,
          passingYards: 50,
          rushingYards: 30,
          firstDowns: 4,
          thirdDown: '1/6',
          turnovers: 1,
          top: '5:00',
          penalties: '1-5',
          sacks: 1,
        },
      },
      { away: 9, home: 0 }
    );

    const awayDef = fantasy.away.find((entry) => entry.position === 'DEF');
    const homeDef = fantasy.home.find((entry) => entry.position === 'DEF');

    expect(awayDef).toBeTruthy();
    expect(homeDef).toBeTruthy();
    expect(awayDef?.name).toBe('SEA Defense');
    expect(homeDef?.name).toBe('NE Defense');
  });

  it('scores all fantasy positions using ESPN-style formulas (PPR/HALF/STD)', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    totals.set(
      'qb',
      makeTotals({
        passAtt: 30,
        passComp: 20,
        passYds: 250,
        passTd: 2,
        passInt: 1,
        rushAtt: 4,
        rushYds: 20,
        rushTd: 1,
        fumblesLost: 1,
      })
    );
    totals.set(
      'rb',
      makeTotals({
        rushAtt: 18,
        rushYds: 90,
        rushTd: 1,
        rec: 3,
        recYds: 20,
      })
    );
    totals.set(
      'wr',
      makeTotals({
        rushAtt: 1,
        rushYds: 10,
        rec: 6,
        recYds: 80,
        recTd: 1,
        fumblesLost: 1,
      })
    );
    totals.set(
      'te',
      makeTotals({
        rec: 5,
        recYds: 50,
        recTd: 1,
      })
    );
    totals.set(
      'k',
      makeTotals({
        fgAtt: 4,
        fgMade: 3,
        fgMade0to39: 1,
        fgMade40to49: 1,
        fgMade50to59: 1,
        fgMissed: 1,
        xpAtt: 2,
        xpMade: 2,
      })
    );

    const meta = new Map<string, RunningPlayerMeta>();
    meta.set('qb', { name: 'Q.Back', teamAbbr: 'SEA', position: 'QB' });
    meta.set('rb', { name: 'R.Back', teamAbbr: 'SEA', position: 'RB' });
    meta.set('wr', { name: 'W.Receiver', teamAbbr: 'SEA', position: 'WR' });
    meta.set('te', { name: 'T.End', teamAbbr: 'SEA', position: 'TE' });
    meta.set('k', { name: 'K.Icker', teamAbbr: 'SEA', position: 'K' });

    const fantasy = __gridstreamTestUtils.mapFantasyFromRunningTotals(
      totals,
      meta,
      'SEA',
      'NE',
      undefined,
      undefined,
      undefined,
      {
        SEA: {
          pointsAllowed: 14,
          sacks: 3,
          takeaways: 3,
          interceptions: 2,
          fumbleRecoveries: 1,
          blockedKicks: 1,
          safeties: 1,
          defensiveTds: 1,
        },
        NE: {
          pointsAllowed: 9,
          sacks: 0,
          takeaways: 0,
          interceptions: 0,
          fumbleRecoveries: 0,
          blockedKicks: 0,
          safeties: 0,
          defensiveTds: 0,
        },
      }
    );

    const qb = fantasy.away.find((entry) => entry.name === 'Q.Back');
    const rb = fantasy.away.find((entry) => entry.name === 'R.Back');
    const wr = fantasy.away.find((entry) => entry.name === 'W.Receiver');
    const te = fantasy.away.find((entry) => entry.name === 'T.End');
    const k = fantasy.away.find((entry) => entry.name === 'K.Icker');
    const def = fantasy.away.find((entry) => entry.position === 'DEF');

    expect(qb?.pointsStandard).toBeCloseTo(22.0, 4);
    expect(qb?.pointsHalfPpr).toBeCloseTo(22.0, 4);
    expect(qb?.pointsPpr).toBeCloseTo(22.0, 4);

    expect(rb?.pointsStandard).toBeCloseTo(17.0, 4);
    expect(rb?.pointsHalfPpr).toBeCloseTo(18.5, 4);
    expect(rb?.pointsPpr).toBeCloseTo(20.0, 4);

    expect(wr?.pointsStandard).toBeCloseTo(13.0, 4);
    expect(wr?.pointsHalfPpr).toBeCloseTo(16.0, 4);
    expect(wr?.pointsPpr).toBeCloseTo(19.0, 4);

    expect(te?.pointsStandard).toBeCloseTo(11.0, 4);
    expect(te?.pointsHalfPpr).toBeCloseTo(13.5, 4);
    expect(te?.pointsPpr).toBeCloseTo(16.0, 4);

    expect(k?.pointsStandard).toBeCloseTo(13.0, 4);
    expect(k?.pointsHalfPpr).toBeCloseTo(13.0, 4);
    expect(k?.pointsPpr).toBeCloseTo(13.0, 4);

    expect(def?.pointsStandard).toBeCloseTo(20.0, 4);
    expect(def?.pointsHalfPpr).toBeCloseTo(20.0, 4);
    expect(def?.pointsPpr).toBeCloseTo(20.0, 4);
  });

  it('uses ESPN points-allowed D/ST tiers', () => {
    const cases = [
      { pa: 0, expected: 5 },
      { pa: 6, expected: 4 },
      { pa: 13, expected: 3 },
      { pa: 17, expected: 1 },
      { pa: 27, expected: 0 },
      { pa: 34, expected: -1 },
      { pa: 45, expected: -3 },
      { pa: 46, expected: -5 },
    ];

    for (const { pa, expected } of cases) {
      expect(__gridstreamTestUtils.defensePointsAllowedBand(pa)).toBe(expected);
    }
  });

  it('derives D/ST sacks, takeaways, defensive TDs and blocked kicks from play stream', () => {
    const plays = [
      makePlay({
        id: 4001,
        sequence: 4001,
        quarter: 1,
        clock: '13:10',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description:
          'NE D.Maye pass deep middle intended for K.Boutte INTERCEPTED by U.Nwosu at NE 45. U.Nwosu for 45 yards, TOUCHDOWN.',
        interception: true,
        touchdown: true,
        home_score_after: 0,
        away_score_after: 6,
      }),
      makePlay({
        id: 4002,
        sequence: 4002,
        quarter: 1,
        clock: '13:05',
        possession_team_abbr: 'SEA',
        play_type: 'extra_point',
        description: 'SEA J.Myers extra point is GOOD.',
        home_score_after: 0,
        away_score_after: 7,
      }),
      makePlay({
        id: 4003,
        sequence: 4003,
        quarter: 1,
        clock: '12:40',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description: 'NE D.Maye sacked at NE 20 for -7 yards.',
        sack: true,
        home_score_after: 0,
        away_score_after: 7,
      }),
      makePlay({
        id: 4004,
        sequence: 4004,
        quarter: 1,
        clock: '12:00',
        possession_team_abbr: 'NE',
        play_type: 'run',
        description:
          'NE R.Stevenson left guard to NE 22 for 2 yards, FUMBLES (forced by B.Wagner), recovered by SEA-C.Bryant.',
        fumble_lost: true,
        home_score_after: 0,
        away_score_after: 7,
      }),
      makePlay({
        id: 4005,
        sequence: 4005,
        quarter: 1,
        clock: '11:30',
        possession_team_abbr: 'NE',
        play_type: 'field_goal',
        description: 'NE J.Slye 41 yard field goal is BLOCKED, recovered by NE.',
        home_score_after: 0,
        away_score_after: 7,
      }),
    ];

    const defenseTotals = __gridstreamTestUtils.deriveDefenseFantasyTotalsFromPlays(
      plays,
      'SEA',
      'NE',
      { away: 7, home: 0 }
    );

    expect(defenseTotals.SEA.sacks).toBe(1);
    expect(defenseTotals.SEA.interceptions).toBe(1);
    expect(defenseTotals.SEA.fumbleRecoveries).toBe(1);
    expect(defenseTotals.SEA.takeaways).toBe(2);
    expect(defenseTotals.SEA.blockedKicks).toBe(1);
    expect(defenseTotals.SEA.defensiveTds).toBe(1);
    expect(defenseTotals.SEA.pointsAllowed).toBe(0);
  });

  it('does not award offensive passing TD/completion/yards on interception return touchdown', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    const meta = new Map<string, RunningPlayerMeta>();

    __gridstreamTestUtils.updateRunningTotalsFromPlay(
      makePlay({
        id: 5001,
        sequence: 5001,
        quarter: 4,
        clock: '8:49',
        down: 2,
        distance: 3,
        yard_line: 56,
        down_distance_text: '2nd & 3 at NE 44',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description:
          'NE (Shotgun) D.Maye pass deep middle intended for K.Williams INTERCEPTED by J.Love at SEA 27. J.Love pushed ob at NE 38 for 35 yards (T.Henderson), TOUCHDOWN.',
        short_description: 'D.Maye pass intercepted and returned for touchdown.',
        interception: true,
        touchdown: true,
        complete_pass: false,
        yards_gained: 35,
        home_score_after: 7,
        away_score_after: 19,
      }),
      totals,
      meta
    );

    const maye = totals.get('dmaye');
    expect(maye).toBeTruthy();
    expect(maye.passAtt).toBe(1);
    expect(maye.passComp).toBe(0);
    expect(maye.passYds).toBe(0);
    expect(maye.passTd).toBe(0);
    expect(maye.passInt).toBe(1);
  });

  it('increments passing TD only for offensive passing touchdowns', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    const meta = new Map<string, RunningPlayerMeta>();

    __gridstreamTestUtils.updateRunningTotalsFromPlay(
      makePlay({
        id: 5101,
        sequence: 5101,
        quarter: 4,
        clock: '2:21',
        down: 2,
        distance: 7,
        yard_line: 93,
        down_distance_text: '2nd & 7 at SEA 7',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description: 'NE D.Maye pass short left to R.Stevenson for 7 yards, TOUCHDOWN.',
        short_description: 'D.Maye pass short left to R.Stevenson for 7 yards, TOUCHDOWN.',
        interception: false,
        touchdown: true,
        complete_pass: true,
        yards_gained: 7,
        home_score_after: 13,
        away_score_after: 29,
      }),
      totals,
      meta
    );

    __gridstreamTestUtils.updateRunningTotalsFromPlay(
      makePlay({
        id: 5102,
        sequence: 5102,
        quarter: 4,
        clock: '1:49',
        down: 1,
        distance: 10,
        yard_line: 94,
        down_distance_text: '1st & 10 at NE 6',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description: 'NE D.Maye pass short middle to S.Diggs to NE 12 for 6 yards (E.Jones).',
        short_description: 'D.Maye pass short middle to S.Diggs for 6 yards.',
        interception: false,
        touchdown: false,
        complete_pass: true,
        yards_gained: 6,
        home_score_after: 13,
        away_score_after: 29,
      }),
      totals,
      meta
    );

    const maye = totals.get('dmaye');
    expect(maye).toBeTruthy();
    expect(maye.passTd).toBe(1);
    expect(maye.passComp).toBe(2);
    expect(maye.passYds).toBe(13);
  });

  it('uses fallback mission-log text when play descriptions are blank', () => {
    const detail = makeDetail({
      status: 'in_progress',
      quarter: 1,
      clock: '12:00',
      possession_team: 2,
    });

    const plays = [
      makePlay({
        id: 9901,
        sequence: 9901,
        quarter: 1,
        clock: '12:00',
        down: 2,
        distance: 6,
        yard_line: 68,
        down_distance_text: '2nd & 6',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description: '',
        short_description: '',
        yards_gained: 9,
        pass_attempt: true,
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], null);
    expect(timeline.frames).toHaveLength(1);
    expect(timeline.frames[0]?.plays[0]?.text).toBe('PASS +9 yds');
  });

  it('normalizes structured weather detail into usable weather state', () => {
    const detail = makeDetail({
      weather_temp: null,
      weather_condition: '',
      weather_wind: '',
      weather_detail: 'roof=outdoors; surface=grass; temp=25; wind=3 mph',
      venue_detail: {
        id: 101,
        name: 'Acrisure Stadium',
        city: 'Pittsburgh',
        state: 'PA',
        is_indoor: false,
        surface: 'grass',
      },
    });

    const timeline = __gridstreamTestUtils.buildTimeline(detail, [], [], null);
    expect(timeline.liveState.weather.temperature).toBe(25);
    expect(timeline.liveState.weather.condition).toBe('Outdoor');
    expect(timeline.liveState.weather.wind).toBe('3 mph');
  });

  it('tracks receiving totals from structured receiver field when description has jersey prefixes', () => {
    const detail = makeDetail({
      status: 'in_progress',
      possession_team: 2, // NE (home)
    });

    const plays = [
      makePlay({
        id: 9911,
        sequence: 9911,
        quarter: 1,
        clock: '11:56',
        down: 1,
        distance: 10,
        yard_line: 60,
        down_distance_text: '1st & 10',
        possession_team_abbr: 'NE',
        play_type: 'pass',
        description:
          '(11:56) (Shotgun) 8-A.Rodgers pass short left to 14-K.Gainwell to PIT 40 for 12 yards.',
        short_description: '',
        passer_player_name: 'A.Rodgers',
        receiver_player_name: 'K.Gainwell',
        complete_pass: true,
        yards_gained: 12,
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], null);
    const leaders = timeline.frames[0]?.leaders;
    expect(leaders?.home.receiving.name).toBe('K.Gainwell');
    expect(leaders?.home.receiving.line).toBe('1 REC · 12 YDS');
  });

  it('does not classify punt-only players as kicker fantasy entries', () => {
    const totals = new Map<string, RunningPlayerTotals>();
    const meta = new Map<string, RunningPlayerMeta>();

    __gridstreamTestUtils.updateRunningTotalsFromPlay(
      makePlay({
        id: 9921,
        sequence: 9921,
        quarter: 2,
        clock: '9:10',
        down: 4,
        distance: 8,
        yard_line: 62,
        down_distance_text: '4th & 8',
        possession_team_abbr: 'NE',
        play_type: 'punt',
        description: '(9:10) J.Stout punts 48 yards to SEA 10, fair catch by R.Shaheed.',
        short_description: '',
        yards_gained: 48,
        kick_distance: 48,
      }),
      totals,
      meta
    );

    expect(totals.get('jstout')?.punts).toBe(1);
    const fantasy = __gridstreamTestUtils.mapFantasyFromRunningTotals(totals, meta, 'SEA', 'NE');
    expect(fantasy.home.some((entry) => entry.position === 'K')).toBe(false);
  });

  it('derives score and WP from scoring timeline when play score fields are stale', () => {
    const detail = makeDetail({
      status: 'in_progress',
      away_score: 7,
      home_score: 0,
      away_score_q1: 7,
      away_score_q2: 0,
      away_score_q3: 0,
      away_score_q4: 0,
      home_score_q1: 0,
      home_score_q2: 0,
      home_score_q3: 0,
      home_score_q4: 0,
      quarter: 1,
      clock: '10:20',
      scoring_plays: [
        {
          team_abbr: 'SEA',
          quarter: 1,
          description: 'SEA touchdown',
          home_score_after: 0,
          away_score_after: 7,
          sequence: 1,
          clock: '10:54',
        } as unknown as NonNullable<ApiGameDetailExtended['scoring_plays']>[number],
      ],
    });

    const plays = [
      makePlay({
        id: 12001,
        sequence: 12001,
        quarter: 1,
        clock: '11:05',
        play_type: 'pass',
        possession_team_abbr: 'SEA',
        description: 'SEA pass complete for 20 yards, TOUCHDOWN.',
        short_description: 'SEA touchdown pass.',
        touchdown: true,
        away_score_after: 0,
        home_score_after: 0,
      }),
      makePlay({
        id: 12002,
        sequence: 12002,
        quarter: 1,
        clock: '10:54',
        play_type: 'extra_point',
        possession_team_abbr: 'SEA',
        description: 'SEA extra point is GOOD.',
        short_description: 'SEA extra point is GOOD.',
        away_score_after: 0,
        home_score_after: 0,
      }),
      makePlay({
        id: 12003,
        sequence: 12003,
        quarter: 1,
        clock: '10:20',
        play_type: 'kickoff',
        possession_team_abbr: 'SEA',
        description: 'SEA kickoff.',
        short_description: 'SEA kickoff.',
        away_score_after: 0,
        home_score_after: 0,
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], null);
    expect(timeline.frames).toHaveLength(3);

    const scoreFrame = timeline.frames[1]!;
    expect(scoreFrame.awayScore.total).toBe(7);
    expect(scoreFrame.homeScore.total).toBe(0);
    expect(scoreFrame.awayScore.q1).toBe(7);
    expect(scoreFrame.awayWinPct).toBeGreaterThan(50);
  });

  it('parses timeout usage from timeout text when timeout fields are null', () => {
    const detail = makeDetail({
      status: 'in_progress',
      quarter: 2,
      clock: '0:50',
    });

    const plays = [
      makePlay({
        id: 12101,
        sequence: 12101,
        quarter: 2,
        clock: '1:12',
        play_type: 'pass',
        possession_team_abbr: 'SEA',
        description: 'SEA pass complete for 6 yards.',
      }),
      makePlay({
        id: 12102,
        sequence: 12102,
        quarter: 2,
        clock: '1:05',
        play_type: 'no_play',
        possession_team_abbr: 'NE',
        timeout: null as unknown as boolean,
        timeout_team: null as unknown as string,
        home_timeouts_remaining: null,
        away_timeouts_remaining: null,
        description: 'Timeout #1 by NE at 01:05.',
        short_description: 'Timeout #1 by NE at 01:05.',
      }),
      makePlay({
        id: 12103,
        sequence: 12103,
        quarter: 2,
        clock: '0:58',
        play_type: 'pass',
        possession_team_abbr: 'NE',
        description: 'NE pass incomplete.',
      }),
    ];

    const timeline = __gridstreamTestUtils.buildTimeline(detail, plays, [], null);
    expect(timeline.frames).toHaveLength(3);
    expect(timeline.frames[1]?.homeTimeouts).toBe(2);
    expect(timeline.frames[1]?.awayTimeouts).toBe(3);
  });
});
