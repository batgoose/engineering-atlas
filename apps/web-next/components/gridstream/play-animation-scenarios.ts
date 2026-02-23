import type { PlayAnimationData } from '@atlas/sdk/gridstream/types';

export interface PlayAnimationScenario {
  id: string;
  label: string;
  awayAbbr: string;
  play: PlayAnimationData;
}

const BASE_PLAY: PlayAnimationData = {
  type: 'pass',
  direction: 'middle',
  offenseTeam: 'SEA',
  startDistance: 10,
  fromYardline: 45,
  fromSide: 'SEA',
  toYardline: 45,
  toSide: 'SEA',
  yardsGained: 0,
  isComplete: true,
  isFirstDown: false,
  isTurnover: false,
  description: 'Test play',
};

function makePlay(overrides: Partial<PlayAnimationData>): PlayAnimationData {
  return {
    ...BASE_PLAY,
    ...overrides,
    description: overrides.description ?? BASE_PLAY.description,
  };
}

export const PLAY_ANIMATION_SCENARIOS: PlayAnimationScenario[] = [
  {
    id: 'pass-complete-right',
    label: 'Complete pass right',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'pass',
      direction: 'right',
      fromYardline: 41,
      fromSide: 'NE',
      toYardline: 28,
      toSide: 'NE',
      yardsGained: 13,
      isComplete: true,
      isFirstDown: true,
      description: 'D.Maye pass short right to T.Henry for 13 yards.',
      actor: {
        name: 'T.Henry',
        summary: '13 Yard Catch',
        lines: ['2 Catches - 25 Yards'],
      },
      qbActor: {
        name: 'D.Maye',
        summary: '13 Yard Pass',
        lines: ['12/18 Passing - 142 Yards'],
      },
    }),
  },
  {
    id: 'pass-incomplete-left',
    label: 'Incomplete pass left',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'pass',
      direction: 'left',
      fromYardline: 18,
      fromSide: 'SEA',
      toYardline: 18,
      toSide: 'SEA',
      yardsGained: 0,
      isComplete: false,
      description: 'S.Darnold pass incomplete short left.',
      qbActor: {
        name: 'S.Darnold',
        summary: 'Incomplete Pass',
        lines: ['15/21 Passing - 179 Yards'],
      },
    }),
  },
  {
    id: 'rush-middle',
    label: 'Rush up middle',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'rush',
      direction: 'middle',
      fromYardline: 34,
      fromSide: 'NE',
      toYardline: 29,
      toSide: 'NE',
      yardsGained: 5,
      isComplete: true,
      description: 'K.Walker up the middle for 5 yards.',
      actor: {
        name: 'K.Walker',
        summary: '5 Yard Rush',
        lines: ['6 Rushes - 39 Yards'],
      },
    }),
  },
  {
    id: 'sack-loss',
    label: 'Sack for loss',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'pass',
      direction: 'middle',
      fromYardline: 28,
      fromSide: 'NE',
      toYardline: 33,
      toSide: 'NE',
      yardsGained: -5,
      isComplete: false,
      description: 'D.Maye sacked at NE 33 for -5 yards.',
      qbActor: {
        name: 'D.Maye',
        summary: '-5 Yard Sack',
        lines: ['17/30 Passing - 214 Yards', '3 Sacks'],
      },
    }),
  },
  {
    id: 'turnover-interception-return',
    label: 'Interception with return',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'turnover',
      direction: 'left',
      fromYardline: 44,
      fromSide: 'NE',
      turnoverSpotYardline: 27,
      turnoverSpotSide: 'SEA',
      toYardline: 38,
      toSide: 'NE',
      yardsGained: 35,
      isComplete: false,
      isTurnover: true,
      turnoverBy: 'SEA',
      description: 'Pass intercepted by J.Love at SEA 27, returned to NE 38.',
      actor: {
        name: 'J.Love',
        summary: '35 Yard Return',
        lines: ['1 INT - 35 Return Yards'],
      },
    }),
  },
  {
    id: 'kickoff-touchback',
    label: 'Kickoff touchback',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'kick',
      direction: 'middle',
      fromYardline: 35,
      fromSide: 'SEA',
      kickLandingYardline: 0,
      kickLandingSide: 'NE',
      toYardline: 30,
      toSide: 'NE',
      yardsGained: 0,
      description: 'Kicker kicks 65 yards to end zone, touchback.',
      actor: null,
    }),
  },
  {
    id: 'kickoff-return',
    label: 'Kickoff return',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'kick',
      direction: 'middle',
      fromYardline: 35,
      fromSide: 'SEA',
      kickLandingYardline: 6,
      kickLandingSide: 'NE',
      toYardline: 31,
      toSide: 'SEA',
      yardsGained: 25,
      description: 'Kickoff to NE 6, returned 25 yards to SEA 31.',
      actor: {
        name: 'R.Shaheed',
        summary: '25 Yard Return',
        lines: ['2 Returns - 47 Yards'],
      },
    }),
  },
  {
    id: 'punt-out-of-bounds',
    label: 'Punt out of bounds',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'kick',
      direction: 'right',
      fromYardline: 42,
      fromSide: 'SEA',
      kickLandingYardline: 6,
      kickLandingSide: 'NE',
      toYardline: 6,
      toSide: 'NE',
      yardsGained: 52,
      description: 'Punter punts 52 yards to NE 6, out of bounds.',
      actor: null,
    }),
  },
  {
    id: 'field-goal-good',
    label: 'Field goal good',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'fieldgoal',
      direction: 'middle',
      fromYardline: 24,
      fromSide: 'NE',
      toYardline: 0,
      toSide: 'NE',
      yardsGained: 0,
      fgDistance: 41,
      fgResult: 'made',
      description: 'Field goal is GOOD from 41 yards.',
      actor: {
        name: 'J.Myers',
        summary: 'FG GOOD',
        lines: ['2/2 FG'],
      },
    }),
  },
  {
    id: 'field-goal-miss-right',
    label: 'Field goal wide right',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'fieldgoal',
      direction: 'middle',
      fromYardline: 31,
      fromSide: 'NE',
      toYardline: 0,
      toSide: 'NE',
      yardsGained: 0,
      fgDistance: 49,
      fgResult: 'wide_right',
      description: '49-yard field goal is NO GOOD, wide right.',
      actor: {
        name: 'J.Myers',
        summary: 'FG NO GOOD',
        lines: ['1/2 FG'],
      },
    }),
  },

  // ── Penalty scenarios ──────────────────────────────────────────────────────

  {
    // Offensive holding negates a big run (no-play). Arrow should start at the
    // snap LOS (NE 30) and move back 10 yards to NE 40.
    id: 'rush-penalty-offensive-holding-noplay',
    label: 'Rush — offensive holding (no play, enforced from LOS)',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'rush',
      direction: 'middle',
      offenseTeam: 'SEA',
      fromYardline: 30,
      fromSide: 'NE',
      toYardline: 19,
      toSide: 'NE',
      yardsGained: 11,
      isNoPlay: true,
      penaltyTeam: 'SEA',
      penaltyType: 'Offensive Holding',
      penaltyYards: 10,
      // Enforced from LOS (NE 30) → penalty spot is NE 40 (10 yards back)
      penaltyAdjustedYardline: 40,
      penaltyAdjustedSide: 'NE',
      description:
        'K.Walker up the middle for 11 yards. PENALTY on SEA-J.Sundell, Offensive Holding, 10 yards, no play.',
      actor: {
        name: 'K.Walker',
        summary: '11 Yard Rush',
        lines: ['8 Rushes - 52 Yards'],
      },
    }),
  },

  {
    // Defensive personal foul after a completed run (play stands, tack-on).
    // Arrow should start at the end of the run (NE 24) and move forward 15 yards to NE 9.
    id: 'rush-penalty-defensive-personal-foul-tackon',
    label: 'Rush — defensive personal foul (play stands, tacked on from run end)',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'rush',
      direction: 'right',
      offenseTeam: 'NE',
      fromYardline: 38,
      fromSide: 'NE',
      toYardline: 24,
      toSide: 'NE',
      yardsGained: 14,
      isNoPlay: false,
      penaltyTeam: 'SEA',
      penaltyType: 'Unnecessary Roughness',
      penaltyYards: 15,
      // Tacked on from end of run (NE 24) → 15 yards forward to NE 9
      penaltyAdjustedYardline: 9,
      penaltyAdjustedSide: 'NE',
      description:
        'R.Stevenson right end for 14 yards. PENALTY on SEA-D.Adams, Unnecessary Roughness, 15 yards.',
      actor: {
        name: 'R.Stevenson',
        summary: '14 Yard Rush',
        lines: ['12 Rushes - 61 Yards'],
      },
    }),
  },

  {
    // Defensive holding on an incomplete pass (no-play). Arrow starts at the
    // snap LOS (NE 45) and moves forward 5 yards to NE 40 (automatic 1st).
    id: 'pass-penalty-defensive-holding-incomplete-noplay',
    label: 'Incomplete pass — defensive holding (no play, enforced from LOS)',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'pass',
      direction: 'right',
      offenseTeam: 'NE',
      fromYardline: 45,
      fromSide: 'NE',
      toYardline: 36,
      toSide: 'NE',
      yardsGained: 0,
      isComplete: false,
      isNoPlay: true,
      penaltyTeam: 'SEA',
      penaltyType: 'Defensive Holding',
      penaltyYards: 5,
      // Enforced from LOS (NE 45) → 5 yards forward to NE 40
      penaltyAdjustedYardline: 40,
      penaltyAdjustedSide: 'NE',
      description:
        'D.Maye pass incomplete short right. PENALTY on SEA-T.Woolen, Defensive Holding, 5 yards, no play.',
      qbActor: {
        name: 'D.Maye',
        summary: 'Incomplete Pass',
        lines: ['18/32 Passing - 224 Yards'],
      },
    }),
  },

  {
    // Defensive pass interference on a complete pass (play stands, tack-on from catch).
    // Arrow starts at catch spot (SEA 22) and moves forward 15 yards to SEA 7.
    id: 'pass-penalty-dpi-complete-tackon',
    label: 'Complete pass — defensive PI (play stands, tacked on from catch)',
    awayAbbr: 'SEA',
    play: makePlay({
      type: 'pass',
      direction: 'left',
      offenseTeam: 'SEA',
      fromYardline: 38,
      fromSide: 'SEA',
      toYardline: 22,
      toSide: 'SEA',
      yardsGained: 16,
      isComplete: true,
      isNoPlay: false,
      penaltyTeam: 'NE',
      penaltyType: 'Defensive Pass Interference',
      penaltyYards: 15,
      // Tacked on from catch spot (SEA 22) → 15 yards forward to SEA 7
      penaltyAdjustedYardline: 7,
      penaltyAdjustedSide: 'SEA',
      description:
        'G.Smith pass short left to D.Metcalf for 16 yards. PENALTY on NE-J.Jones, Defensive Pass Interference, 15 yards.',
      actor: {
        name: 'D.Metcalf',
        summary: '16 Yard Catch',
        lines: ['5 Catches - 88 Yards'],
      },
      qbActor: {
        name: 'G.Smith',
        summary: '16 Yard Pass',
        lines: ['21/35 Passing - 287 Yards'],
      },
    }),
  },
];
