/**
 * Gridstream player directory domain helpers.
 *
 * Keeps list/filter/search logic framework-agnostic so web-next, Vue, Angular,
 * and Svelte frontends can reuse the same behavior.
 */

import { resolveGridstreamApiBase } from './api-transforms';

export const GRIDSTREAM_PLAYER_ROSTER_STATUSES = [
  'Active',
  'Injured Reserve',
  'Practice Squad',
  'Free Agent',
] as const;

export type GridstreamPlayerRosterStatus =
  | (typeof GRIDSTREAM_PLAYER_ROSTER_STATUSES)[number]
  | string;

export type GridstreamPlayerBrowseCriterion = 'team' | 'position' | 'draftYear' | 'season';
export type GridstreamSortDirection = 'asc' | 'desc';
export type GridstreamPlayerSortKey =
  | 'player'
  | 'team'
  | 'position'
  | 'age'
  | 'status'
  | 'draftYear'
  | 'seasons'
  | 'seasonsCount'
  | 'gamesPlayed'
  | 'passYards'
  | 'passYdsPerGame'
  | 'passTd'
  | 'interceptions'
  | 'completions'
  | 'passAttempts'
  | 'completionPct'
  | 'yardsPerAttempt'
  | 'passerRating'
  | 'sacksTaken'
  | 'rushYards'
  | 'rushYdsPerGame'
  | 'rushTd'
  | 'carries'
  | 'yardsPerCarry'
  | 'receptions'
  | 'targets'
  | 'catchPct'
  | 'recYards'
  | 'recYdsPerGame'
  | 'recTd'
  | 'yardsPerReception'
  | 'yardsPerTarget'
  | 'scrimmageYards'
  | 'totalTd'
  | 'tdPerGame'
  | 'longGain'
  | 'firstDowns'
  | 'fumbles'
  | 'fumblesLost'
  | 'tackles'
  | 'sacksMade'
  | 'defInterceptions'
  | 'passesDefended'
  | 'forcedFumbles'
  | 'fgMade'
  | 'fgAttempts'
  | 'punts';

export interface GridstreamPlayerSortState {
  key: GridstreamPlayerSortKey;
  direction: GridstreamSortDirection;
}

export type GridstreamPlayerTableColumnKey =
  | 'player'
  | 'team'
  | 'position'
  | 'age'
  | 'status'
  | 'draft'
  | 'draftYear'
  | 'seasons'
  | 'seasonsCount'
  | 'gamesPlayed'
  | 'starts'
  | 'offSnaps'
  | 'snapPct'
  | 'completions'
  | 'passAttempts'
  | 'completionPct'
  | 'passYards'
  | 'passYdsPerGame'
  | 'yardsPerAttempt'
  | 'passTd'
  | 'interceptions'
  | 'passerRating'
  | 'sacksTaken'
  | 'carries'
  | 'rushYards'
  | 'rushYdsPerGame'
  | 'yardsPerCarry'
  | 'rushTd'
  | 'receptions'
  | 'targets'
  | 'catchPct'
  | 'recYards'
  | 'recYdsPerGame'
  | 'yardsPerReception'
  | 'yardsPerTarget'
  | 'scrimmageYards'
  | 'totalTd'
  | 'tdPerGame'
  | 'longGain'
  | 'firstDowns'
  | 'fumbles'
  | 'fumblesLost'
  | 'tackles'
  | 'sacksMade'
  | 'defInterceptions'
  | 'passesDefended'
  | 'forcedFumbles'
  | 'fgMade'
  | 'fgAttempts'
  | 'punts'
  | 'recTd';

export interface GridstreamPlayerTableColumnOption {
  key: GridstreamPlayerTableColumnKey;
  label: string;
  defaultVisible: boolean;
  sortKey?: GridstreamPlayerSortKey;
}

export type GridstreamPlayerColumnCategoryKey =
  | 'identity'
  | 'passing'
  | 'rushing'
  | 'receiving'
  | 'scrimmage'
  | 'defense'
  | 'specialTeams';

export interface GridstreamPlayerColumnCategory {
  key: GridstreamPlayerColumnCategoryKey;
  label: string;
  columns: readonly GridstreamPlayerTableColumnKey[];
}

export const GRIDSTREAM_PLAYER_TABLE_COLUMNS: readonly GridstreamPlayerTableColumnOption[] = [
  { key: 'player', label: 'Player', defaultVisible: true, sortKey: 'player' },
  { key: 'team', label: 'Team', defaultVisible: true, sortKey: 'team' },
  { key: 'position', label: 'Pos', defaultVisible: true, sortKey: 'position' },
  { key: 'age', label: 'Age', defaultVisible: true, sortKey: 'age' },
  { key: 'status', label: 'Status', defaultVisible: true, sortKey: 'status' },
  { key: 'draft', label: 'Draft', defaultVisible: true, sortKey: 'draftYear' },
  { key: 'draftYear', label: 'Draft Year', defaultVisible: false, sortKey: 'draftYear' },
  { key: 'seasons', label: 'Seasons', defaultVisible: true, sortKey: 'seasons' },
  { key: 'seasonsCount', label: 'Seasons Cnt', defaultVisible: false, sortKey: 'seasonsCount' },
  { key: 'gamesPlayed', label: 'Games', defaultVisible: true, sortKey: 'gamesPlayed' },
  { key: 'starts', label: 'Starts', defaultVisible: false },
  { key: 'offSnaps', label: 'Off Snaps', defaultVisible: false },
  { key: 'snapPct', label: 'Snap %', defaultVisible: false },
  { key: 'completions', label: 'Pass Comp', defaultVisible: false, sortKey: 'completions' },
  { key: 'passAttempts', label: 'Pass Att', defaultVisible: false, sortKey: 'passAttempts' },
  { key: 'completionPct', label: 'Comp %', defaultVisible: false, sortKey: 'completionPct' },
  { key: 'passYards', label: 'Pass Yds', defaultVisible: false, sortKey: 'passYards' },
  { key: 'passYdsPerGame', label: 'Pass Yds/G', defaultVisible: false, sortKey: 'passYdsPerGame' },
  { key: 'yardsPerAttempt', label: 'Y/A', defaultVisible: false, sortKey: 'yardsPerAttempt' },
  { key: 'passTd', label: 'Pass TD', defaultVisible: false, sortKey: 'passTd' },
  { key: 'interceptions', label: 'INT', defaultVisible: false, sortKey: 'interceptions' },
  { key: 'passerRating', label: 'Passer RTG', defaultVisible: false, sortKey: 'passerRating' },
  { key: 'sacksTaken', label: 'Sacks Taken', defaultVisible: false, sortKey: 'sacksTaken' },
  { key: 'carries', label: 'Carries', defaultVisible: false, sortKey: 'carries' },
  { key: 'rushYards', label: 'Rush Yds', defaultVisible: false, sortKey: 'rushYards' },
  { key: 'rushYdsPerGame', label: 'Rush Yds/G', defaultVisible: false, sortKey: 'rushYdsPerGame' },
  { key: 'yardsPerCarry', label: 'Yds/Carry', defaultVisible: false, sortKey: 'yardsPerCarry' },
  { key: 'rushTd', label: 'Rush TD', defaultVisible: false, sortKey: 'rushTd' },
  { key: 'targets', label: 'Targets', defaultVisible: false, sortKey: 'targets' },
  { key: 'receptions', label: 'Rec', defaultVisible: false, sortKey: 'receptions' },
  { key: 'catchPct', label: 'Catch %', defaultVisible: false, sortKey: 'catchPct' },
  { key: 'recYards', label: 'Rec Yds', defaultVisible: false, sortKey: 'recYards' },
  { key: 'recYdsPerGame', label: 'Rec Yds/G', defaultVisible: false, sortKey: 'recYdsPerGame' },
  {
    key: 'yardsPerReception',
    label: 'Yds/Rec',
    defaultVisible: false,
    sortKey: 'yardsPerReception',
  },
  { key: 'yardsPerTarget', label: 'Yds/Tgt', defaultVisible: false, sortKey: 'yardsPerTarget' },
  { key: 'recTd', label: 'Rec TD', defaultVisible: false, sortKey: 'recTd' },
  { key: 'scrimmageYards', label: 'Scrim Yds', defaultVisible: false, sortKey: 'scrimmageYards' },
  { key: 'totalTd', label: 'Total TD', defaultVisible: false, sortKey: 'totalTd' },
  { key: 'tdPerGame', label: 'TD/G', defaultVisible: false, sortKey: 'tdPerGame' },
  { key: 'longGain', label: 'Long', defaultVisible: false, sortKey: 'longGain' },
  { key: 'firstDowns', label: '1st Downs', defaultVisible: false, sortKey: 'firstDowns' },
  { key: 'fumbles', label: 'Fumbles', defaultVisible: false, sortKey: 'fumbles' },
  { key: 'fumblesLost', label: 'Fum Lost', defaultVisible: false, sortKey: 'fumblesLost' },
  { key: 'tackles', label: 'Tackles', defaultVisible: false, sortKey: 'tackles' },
  { key: 'sacksMade', label: 'Def Sacks', defaultVisible: false, sortKey: 'sacksMade' },
  { key: 'defInterceptions', label: 'Def INT', defaultVisible: false, sortKey: 'defInterceptions' },
  { key: 'passesDefended', label: 'Pass Def', defaultVisible: false, sortKey: 'passesDefended' },
  { key: 'forcedFumbles', label: 'Forced Fum', defaultVisible: false, sortKey: 'forcedFumbles' },
  { key: 'fgMade', label: 'FG Made', defaultVisible: false, sortKey: 'fgMade' },
  { key: 'fgAttempts', label: 'FG Att', defaultVisible: false, sortKey: 'fgAttempts' },
  { key: 'punts', label: 'Punts', defaultVisible: false, sortKey: 'punts' },
] as const;

export const GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS: GridstreamPlayerTableColumnKey[] =
  GRIDSTREAM_PLAYER_TABLE_COLUMNS.filter((column) => column.defaultVisible).map(
    (column) => column.key
  );

export const GRIDSTREAM_PLAYER_COLUMN_CATEGORIES: readonly GridstreamPlayerColumnCategory[] = [
  {
    key: 'identity',
    label: 'Player Info',
    columns: [
      'player',
      'team',
      'position',
      'age',
      'status',
      'draft',
      'draftYear',
      'seasons',
      'seasonsCount',
      'gamesPlayed',
      'starts',
      'offSnaps',
      'snapPct',
    ],
  },
  {
    key: 'passing',
    label: 'Passing',
    columns: [
      'completions',
      'passAttempts',
      'completionPct',
      'passYards',
      'passYdsPerGame',
      'yardsPerAttempt',
      'passTd',
      'interceptions',
      'passerRating',
      'sacksTaken',
    ],
  },
  {
    key: 'rushing',
    label: 'Rushing',
    columns: ['carries', 'rushYards', 'rushYdsPerGame', 'yardsPerCarry', 'rushTd'],
  },
  {
    key: 'receiving',
    label: 'Receiving',
    columns: [
      'targets',
      'receptions',
      'catchPct',
      'recYards',
      'recYdsPerGame',
      'yardsPerReception',
      'yardsPerTarget',
      'recTd',
    ],
  },
  {
    key: 'scrimmage',
    label: 'Scoring + Ball Security',
    columns: [
      'scrimmageYards',
      'totalTd',
      'tdPerGame',
      'longGain',
      'firstDowns',
      'fumbles',
      'fumblesLost',
    ],
  },
  {
    key: 'defense',
    label: 'Defense',
    columns: ['tackles', 'sacksMade', 'defInterceptions', 'passesDefended', 'forcedFumbles'],
  },
  {
    key: 'specialTeams',
    label: 'Special Teams',
    columns: ['fgMade', 'fgAttempts', 'punts'],
  },
] as const;

const GRIDSTREAM_PLAYER_QB_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'passAttempts',
  'completions',
  'completionPct',
  'passYards',
  'passYdsPerGame',
  'yardsPerAttempt',
  'passTd',
  'interceptions',
  'passerRating',
  'sacksTaken',
  'rushYards',
  'rushTd',
];

const GRIDSTREAM_PLAYER_RB_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'carries',
  'rushYards',
  'yardsPerCarry',
  'rushTd',
  'targets',
  'receptions',
  'catchPct',
  'recYards',
  'yardsPerReception',
  'recTd',
  'scrimmageYards',
  'totalTd',
];

const GRIDSTREAM_PLAYER_RECEIVER_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'targets',
  'receptions',
  'catchPct',
  'recYards',
  'yardsPerReception',
  'yardsPerTarget',
  'recTd',
  'longGain',
  'firstDowns',
  'scrimmageYards',
  'totalTd',
];

const GRIDSTREAM_PLAYER_DEFENSIVE_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'tackles',
  'sacksMade',
  'defInterceptions',
  'passesDefended',
  'forcedFumbles',
  'fumbles',
  'fumblesLost',
];

const GRIDSTREAM_PLAYER_KICKER_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'fgMade',
  'fgAttempts',
];

const GRIDSTREAM_PLAYER_PUNTER_COLUMNS: GridstreamPlayerTableColumnKey[] = [
  'player',
  'team',
  'position',
  'age',
  'gamesPlayed',
  'punts',
];

export interface GridstreamPlayerSummary {
  id: string;
  slug: string;
  displayName: string;
  shortName: string;
  teamAbbr: string;
  position: string;
  positionGroup: string;
  jerseyNumber?: string;
  age: number | null;
  college?: string;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  seasonsPlayed: number[];
  gamesPlayed: number;
  gamesStarted?: number | null;
  offensiveSnaps?: number | null;
  snapPct?: number | null;
  seasonsCount?: number;
  passCompletions?: number;
  passAttempts?: number;
  completionPct?: number;
  passingYards?: number;
  passingYardsPerGame?: number;
  yardsPerAttempt?: number;
  passingTds?: number;
  interceptionsThrown?: number;
  passerRating?: number;
  sacksTaken?: number;
  carries?: number;
  rushingYards?: number;
  rushingYardsPerGame?: number;
  yardsPerCarry?: number;
  rushingTds?: number;
  receptions?: number;
  targets?: number;
  catchPct?: number;
  receivingYards?: number;
  receivingYardsPerGame?: number;
  yardsPerReception?: number;
  yardsPerTarget?: number;
  receivingTds?: number;
  scrimmageYards?: number;
  totalTouchdowns?: number;
  touchdownsPerGame?: number;
  longGain?: number;
  firstDowns?: number;
  fumbles?: number;
  fumblesLost?: number;
  tacklesTotal?: number;
  sacksMade?: number;
  interceptionsCaught?: number;
  passesDefended?: number;
  forcedFumbles?: number;
  fieldGoalsMade?: number;
  fieldGoalsAttempted?: number;
  puntAttempts?: number;
  rosterStatus: GridstreamPlayerRosterStatus;
  isActive?: boolean;
}

export interface GridstreamPlayerFilterState {
  search: string;
  team: string | null;
  teamNot: string | null;
  position: string | null;
  draftYear: string | null;
  season: string | null;
  statsSeason: number | null;
  statsWeek: number | null;
  rosterStatus: GridstreamPlayerRosterStatus | null;
  isActive: boolean | null;
}

export interface GridstreamPlayerBucket {
  criterion: GridstreamPlayerBrowseCriterion;
  key: string;
  label: string;
  count: number;
}

const GRIDSTREAM_POSITION_FILTER_ALIASES: Record<string, readonly string[]> = {
  T: ['T', 'OT', 'LT', 'RT', 'OL'],
  G: ['G', 'OG', 'LG', 'RG', 'OL'],
  C: ['C', 'OL'],
  OL: ['OL', 'T', 'OT', 'LT', 'RT', 'G', 'OG', 'LG', 'RG', 'C'],
  DL: ['DL', 'DE', 'DT', 'NT', 'EDGE'],
  LB: ['LB', 'OLB', 'ILB', 'MLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
  S: ['S', 'FS', 'SS'],
  DE: ['DE', 'EDGE'],
  EDGE: ['EDGE', 'DE'],
};

const collator = new Intl.Collator('en', { sensitivity: 'base' });
const UNDRAFTED_KEY = 'UNDRAFTED';

function seasonRange(start: number, end: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export const DEFAULT_GRIDSTREAM_PLAYER_FILTERS: GridstreamPlayerFilterState = {
  search: '',
  team: null,
  teamNot: null,
  position: null,
  draftYear: null,
  season: null,
  statsSeason: null,
  statsWeek: null,
  rosterStatus: null,
  isActive: true,
};

export const GRIDSTREAM_PLAYERS_MOCK_DATA: GridstreamPlayerSummary[] = [
  {
    id: '00-0033873',
    slug: 'josh-allen',
    displayName: 'Josh Allen',
    shortName: 'J. Allen',
    teamAbbr: 'BUF',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '17',
    age: 29,
    college: 'Wyoming',
    draftYear: 2018,
    draftRound: 1,
    draftPick: 7,
    seasonsPlayed: seasonRange(2018, 2025),
    gamesPlayed: 111,
    rosterStatus: 'Active',
  },
  {
    id: '00-0033873b',
    slug: 'patrick-mahomes',
    displayName: 'Patrick Mahomes',
    shortName: 'P. Mahomes',
    teamAbbr: 'KC',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '15',
    age: 30,
    college: 'Texas Tech',
    draftYear: 2017,
    draftRound: 1,
    draftPick: 10,
    seasonsPlayed: seasonRange(2017, 2025),
    gamesPlayed: 129,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034796',
    slug: 'lamar-jackson',
    displayName: 'Lamar Jackson',
    shortName: 'L. Jackson',
    teamAbbr: 'BAL',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '8',
    age: 29,
    college: 'Louisville',
    draftYear: 2018,
    draftRound: 1,
    draftPick: 32,
    seasonsPlayed: seasonRange(2018, 2025),
    gamesPlayed: 103,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036442',
    slug: 'joe-burrow',
    displayName: 'Joe Burrow',
    shortName: 'J. Burrow',
    teamAbbr: 'CIN',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '9',
    age: 30,
    college: 'LSU',
    draftYear: 2020,
    draftRound: 1,
    draftPick: 1,
    seasonsPlayed: seasonRange(2020, 2025),
    gamesPlayed: 73,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038122',
    slug: 'cj-stroud',
    displayName: 'C.J. Stroud',
    shortName: 'C. Stroud',
    teamAbbr: 'HOU',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '7',
    age: 24,
    college: 'Ohio State',
    draftYear: 2023,
    draftRound: 1,
    draftPick: 2,
    seasonsPlayed: seasonRange(2023, 2025),
    gamesPlayed: 34,
    rosterStatus: 'Active',
  },
  {
    id: '00-0037644',
    slug: 'brock-purdy',
    displayName: 'Brock Purdy',
    shortName: 'B. Purdy',
    teamAbbr: 'SF',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '13',
    age: 26,
    college: 'Iowa State',
    draftYear: 2022,
    draftRound: 7,
    draftPick: 262,
    seasonsPlayed: seasonRange(2022, 2025),
    gamesPlayed: 49,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036945',
    slug: 'jordan-love',
    displayName: 'Jordan Love',
    shortName: 'J. Love',
    teamAbbr: 'GB',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '10',
    age: 27,
    college: 'Utah State',
    draftYear: 2020,
    draftRound: 1,
    draftPick: 26,
    seasonsPlayed: seasonRange(2020, 2025),
    gamesPlayed: 55,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034975',
    slug: 'saquon-barkley',
    displayName: 'Saquon Barkley',
    shortName: 'S. Barkley',
    teamAbbr: 'PHI',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '26',
    age: 29,
    college: 'Penn State',
    draftYear: 2018,
    draftRound: 1,
    draftPick: 2,
    seasonsPlayed: seasonRange(2018, 2025),
    gamesPlayed: 102,
    rosterStatus: 'Active',
  },
  {
    id: '00-0033280',
    slug: 'christian-mccaffrey',
    displayName: 'Christian McCaffrey',
    shortName: 'C. McCaffrey',
    teamAbbr: 'SF',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '23',
    age: 30,
    college: 'Stanford',
    draftYear: 2017,
    draftRound: 1,
    draftPick: 8,
    seasonsPlayed: seasonRange(2017, 2025),
    gamesPlayed: 111,
    rosterStatus: 'Injured Reserve',
  },
  {
    id: '00-0037268',
    slug: 'bijan-robinson',
    displayName: 'Bijan Robinson',
    shortName: 'B. Robinson',
    teamAbbr: 'ATL',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '7',
    age: 24,
    college: 'Texas',
    draftYear: 2023,
    draftRound: 1,
    draftPick: 8,
    seasonsPlayed: seasonRange(2023, 2025),
    gamesPlayed: 34,
    rosterStatus: 'Active',
  },
  {
    id: '00-0032764',
    slug: 'derrick-henry',
    displayName: 'Derrick Henry',
    shortName: 'D. Henry',
    teamAbbr: 'BAL',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '22',
    age: 32,
    college: 'Alabama',
    draftYear: 2016,
    draftRound: 2,
    draftPick: 45,
    seasonsPlayed: seasonRange(2016, 2025),
    gamesPlayed: 143,
    rosterStatus: 'Active',
  },
  {
    id: '00-0037435',
    slug: 'devon-achane',
    displayName: "De'Von Achane",
    shortName: 'D. Achane',
    teamAbbr: 'MIA',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '28',
    age: 25,
    college: 'Texas A&M',
    draftYear: 2023,
    draftRound: 3,
    draftPick: 84,
    seasonsPlayed: seasonRange(2023, 2025),
    gamesPlayed: 28,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036947',
    slug: 'kenneth-walker',
    displayName: 'Kenneth Walker III',
    shortName: 'K. Walker III',
    teamAbbr: 'SEA',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '9',
    age: 25,
    college: 'Michigan State',
    draftYear: 2022,
    draftRound: 2,
    draftPick: 41,
    seasonsPlayed: seasonRange(2022, 2025),
    gamesPlayed: 50,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038130',
    slug: 'isiah-pacheco',
    displayName: 'Isiah Pacheco',
    shortName: 'I. Pacheco',
    teamAbbr: 'KC',
    position: 'RB',
    positionGroup: 'RB',
    jerseyNumber: '10',
    age: 27,
    college: 'Rutgers',
    draftYear: 2022,
    draftRound: 7,
    draftPick: 251,
    seasonsPlayed: seasonRange(2022, 2025),
    gamesPlayed: 47,
    rosterStatus: 'Practice Squad',
  },
  {
    id: '00-0036892',
    slug: 'jamarr-chase',
    displayName: "Ja'Marr Chase",
    shortName: 'J. Chase',
    teamAbbr: 'CIN',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '1',
    age: 26,
    college: 'LSU',
    draftYear: 2021,
    draftRound: 1,
    draftPick: 5,
    seasonsPlayed: seasonRange(2021, 2025),
    gamesPlayed: 66,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036326',
    slug: 'justin-jefferson',
    displayName: 'Justin Jefferson',
    shortName: 'J. Jefferson',
    teamAbbr: 'MIN',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '18',
    age: 27,
    college: 'LSU',
    draftYear: 2020,
    draftRound: 1,
    draftPick: 22,
    seasonsPlayed: seasonRange(2020, 2025),
    gamesPlayed: 74,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036350',
    slug: 'ceedee-lamb',
    displayName: 'CeeDee Lamb',
    shortName: 'C. Lamb',
    teamAbbr: 'DAL',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '88',
    age: 27,
    college: 'Oklahoma',
    draftYear: 2020,
    draftRound: 1,
    draftPick: 17,
    seasonsPlayed: seasonRange(2020, 2025),
    gamesPlayed: 81,
    rosterStatus: 'Active',
  },
  {
    id: '00-0033040',
    slug: 'tyreek-hill',
    displayName: 'Tyreek Hill',
    shortName: 'T. Hill',
    teamAbbr: 'MIA',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '10',
    age: 32,
    college: 'West Alabama',
    draftYear: 2016,
    draftRound: 5,
    draftPick: 165,
    seasonsPlayed: seasonRange(2016, 2025),
    gamesPlayed: 142,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036963',
    slug: 'amonra-st-brown',
    displayName: 'Amon-Ra St. Brown',
    shortName: 'A. St. Brown',
    teamAbbr: 'DET',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '14',
    age: 26,
    college: 'USC',
    draftYear: 2021,
    draftRound: 4,
    draftPick: 112,
    seasonsPlayed: seasonRange(2021, 2025),
    gamesPlayed: 67,
    rosterStatus: 'Active',
  },
  {
    id: '00-0037801',
    slug: 'puka-nacua',
    displayName: 'Puka Nacua',
    shortName: 'P. Nacua',
    teamAbbr: 'LAR',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '17',
    age: 25,
    college: 'BYU',
    draftYear: 2023,
    draftRound: 5,
    draftPick: 177,
    seasonsPlayed: seasonRange(2023, 2025),
    gamesPlayed: 32,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038178',
    slug: 'marvin-harrison-jr',
    displayName: 'Marvin Harrison Jr.',
    shortName: 'M. Harrison Jr.',
    teamAbbr: 'ARI',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '18',
    age: 24,
    college: 'Ohio State',
    draftYear: 2024,
    draftRound: 1,
    draftPick: 4,
    seasonsPlayed: seasonRange(2024, 2025),
    gamesPlayed: 17,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038179',
    slug: 'malik-nabers',
    displayName: 'Malik Nabers',
    shortName: 'M. Nabers',
    teamAbbr: 'NYG',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '1',
    age: 23,
    college: 'LSU',
    draftYear: 2024,
    draftRound: 1,
    draftPick: 6,
    seasonsPlayed: seasonRange(2024, 2025),
    gamesPlayed: 17,
    rosterStatus: 'Active',
  },
  {
    id: '00-0033134',
    slug: 'travis-kelce',
    displayName: 'Travis Kelce',
    shortName: 'T. Kelce',
    teamAbbr: 'KC',
    position: 'TE',
    positionGroup: 'TE',
    jerseyNumber: '87',
    age: 36,
    college: 'Cincinnati',
    draftYear: 2013,
    draftRound: 3,
    draftPick: 63,
    seasonsPlayed: seasonRange(2013, 2025),
    gamesPlayed: 176,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038128',
    slug: 'sam-laporta',
    displayName: 'Sam LaPorta',
    shortName: 'S. LaPorta',
    teamAbbr: 'DET',
    position: 'TE',
    positionGroup: 'TE',
    jerseyNumber: '87',
    age: 24,
    college: 'Iowa',
    draftYear: 2023,
    draftRound: 2,
    draftPick: 34,
    seasonsPlayed: seasonRange(2023, 2025),
    gamesPlayed: 34,
    rosterStatus: 'Active',
  },
  {
    id: '00-0038180',
    slug: 'brock-bowers',
    displayName: 'Brock Bowers',
    shortName: 'B. Bowers',
    teamAbbr: 'LV',
    position: 'TE',
    positionGroup: 'TE',
    jerseyNumber: '89',
    age: 23,
    college: 'Georgia',
    draftYear: 2024,
    draftRound: 1,
    draftPick: 13,
    seasonsPlayed: seasonRange(2024, 2025),
    gamesPlayed: 17,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034978',
    slug: 'myles-garrett',
    displayName: 'Myles Garrett',
    shortName: 'M. Garrett',
    teamAbbr: 'CLE',
    position: 'EDGE',
    positionGroup: 'DL',
    jerseyNumber: '95',
    age: 30,
    college: 'Texas A&M',
    draftYear: 2017,
    draftRound: 1,
    draftPick: 1,
    seasonsPlayed: seasonRange(2017, 2025),
    gamesPlayed: 128,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036899',
    slug: 'micah-parsons',
    displayName: 'Micah Parsons',
    shortName: 'M. Parsons',
    teamAbbr: 'DAL',
    position: 'EDGE',
    positionGroup: 'DL',
    jerseyNumber: '11',
    age: 27,
    college: 'Penn State',
    draftYear: 2021,
    draftRound: 1,
    draftPick: 12,
    seasonsPlayed: seasonRange(2021, 2025),
    gamesPlayed: 68,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034347',
    slug: 'tj-watt',
    displayName: 'T.J. Watt',
    shortName: 'T. Watt',
    teamAbbr: 'PIT',
    position: 'EDGE',
    positionGroup: 'DL',
    jerseyNumber: '90',
    age: 31,
    college: 'Wisconsin',
    draftYear: 2017,
    draftRound: 1,
    draftPick: 30,
    seasonsPlayed: seasonRange(2017, 2025),
    gamesPlayed: 119,
    rosterStatus: 'Injured Reserve',
  },
  {
    id: '00-0034798',
    slug: 'roquan-smith',
    displayName: 'Roquan Smith',
    shortName: 'R. Smith',
    teamAbbr: 'BAL',
    position: 'LB',
    positionGroup: 'LB',
    jerseyNumber: '0',
    age: 29,
    college: 'Georgia',
    draftYear: 2018,
    draftRound: 1,
    draftPick: 8,
    seasonsPlayed: seasonRange(2018, 2025),
    gamesPlayed: 120,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036972',
    slug: 'sauce-gardner',
    displayName: 'Sauce Gardner',
    shortName: 'S. Gardner',
    teamAbbr: 'NYJ',
    position: 'CB',
    positionGroup: 'DB',
    jerseyNumber: '1',
    age: 25,
    college: 'Cincinnati',
    draftYear: 2022,
    draftRound: 1,
    draftPick: 4,
    seasonsPlayed: seasonRange(2022, 2025),
    gamesPlayed: 50,
    rosterStatus: 'Active',
  },
  {
    id: '00-0036934',
    slug: 'trent-mcduffie',
    displayName: 'Trent McDuffie',
    shortName: 'T. McDuffie',
    teamAbbr: 'KC',
    position: 'CB',
    positionGroup: 'DB',
    jerseyNumber: '22',
    age: 25,
    college: 'Washington',
    draftYear: 2022,
    draftRound: 1,
    draftPick: 21,
    seasonsPlayed: seasonRange(2022, 2025),
    gamesPlayed: 52,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034792',
    slug: 'jessie-bates',
    displayName: 'Jessie Bates III',
    shortName: 'J. Bates III',
    teamAbbr: 'ATL',
    position: 'S',
    positionGroup: 'DB',
    jerseyNumber: '3',
    age: 29,
    college: 'Wake Forest',
    draftYear: 2018,
    draftRound: 2,
    draftPick: 54,
    seasonsPlayed: seasonRange(2018, 2025),
    gamesPlayed: 124,
    rosterStatus: 'Active',
  },
  {
    id: '00-0031234',
    slug: 'geno-smith',
    displayName: 'Geno Smith',
    shortName: 'G. Smith',
    teamAbbr: 'SEA',
    position: 'QB',
    positionGroup: 'QB',
    jerseyNumber: '7',
    age: 35,
    college: 'West Virginia',
    draftYear: 2013,
    draftRound: 2,
    draftPick: 39,
    seasonsPlayed: seasonRange(2013, 2025),
    gamesPlayed: 108,
    rosterStatus: 'Active',
  },
  {
    id: '00-0034567',
    slug: 'cooper-kupp',
    displayName: 'Cooper Kupp',
    shortName: 'C. Kupp',
    teamAbbr: 'LAR',
    position: 'WR',
    positionGroup: 'WR',
    jerseyNumber: '10',
    age: 33,
    college: 'Eastern Washington',
    draftYear: 2017,
    draftRound: 3,
    draftPick: 69,
    seasonsPlayed: seasonRange(2017, 2025),
    gamesPlayed: 112,
    rosterStatus: 'Free Agent',
  },
];

function normalizeString(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeUpper(value: string | null | undefined): string {
  return normalizeString(value).toUpperCase();
}

function normalizeSearch(value: string | null | undefined): string {
  return normalizeString(value).toLowerCase();
}

function splitCommaTokens(value: string | null | undefined): string[] {
  return normalizeString(value)
    .split(',')
    .map((token) => normalizeString(token))
    .filter(Boolean);
}

function normalizeUpperTokenList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of splitCommaTokens(value)) {
    const normalized = normalizeUpper(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(normalized);
  }
  return tokens;
}

function normalizeUpperTokenListParam(value: string | null | undefined): string | null {
  const tokens = normalizeUpperTokenList(value);
  return tokens.length > 0 ? tokens.join(',') : null;
}

function parseNumericTokens(value: string | number | null | undefined): number[] {
  const seen = new Set<number>();
  const tokens: number[] = [];
  for (const rawToken of splitCommaTokens(value == null ? null : String(value))) {
    const parsed = toSafeInt(rawToken);
    if (parsed == null || seen.has(parsed)) continue;
    seen.add(parsed);
    tokens.push(parsed);
  }
  return tokens;
}

function normalizeNumericTokenListParam(value: string | number | null | undefined): string | null {
  const tokens = parseNumericTokens(value);
  return tokens.length > 0 ? tokens.join(',') : null;
}

function normalizeRosterStatusForCompare(value: string | null | undefined): string {
  return normalizeString(value).toLowerCase().replace(/\s+/g, ' ');
}

function rosterStatusTokensFromFilter(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of splitCommaTokens(value)) {
    const label = rosterStatusLabelFromCode(rawToken) || rawToken;
    const normalizedLabel = normalizeString(label);
    const compareKey = normalizeRosterStatusForCompare(normalizedLabel);
    if (!compareKey || seen.has(compareKey)) continue;
    seen.add(compareKey);
    tokens.push(normalizedLabel);
  }
  return tokens;
}

function rosterStatusApiValueFromFilter(value: string | null | undefined): string | null {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const token of splitCommaTokens(value)) {
    const code = rosterStatusCodeFromLabel(token) ?? normalizeUpper(token);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes.length > 0 ? codes.join(',') : null;
}

function isInactiveRosterStatusToken(value: string): boolean {
  const token = normalizeRosterStatusForCompare(value);
  return (
    token === 'inactive' ||
    token === 'ina' ||
    token === 'retired' ||
    token === 'ret' ||
    token === 'released' ||
    token === 'cut'
  );
}

function expandPositionFilterValues(value: string | null | undefined): string[] {
  const token = normalizeUpper(value);
  if (!token) return [];
  return Array.from(new Set(GRIDSTREAM_POSITION_FILTER_ALIASES[token] ?? [token]));
}

export function expandGridstreamPositionFilterValues(value: string | null | undefined): string[] {
  return expandPositionFilterValues(value);
}

function toSafeInt(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const GRIDSTREAM_PLAYER_SORT_KEYS: readonly GridstreamPlayerSortKey[] = [
  'player',
  'team',
  'position',
  'age',
  'status',
  'draftYear',
  'seasons',
  'seasonsCount',
  'gamesPlayed',
  'completions',
  'passAttempts',
  'completionPct',
  'passYards',
  'passYdsPerGame',
  'yardsPerAttempt',
  'passTd',
  'interceptions',
  'passerRating',
  'sacksTaken',
  'carries',
  'rushYards',
  'rushYdsPerGame',
  'yardsPerCarry',
  'rushTd',
  'receptions',
  'targets',
  'catchPct',
  'recYards',
  'recYdsPerGame',
  'yardsPerReception',
  'yardsPerTarget',
  'recTd',
  'scrimmageYards',
  'totalTd',
  'tdPerGame',
  'longGain',
  'firstDowns',
  'fumbles',
  'fumblesLost',
  'tackles',
  'sacksMade',
  'defInterceptions',
  'passesDefended',
  'forcedFumbles',
  'fgMade',
  'fgAttempts',
  'punts',
];

const GRIDSTREAM_PLAYER_SORT_KEY_SET = new Set<string>(GRIDSTREAM_PLAYER_SORT_KEYS);
const GRIDSTREAM_PLAYER_TABLE_COLUMN_KEY_SET = new Set<string>(
  GRIDSTREAM_PLAYER_TABLE_COLUMNS.map((column) => column.key)
);

function parseSortKey(value: string | null | undefined): GridstreamPlayerSortKey | null {
  const normalized = normalizeString(value);
  if (!normalized || !GRIDSTREAM_PLAYER_SORT_KEY_SET.has(normalized)) return null;
  return normalized as GridstreamPlayerSortKey;
}

function parseSortDirection(value: string | null | undefined): GridstreamSortDirection | null {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'asc' || normalized === 'desc') return normalized;
  return null;
}

function latestSeasonPlayed(player: GridstreamPlayerSummary): number | null {
  if (!player.seasonsPlayed.length) return null;
  return Math.max(...player.seasonsPlayed);
}

function compareNullableNumbers(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: GridstreamSortDirection
): number {
  const aNum = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const bNum = typeof b === 'number' && Number.isFinite(b) ? b : null;
  if (aNum == null && bNum == null) return 0;
  if (aNum == null) return 1;
  if (bNum == null) return -1;
  return direction === 'asc' ? aNum - bNum : bNum - aNum;
}

function compareNullableStrings(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: GridstreamSortDirection
): number {
  const aValue = normalizeString(a);
  const bValue = normalizeString(b);
  if (!aValue && !bValue) return 0;
  if (!aValue) return 1;
  if (!bValue) return -1;
  return direction === 'asc' ? collator.compare(aValue, bValue) : collator.compare(bValue, aValue);
}

function compareTeams(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: GridstreamSortDirection
): number {
  const aValue = normalizeUpper(a);
  const bValue = normalizeUpper(b);
  const aIsFa = aValue === 'FA';
  const bIsFa = bValue === 'FA';
  if (aIsFa && !bIsFa) return 1;
  if (!aIsFa && bIsFa) return -1;
  return direction === 'asc' ? collator.compare(aValue, bValue) : collator.compare(bValue, aValue);
}

function divideOrNull(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  multiplier = 1
): number | null {
  const num = typeof numerator === 'number' && Number.isFinite(numerator) ? numerator : null;
  const den = typeof denominator === 'number' && Number.isFinite(denominator) ? denominator : null;
  if (num == null || den == null || den <= 0) return null;
  return (num * multiplier) / den;
}

function playerSearchText(player: GridstreamPlayerSummary): string {
  const draft = player.draftYear ? String(player.draftYear) : 'undrafted';
  const seasons = player.seasonsPlayed.join(' ');
  return [
    player.displayName,
    player.shortName,
    player.teamAbbr,
    player.position,
    player.positionGroup,
    player.college ?? '',
    player.rosterStatus,
    draft,
    seasons,
  ]
    .join(' ')
    .toLowerCase();
}

export function listGridstreamPlayerTeams(players: readonly GridstreamPlayerSummary[]): string[] {
  return Array.from(new Set(players.map((player) => player.teamAbbr))).sort((a, b) =>
    collator.compare(a, b)
  );
}

export function listGridstreamPlayerPositions(
  players: readonly GridstreamPlayerSummary[]
): string[] {
  return Array.from(new Set(players.map((player) => player.position))).sort((a, b) =>
    collator.compare(a, b)
  );
}

export function listGridstreamPlayerDraftYears(
  players: readonly GridstreamPlayerSummary[]
): number[] {
  return Array.from(
    new Set(players.flatMap((player) => (player.draftYear != null ? [player.draftYear] : [])))
  ).sort((a, b) => b - a);
}

export function listGridstreamPlayerSeasons(players: readonly GridstreamPlayerSummary[]): number[] {
  return Array.from(new Set(players.flatMap((player) => player.seasonsPlayed))).sort(
    (a, b) => b - a
  );
}

export function formatGridstreamDraftLabel(player: GridstreamPlayerSummary): string {
  if (player.draftYear == null || player.draftRound == null || player.draftPick == null) {
    return 'Undrafted';
  }
  return `${player.draftYear} · R${player.draftRound} · P${player.draftPick}`;
}

export function formatGridstreamSeasonRange(seasons: readonly number[]): string {
  if (seasons.length === 0) return '—';
  const min = Math.min(...seasons);
  const max = Math.max(...seasons);
  if (min === max) return String(min);
  return `${min}-${max}`;
}

export function toGridstreamPlayerRouteId(player: GridstreamPlayerSummary): string {
  // Use numeric DB id so the detail page can resolve the player via API.
  // Slug-only routing breaks API lookup since the detail page requires a numeric id.
  return player.id;
}

export function findGridstreamPlayerByRouteId(
  players: readonly GridstreamPlayerSummary[],
  routeId: string | null | undefined
): GridstreamPlayerSummary | null {
  const normalized = normalizeString(routeId).toLowerCase();
  if (!normalized) return null;
  const match = players.find(
    (player) => player.id.toLowerCase() === normalized || player.slug.toLowerCase() === normalized
  );
  return match ?? null;
}

export function recommendedGridstreamPlayerColumns(
  position: string | null | undefined
): GridstreamPlayerTableColumnKey[] {
  const normalized = normalizeUpper(position);
  if (normalized === 'QB') {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_QB_COLUMNS);
  }
  if (normalized === 'RB' || normalized === 'FB') {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_RB_COLUMNS);
  }
  if (normalized === 'WR' || normalized === 'TE') {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_RECEIVER_COLUMNS);
  }
  if (
    normalized === 'DL' ||
    normalized === 'DE' ||
    normalized === 'DT' ||
    normalized === 'NT' ||
    normalized === 'EDGE' ||
    normalized === 'LB' ||
    normalized === 'ILB' ||
    normalized === 'MLB' ||
    normalized === 'OLB' ||
    normalized === 'CB' ||
    normalized === 'S' ||
    normalized === 'FS' ||
    normalized === 'SS' ||
    normalized === 'DB'
  ) {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_DEFENSIVE_COLUMNS);
  }
  if (normalized === 'K') {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_KICKER_COLUMNS);
  }
  if (normalized === 'P') {
    return sanitizeGridstreamPlayerTableColumns(GRIDSTREAM_PLAYER_PUNTER_COLUMNS);
  }
  return [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS];
}

export function defaultGridstreamSortDirectionForKey(
  key: GridstreamPlayerSortKey
): GridstreamSortDirection {
  if (
    key === 'age' ||
    key === 'draftYear' ||
    key === 'seasons' ||
    key === 'seasonsCount' ||
    key === 'gamesPlayed' ||
    key === 'completions' ||
    key === 'passAttempts' ||
    key === 'completionPct' ||
    key === 'passYards' ||
    key === 'passYdsPerGame' ||
    key === 'yardsPerAttempt' ||
    key === 'passTd' ||
    key === 'interceptions' ||
    key === 'passerRating' ||
    key === 'sacksTaken' ||
    key === 'carries' ||
    key === 'rushYards' ||
    key === 'rushYdsPerGame' ||
    key === 'yardsPerCarry' ||
    key === 'rushTd' ||
    key === 'receptions' ||
    key === 'targets' ||
    key === 'catchPct' ||
    key === 'recYards' ||
    key === 'recYdsPerGame' ||
    key === 'yardsPerReception' ||
    key === 'yardsPerTarget' ||
    key === 'recTd' ||
    key === 'scrimmageYards' ||
    key === 'totalTd' ||
    key === 'tdPerGame' ||
    key === 'longGain' ||
    key === 'firstDowns' ||
    key === 'fumbles' ||
    key === 'fumblesLost' ||
    key === 'tackles' ||
    key === 'sacksMade' ||
    key === 'defInterceptions' ||
    key === 'passesDefended' ||
    key === 'forcedFumbles' ||
    key === 'fgMade' ||
    key === 'fgAttempts' ||
    key === 'punts'
  ) {
    return 'desc';
  }
  return 'asc';
}

export function toggleGridstreamPlayerSort(
  current: GridstreamPlayerSortState | null | undefined,
  key: GridstreamPlayerSortKey
): GridstreamPlayerSortState {
  if (!current || current.key !== key) {
    return { key, direction: defaultGridstreamSortDirectionForKey(key) };
  }
  return {
    key,
    direction: current.direction === 'asc' ? 'desc' : 'asc',
  };
}

export function sanitizeGridstreamPlayerTableColumns(
  columns: readonly string[] | null | undefined
): GridstreamPlayerTableColumnKey[] {
  if (!columns?.length) return [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS];

  const seen = new Set<string>();
  const selected: GridstreamPlayerTableColumnKey[] = [];
  for (const rawColumn of columns) {
    const normalized = normalizeString(rawColumn);
    if (!normalized || !GRIDSTREAM_PLAYER_TABLE_COLUMN_KEY_SET.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    selected.push(normalized as GridstreamPlayerTableColumnKey);
    seen.add(normalized);
  }

  if (selected.length === 0) return [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS];
  if (!selected.includes('player')) selected.unshift('player');
  return selected;
}

export function sortGridstreamPlayers(
  players: readonly GridstreamPlayerSummary[],
  sort: GridstreamPlayerSortState | null | undefined
): GridstreamPlayerSummary[] {
  const sorted = [...players];
  if (!sort) return sorted;

  sorted.sort((a, b) => {
    let comparison = 0;
    if (sort.key === 'player') {
      comparison = compareNullableStrings(a.displayName, b.displayName, sort.direction);
    } else if (sort.key === 'team') {
      comparison = compareTeams(a.teamAbbr, b.teamAbbr, sort.direction);
    } else if (sort.key === 'position') {
      comparison = compareNullableStrings(a.position, b.position, sort.direction);
    } else if (sort.key === 'age') {
      comparison = compareNullableNumbers(a.age, b.age, sort.direction);
    } else if (sort.key === 'status') {
      comparison = compareNullableStrings(a.rosterStatus, b.rosterStatus, sort.direction);
    } else if (sort.key === 'draftYear') {
      comparison = compareNullableNumbers(a.draftYear, b.draftYear, sort.direction);
    } else if (sort.key === 'seasons') {
      comparison = compareNullableNumbers(
        latestSeasonPlayed(a),
        latestSeasonPlayed(b),
        sort.direction
      );
    } else {
      const metricForPlayer = (player: GridstreamPlayerSummary): number | null => {
        if (sort.key === 'seasonsCount') return player.seasonsCount ?? player.seasonsPlayed.length;
        if (sort.key === 'gamesPlayed') return player.gamesPlayed;
        if (sort.key === 'completions') return player.passCompletions ?? null;
        if (sort.key === 'passAttempts') return player.passAttempts ?? null;
        if (sort.key === 'completionPct')
          return (
            player.completionPct ?? divideOrNull(player.passCompletions, player.passAttempts, 100)
          );
        if (sort.key === 'passYards') return player.passingYards ?? null;
        if (sort.key === 'passYdsPerGame')
          return (
            player.passingYardsPerGame ?? divideOrNull(player.passingYards, player.gamesPlayed)
          );
        if (sort.key === 'yardsPerAttempt')
          return player.yardsPerAttempt ?? divideOrNull(player.passingYards, player.passAttempts);
        if (sort.key === 'passTd') return player.passingTds ?? null;
        if (sort.key === 'interceptions') return player.interceptionsThrown ?? null;
        if (sort.key === 'passerRating') return player.passerRating ?? null;
        if (sort.key === 'sacksTaken') return player.sacksTaken ?? null;
        if (sort.key === 'carries') return player.carries ?? null;
        if (sort.key === 'rushYards') return player.rushingYards ?? null;
        if (sort.key === 'rushYdsPerGame')
          return (
            player.rushingYardsPerGame ?? divideOrNull(player.rushingYards, player.gamesPlayed)
          );
        if (sort.key === 'yardsPerCarry')
          return player.yardsPerCarry ?? divideOrNull(player.rushingYards, player.carries);
        if (sort.key === 'rushTd') return player.rushingTds ?? null;
        if (sort.key === 'receptions') return player.receptions ?? null;
        if (sort.key === 'targets') return player.targets ?? null;
        if (sort.key === 'catchPct')
          return player.catchPct ?? divideOrNull(player.receptions, player.targets, 100);
        if (sort.key === 'recYards') return player.receivingYards ?? null;
        if (sort.key === 'recYdsPerGame')
          return (
            player.receivingYardsPerGame ?? divideOrNull(player.receivingYards, player.gamesPlayed)
          );
        if (sort.key === 'yardsPerReception')
          return player.yardsPerReception ?? divideOrNull(player.receivingYards, player.receptions);
        if (sort.key === 'yardsPerTarget')
          return player.yardsPerTarget ?? divideOrNull(player.receivingYards, player.targets);
        if (sort.key === 'recTd') return player.receivingTds ?? null;
        if (sort.key === 'scrimmageYards')
          return player.scrimmageYards ?? (player.rushingYards ?? 0) + (player.receivingYards ?? 0);
        if (sort.key === 'totalTd')
          return (
            player.totalTouchdowns ??
            (player.passingTds ?? 0) + (player.rushingTds ?? 0) + (player.receivingTds ?? 0)
          );
        if (sort.key === 'tdPerGame')
          return (
            player.touchdownsPerGame ??
            divideOrNull(
              player.totalTouchdowns ??
                (player.passingTds ?? 0) + (player.rushingTds ?? 0) + (player.receivingTds ?? 0),
              player.gamesPlayed
            )
          );
        if (sort.key === 'longGain') return player.longGain ?? null;
        if (sort.key === 'firstDowns') return player.firstDowns ?? null;
        if (sort.key === 'fumbles') return player.fumbles ?? null;
        if (sort.key === 'fumblesLost') return player.fumblesLost ?? null;
        if (sort.key === 'tackles') return player.tacklesTotal ?? null;
        if (sort.key === 'sacksMade') return player.sacksMade ?? null;
        if (sort.key === 'defInterceptions') return player.interceptionsCaught ?? null;
        if (sort.key === 'passesDefended') return player.passesDefended ?? null;
        if (sort.key === 'forcedFumbles') return player.forcedFumbles ?? null;
        if (sort.key === 'fgMade') return player.fieldGoalsMade ?? null;
        if (sort.key === 'fgAttempts') return player.fieldGoalsAttempted ?? null;
        if (sort.key === 'punts') return player.puntAttempts ?? null;
        return null;
      };
      comparison = compareNullableNumbers(metricForPlayer(a), metricForPlayer(b), sort.direction);
    }

    if (comparison !== 0) return comparison;
    return collator.compare(a.displayName, b.displayName);
  });

  return sorted;
}

export function filterGridstreamPlayers(
  players: readonly GridstreamPlayerSummary[],
  filters: Partial<GridstreamPlayerFilterState>
): GridstreamPlayerSummary[] {
  const search = normalizeSearch(filters.search);
  const team = new Set(normalizeUpperTokenList(filters.team));
  const teamNot = new Set(normalizeUpperTokenList(filters.teamNot));
  const positionValues = new Set(expandPositionFilterValues(filters.position));
  const draftYear = new Set(parseNumericTokens(filters.draftYear));
  const season = new Set(parseNumericTokens(filters.season));
  const rosterStatusFilters = rosterStatusTokensFromFilter(filters.rosterStatus);
  const isActiveFilter = filters.isActive;

  const isPlayerActive = (player: GridstreamPlayerSummary): boolean => {
    if (typeof player.isActive === 'boolean') return player.isActive;
    const status = normalizeRosterStatusForCompare(player.rosterStatus);
    if (!status) return true;
    return status !== 'retired' && status !== 'released' && status !== 'inactive';
  };

  const matchesRosterStatusToken = (player: GridstreamPlayerSummary, token: string): boolean => {
    const normalizedToken = normalizeRosterStatusForCompare(token);
    const playerStatus = normalizeRosterStatusForCompare(player.rosterStatus);
    const playerTeam = normalizeUpper(player.teamAbbr);
    const playerActive = isPlayerActive(player);

    if (normalizedToken === 'free agent' || normalizedToken === 'fa') {
      return playerTeam === 'FA';
    }
    if (
      normalizedToken === 'active' ||
      normalizedToken === 'act' ||
      normalizedToken === 'roster active'
    ) {
      return playerStatus === 'active' && playerTeam !== 'FA' && playerActive;
    }
    if (
      normalizedToken === 'injured reserve' ||
      normalizedToken === 'reserve/injured' ||
      normalizedToken === 'ir' ||
      normalizedToken === 'res'
    ) {
      return playerStatus === 'injured reserve' || playerStatus === 'reserve/injured';
    }
    if (
      normalizedToken === 'practice squad' ||
      normalizedToken === 'practice' ||
      normalizedToken === 'pra'
    ) {
      return playerStatus === 'practice squad';
    }
    if (normalizedToken === 'inactive' || normalizedToken === 'ina') {
      return playerStatus === 'inactive';
    }
    if (normalizedToken === 'retired' || normalizedToken === 'ret') {
      return playerStatus === 'retired';
    }
    if (normalizedToken === 'released' || normalizedToken === 'cut') {
      return playerStatus === 'released';
    }
    return playerStatus === normalizedToken;
  };

  return players.filter((player) => {
    const playerTeam = normalizeUpper(player.teamAbbr);
    if (search && !playerSearchText(player).includes(search)) return false;
    if (team.size > 0 && !team.has(playerTeam)) return false;
    if (teamNot.size > 0 && teamNot.has(playerTeam)) return false;
    if (
      positionValues.size > 0 &&
      !positionValues.has(normalizeUpper(player.position)) &&
      !positionValues.has(normalizeUpper(player.positionGroup))
    ) {
      return false;
    }
    if (draftYear.size > 0 && (player.draftYear == null || !draftYear.has(player.draftYear))) {
      return false;
    }
    if (season.size > 0 && !player.seasonsPlayed.some((playerSeason) => season.has(playerSeason))) {
      return false;
    }
    if (
      rosterStatusFilters.length > 0 &&
      !rosterStatusFilters.some((token) => matchesRosterStatusToken(player, token))
    ) {
      return false;
    }
    if (isActiveFilter === true && !isPlayerActive(player)) return false;
    if (isActiveFilter === false && isPlayerActive(player)) return false;
    return true;
  });
}

export function buildGridstreamPlayerBuckets(
  players: readonly GridstreamPlayerSummary[],
  criterion: GridstreamPlayerBrowseCriterion
): GridstreamPlayerBucket[] {
  const counts = new Map<string, GridstreamPlayerBucket>();
  const upsert = (key: string, label: string) => {
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
      return;
    }
    counts.set(key, { criterion, key, label, count: 1 });
  };

  if (criterion === 'team') {
    players.forEach((player) => upsert(player.teamAbbr, player.teamAbbr));
  } else if (criterion === 'position') {
    players.forEach((player) => upsert(player.position, player.position));
  } else if (criterion === 'draftYear') {
    players.forEach((player) => {
      if (player.draftYear == null) {
        upsert(UNDRAFTED_KEY, 'Undrafted');
        return;
      }
      upsert(String(player.draftYear), String(player.draftYear));
    });
  } else {
    players.forEach((player) => {
      player.seasonsPlayed.forEach((season) => upsert(String(season), String(season)));
    });
  }

  const buckets = Array.from(counts.values());
  if (criterion === 'draftYear' || criterion === 'season') {
    return buckets.sort((a, b) => {
      const aInt = toSafeInt(a.key);
      const bInt = toSafeInt(b.key);
      if (aInt != null && bInt != null && aInt !== bInt) return bInt - aInt;
      return collator.compare(a.label, b.label);
    });
  }

  return buckets.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return collator.compare(a.label, b.label);
  });
}

export function buildGridstreamPositionFilterBucketsFromFacets(
  rows: readonly GridstreamPlayerBucket[] | null | undefined,
  order?: readonly string[]
): GridstreamPlayerBucket[] {
  const countsByPosition = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = normalizeUpper(row.key);
    if (!key) continue;
    const count = Number(row.count ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    countsByPosition.set(key, count);
  }

  if (countsByPosition.size === 0) return [];

  const preferred = new Set<string>();
  const buckets: GridstreamPlayerBucket[] = [];

  const orderedKeys = order ?? GRIDSTREAM_PLAYER_POSITION_OPTIONS;
  for (const raw of orderedKeys) {
    const key = normalizeUpper(raw);
    if (!key || preferred.has(key)) continue;
    preferred.add(key);
    let count = countsByPosition.get(key) ?? 0;
    if (count <= 0) {
      const aliases = expandPositionFilterValues(key);
      count = aliases.reduce((sum, alias) => sum + (countsByPosition.get(alias) ?? 0), 0);
    }
    if (count <= 0) continue;
    buckets.push({
      criterion: 'position',
      key,
      label: key,
      count,
    });
  }

  for (const [key, count] of countsByPosition.entries()) {
    if (preferred.has(key) || count <= 0) continue;
    buckets.push({
      criterion: 'position',
      key,
      label: key,
      count,
    });
  }

  return buckets.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return collator.compare(a.label, b.label);
  });
}

function buildGridstreamRosterStatusFacets(
  players: readonly GridstreamPlayerSummary[]
): GridstreamPlayerRosterStatusFacet[] {
  const counts = new Map<string, GridstreamPlayerRosterStatusFacet>();
  for (const player of players) {
    const label = normalizeString(player.rosterStatus) || 'Unknown';
    const key = label;
    const current = counts.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    counts.set(key, { key, label, count: 1 });
  }
  return Array.from(counts.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return collator.compare(a.label, b.label);
  });
}

const ROSTER_STATUS_LABEL_BY_CODE: Record<string, string> = {
  ACT: 'Active',
  RES: 'Injured Reserve',
  PRA: 'Practice Squad',
  UFA: 'Free Agent',
  RFA: 'Free Agent',
  INA: 'Inactive',
  PUP: 'PUP',
  SUS: 'Suspended',
  NFI: 'NFI',
  EXE: 'Exempt',
  RET: 'Retired',
  CUT: 'Released',
};

const ROSTER_STATUS_CODE_BY_LABEL: Record<string, string> = {
  active: 'ACT',
  'roster active': 'ACT',
  act: 'ACT',
  inactive: 'INA',
  ina: 'INA',
  retired: 'RET',
  ret: 'RET',
  released: 'CUT',
  cut: 'CUT',
  'injured reserve': 'RES',
  'reserve/injured': 'RES',
  ir: 'RES',
  res: 'RES',
  'practice squad': 'PRA',
  practice: 'PRA',
  pra: 'PRA',
  'free agent': 'UFA',
  fa: 'UFA',
  ufa: 'UFA',
  rfa: 'RFA',
};

export const GRIDSTREAM_PLAYER_POSITION_OPTIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'FB',
  'OL',
  'C',
  'G',
  'T',
  'K',
  'P',
  'LS',
  'DL',
  'EDGE',
  'DE',
  'DT',
  'NT',
  'LB',
  'OLB',
  'ILB',
  'MLB',
  'CB',
  'S',
  'FS',
  'SS',
  'DB',
] as const;

export const GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS = {
  search: 'q',
  team: 'team',
  teamNot: 'teamNot',
  position: 'pos',
  draftYear: 'draft',
  season: 'season',
  statsSeason: 'statsSeason',
  statsWeek: 'statsWeek',
  rosterStatus: 'status',
  active: 'active',
  page: 'page',
  browse: 'browse',
  sort: 'sort',
  direction: 'dir',
  columns: 'cols',
} as const;

export interface GridstreamSearchParamReader {
  get(name: string): string | null;
}

export interface GridstreamPlayerRouteState {
  filters: GridstreamPlayerFilterState;
  page: number;
  browseBy: GridstreamPlayerBrowseCriterion;
  sort: GridstreamPlayerSortState | null;
  columns: GridstreamPlayerTableColumnKey[];
}

export interface GridstreamPlayerRosterStatusFacet {
  key: string;
  label: string;
  count: number;
}

export type GridstreamPlayerDirectoryFacets = Record<
  GridstreamPlayerBrowseCriterion,
  GridstreamPlayerBucket[]
> & {
  rosterStatus: GridstreamPlayerRosterStatusFacet[];
};

export interface GridstreamPlayerDirectoryPage {
  items: GridstreamPlayerSummary[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  next: string | null;
  previous: string | null;
  facets: GridstreamPlayerDirectoryFacets;
  source: 'api' | 'mock';
  error?: string;
}

export interface GridstreamTeamFilterOption {
  abbreviation: string;
  displayName: string;
  logoUrl?: string | null;
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  conference?: string | null;
  division?: string | null;
}

export type GridstreamTeamFilterMode = 'off' | 'include' | 'exclude';

const GRIDSTREAM_TEAM_ALIGNMENT_BY_ABBR: Record<string, { conference: string; division: string }> =
  {
    ARI: { conference: 'NFC', division: 'NFC West' },
    ATL: { conference: 'NFC', division: 'NFC South' },
    CAR: { conference: 'NFC', division: 'NFC South' },
    CHI: { conference: 'NFC', division: 'NFC North' },
    DAL: { conference: 'NFC', division: 'NFC East' },
    DET: { conference: 'NFC', division: 'NFC North' },
    GB: { conference: 'NFC', division: 'NFC North' },
    LAR: { conference: 'NFC', division: 'NFC West' },
    LA: { conference: 'NFC', division: 'NFC West' },
    MIN: { conference: 'NFC', division: 'NFC North' },
    NO: { conference: 'NFC', division: 'NFC South' },
    NYG: { conference: 'NFC', division: 'NFC East' },
    PHI: { conference: 'NFC', division: 'NFC East' },
    SEA: { conference: 'NFC', division: 'NFC West' },
    SF: { conference: 'NFC', division: 'NFC West' },
    TB: { conference: 'NFC', division: 'NFC South' },
    WAS: { conference: 'NFC', division: 'NFC East' },
    BUF: { conference: 'AFC', division: 'AFC East' },
    BAL: { conference: 'AFC', division: 'AFC North' },
    CIN: { conference: 'AFC', division: 'AFC North' },
    CLE: { conference: 'AFC', division: 'AFC North' },
    DEN: { conference: 'AFC', division: 'AFC West' },
    HOU: { conference: 'AFC', division: 'AFC South' },
    IND: { conference: 'AFC', division: 'AFC South' },
    JAX: { conference: 'AFC', division: 'AFC South' },
    KC: { conference: 'AFC', division: 'AFC West' },
    LAC: { conference: 'AFC', division: 'AFC West' },
    MIA: { conference: 'AFC', division: 'AFC East' },
    NE: { conference: 'AFC', division: 'AFC East' },
    NYJ: { conference: 'AFC', division: 'AFC East' },
    LV: { conference: 'AFC', division: 'AFC West' },
    OAK: { conference: 'AFC', division: 'AFC West' },
    PIT: { conference: 'AFC', division: 'AFC North' },
    TEN: { conference: 'AFC', division: 'AFC South' },
    SD: { conference: 'AFC', division: 'AFC West' },
    STL: { conference: 'NFC', division: 'NFC West' },
  };

function compareTeamAbbreviationWithFaLast(a: string, b: string): number {
  const aAbbr = normalizeUpper(a);
  const bAbbr = normalizeUpper(b);
  const aIsFa = aAbbr === 'FA';
  const bIsFa = bAbbr === 'FA';
  if (aIsFa && !bIsFa) return 1;
  if (!aIsFa && bIsFa) return -1;
  return collator.compare(aAbbr, bAbbr);
}

export function sortGridstreamTeamFilterOptions(
  options: readonly GridstreamTeamFilterOption[]
): GridstreamTeamFilterOption[] {
  return [...options].sort((a, b) =>
    compareTeamAbbreviationWithFaLast(a.abbreviation, b.abbreviation)
  );
}

export function resolveGridstreamTeamFilterMode(
  filters: Partial<GridstreamPlayerFilterState>,
  teamAbbreviation: string | null | undefined
): GridstreamTeamFilterMode {
  const team = normalizeUpper(teamAbbreviation);
  if (!team) return 'off';
  const includeTeams = new Set(normalizeUpperTokenList(filters.team));
  const excludeTeams = new Set(normalizeUpperTokenList(filters.teamNot));
  if (includeTeams.has(team)) return 'include';
  if (excludeTeams.has(team)) return 'exclude';
  return 'off';
}

export function cycleGridstreamTeamFilterMode(
  filters: Partial<GridstreamPlayerFilterState>,
  teamAbbreviation: string | null | undefined
): Pick<GridstreamPlayerFilterState, 'team' | 'teamNot'> {
  const team = normalizeUpper(teamAbbreviation);
  if (!team) return { team: null, teamNot: null };
  const mode = resolveGridstreamTeamFilterMode(filters, team);
  const includeTeams = new Set(normalizeUpperTokenList(filters.team));
  const excludeTeams = new Set(normalizeUpperTokenList(filters.teamNot));

  if (mode === 'off') {
    includeTeams.add(team);
    excludeTeams.delete(team);
  } else if (mode === 'include') {
    includeTeams.delete(team);
    excludeTeams.add(team);
  } else {
    includeTeams.delete(team);
    excludeTeams.delete(team);
  }

  return {
    team: includeTeams.size > 0 ? Array.from(includeTeams).join(',') : null,
    teamNot: excludeTeams.size > 0 ? Array.from(excludeTeams).join(',') : null,
  };
}

/** Per-scenario dead money or cap savings amounts (all in dollars). */
export interface DeadMoneyScenarios {
  cut?: number | null;
  june1Cut?: number | null;
  trade?: number | null;
  june1Trade?: number | null;
  restructure?: number | null;
  extension?: number | null;
}

export interface ContractYearDetail {
  year: number;
  team?: string | null;
  baseSalary?: number | null;
  signingBonus?: number | null;
  rosterBonus?: number | null;
  perGameRosterBonus?: number | null;
  workoutBonus?: number | null;
  otherBonus?: number | null;
  guaranteedSalary?: number | null;
  capHit?: number | null;
  capPct?: number | null;
  cashPaid?: number | null;
  /** Dead money charged to cap per cut/trade/restructure/extension scenario. */
  deadMoney?: DeadMoneyScenarios | null;
  /** Cap savings realized per scenario (negative = additional cap charge). */
  capSavings?: DeadMoneyScenarios | null;
}

export interface GridstreamPlayerContract {
  id: number;
  teamAbbr?: string | null;
  isActive?: boolean;
  yearSigned?: number | null;
  years?: number | null;
  totalValue?: number | null;
  apy?: number | null;
  guaranteed?: number | null;
  apyCapPct?: number | null;
  otcUrl?: string | null;
  yearDetails?: ContractYearDetail[] | null;
}

export interface GridstreamPlayerCombineResult {
  id: number;
  season?: number | null;
  position?: string | null;
  heightInches?: number | null;
  weight?: number | null;
  armLength?: number | null;
  handSize?: number | null;
  fortyYard?: number | null;
  benchPress?: number | null;
  verticalJump?: number | null;
  broadJump?: number | null;
  threeCone?: number | null;
  shuttle?: number | null;
  draftRound?: number | null;
  draftOverall?: number | null;
}

export interface GridstreamPlayerCollegeHistoryEntry {
  id: number;
  college?: string | null;
  conference?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  isRedshirt?: boolean;
  isPrimary?: boolean;
  sequence?: number | null;
}

export interface GridstreamPlayerTransaction {
  id: number;
  transactionType?: string | null;
  date?: string | null;
  fromTeamAbbr?: string | null;
  toTeamAbbr?: string | null;
  description?: string | null;
  season?: number | null;
}

export interface GridstreamPlayerSocialAccount {
  id: number;
  platform?: string | null;
  handle?: string | null;
  url?: string | null;
  displayName?: string | null;
  isVerified?: boolean;
}

export interface GridstreamPlayerAward {
  season: number;
  espnAwardId: string;
  name: string;
  description: string;
}

export interface GridstreamPlayerMaddenRating {
  maddenYear: number;
  positionSnapshot: string;
  teamSnapshot: string;
  overall: number;
  generalRating?: number | null;
  passingRating?: number | null;
  receivingRating?: number | null;
  ballCarrierRating?: number | null;
  defenseRating?: number | null;
  blockingRating?: number | null;
  kickingRating?: number | null;
  speed?: number | null;
  strength?: number | null;
  awareness?: number | null;
  agility?: number | null;
  acceleration?: number | null;
  tackle?: number | null;
  powerMoves?: number | null;
  finesseMoves?: number | null;
  throwPower?: number | null;
  catching?: number | null;
  routeRunning?: number | null;
  runBlock?: number | null;
  passBlock?: number | null;
  hitPower?: number | null;
  manCoverage?: number | null;
  zoneCoverage?: number | null;
}

export interface GridstreamPlayerFFRanking {
  season: number;
  week: number;
  position: string;
  rank: number;
  rankSd?: number | null;
  rankBest?: number | null;
  rankWorst?: number | null;
  positionRank?: number | null;
}

export interface GridstreamPlayerProfile extends GridstreamPlayerSummary {
  firstName?: string;
  lastName?: string;
  suffix?: string;
  currentTeamName?: string;
  currentTeamColors?: { primary?: string | null; secondary?: string | null } | null;
  headshotUrl?: string | null;
  isActive: boolean;
  height?: string;
  heightInches?: number | null;
  weight?: number | null;
  birthDate?: string | null;
  draftOverall?: number | null;
  rookieSeason?: number | null;
  entryYear?: number | null;
  yearsExperience?: number | null;
  depthChartPosition?: string | null;
  collegeConference?: string | null;
  contracts?: GridstreamPlayerContract[];
  combineResults?: GridstreamPlayerCombineResult[];
  collegeHistory?: GridstreamPlayerCollegeHistoryEntry[];
  socialAccounts?: GridstreamPlayerSocialAccount[];
  recentTransactions?: GridstreamPlayerTransaction[];
  awards?: GridstreamPlayerAward[];
  maddenRating?: GridstreamPlayerMaddenRating | null;
  latestFfRanking?: GridstreamPlayerFFRanking | null;
}

export interface GridstreamPlayerGamelogEntry {
  id: number;
  seasonYear: number;
  week: number;
  seasonType: string;
  teamAbbr: string;
  opponentAbbr: string;
  // Offense
  passComp: number;
  passAtt: number;
  passYards: number;
  passTd: number;
  interceptionsThrown: number;
  carries: number;
  rushYards: number;
  rushTd: number;
  receptions: number;
  receivingYards: number;
  receivingTd: number;
  // Defense
  tacklesTotal: number;
  sacksMade: number;
  qbHits: number;
  passesDefended: number;
  interceptionsCaught: number;
  interceptionTds: number;
  forcedFumbles: number;
  defensiveTds: number;
  fantasyPointsPpr: number;
}

export interface GridstreamPlayerGamelogPage {
  items: GridstreamPlayerGamelogEntry[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  next: string | null;
  previous: string | null;
}

export interface GridstreamPlayerSplitAggregate {
  games: number;
  // Offense
  passYds: number;
  passTds: number;
  passFirstDowns: number;
  rushYds: number;
  rushTds: number;
  rushFirstDowns: number;
  recYds: number;
  recTds: number;
  recFirstDowns: number;
  fumbles: number;
  fumblesLost: number;
  forcedFumbles: number;
  ppr: number;
  // Defense
  defTackles: number;
  defSacks: number;
  defQbHits: number;
  defPd: number;
  defInts: number;
  defIntTds: number;
  defTds: number;
}

export interface GridstreamPlayerSplits {
  home: GridstreamPlayerSplitAggregate;
  away: GridstreamPlayerSplitAggregate;
  regular: GridstreamPlayerSplitAggregate;
  postseason: GridstreamPlayerSplitAggregate;
  grass: GridstreamPlayerSplitAggregate;
  turf: GridstreamPlayerSplitAggregate;
  wins: GridstreamPlayerSplitAggregate;
  losses: GridstreamPlayerSplitAggregate;
  division: GridstreamPlayerSplitAggregate;
  nondivision: GridstreamPlayerSplitAggregate;
}

interface ApiPageNumberResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface ApiGridstreamFacetBucket {
  key?: string | null;
  label?: string | null;
  count?: number | null;
}

interface ApiGridstreamPlayerFacets {
  team?: ApiGridstreamFacetBucket[];
  position?: ApiGridstreamFacetBucket[];
  draftYear?: ApiGridstreamFacetBucket[];
  season?: ApiGridstreamFacetBucket[];
  rosterStatus?: ApiGridstreamFacetBucket[];
}

interface ApiGridstreamPlayerListResponse extends ApiPageNumberResponse<ApiGridstreamPlayerListItem> {
  facets?: ApiGridstreamPlayerFacets;
}

interface ApiGridstreamPlayerListItem {
  id: number | string;
  gsis_id?: string | null;
  display_name?: string | null;
  short_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  position_group?: string | null;
  jersey_number?: string | null;
  roster_status?: string | null;
  roster_status_display?: string | null;
  age?: number | null;
  current_team_abbr?: string | null;
  current_team_colors?: { primary?: string | null; secondary?: string | null } | null;
  draft_year?: number | null;
  draft_round?: number | null;
  draft_pick?: number | null;
  rookie_season?: number | null;
  entry_year?: number | null;
  years_experience?: number | null;
  games_played?: number | null;
  games_started?: number | null;
  offensive_snaps?: number | null;
  snap_pct?: number | null;
  first_season_played?: number | null;
  last_season_played?: number | null;
  seasons_count?: number | null;
  career_completions?: number | null;
  career_pass_attempts?: number | null;
  career_completion_pct?: number | null;
  career_passing_yards?: number | null;
  career_pass_yards_per_game?: number | null;
  career_pass_yards_per_attempt?: number | null;
  career_passing_tds?: number | null;
  career_interceptions_thrown?: number | null;
  career_passer_rating?: number | null;
  career_sacks_taken?: number | null;
  career_carries?: number | null;
  career_rushing_yards?: number | null;
  career_rush_yards_per_game?: number | null;
  career_yards_per_carry?: number | null;
  career_rushing_tds?: number | null;
  career_receptions?: number | null;
  career_targets?: number | null;
  career_catch_pct?: number | null;
  career_receiving_yards?: number | null;
  career_rec_yards_per_game?: number | null;
  career_yards_per_reception?: number | null;
  career_yards_per_target?: number | null;
  career_receiving_tds?: number | null;
  career_scrimmage_yards?: number | null;
  career_total_touchdowns?: number | null;
  career_touchdowns_per_game?: number | null;
  career_long_gain?: number | null;
  career_first_downs?: number | null;
  career_fumbles?: number | null;
  career_fumbles_lost?: number | null;
  career_tackles_total?: number | null;
  career_sacks_made?: number | null;
  career_interceptions_caught?: number | null;
  career_passes_defended?: number | null;
  career_forced_fumbles?: number | null;
  career_fg_made?: number | null;
  career_fg_attempts?: number | null;
  career_punt_attempts?: number | null;
  headshot_url?: string | null;
  is_active?: boolean;
}

interface ApiGridstreamTeamListItem {
  abbreviation?: string | null;
  display_name?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  conference?: string | null;
  division?: string | null;
  logos?: Array<{ logo_type?: string | null; url?: string | null }> | null;
}

interface ApiGridstreamPlayerContractRaw {
  id: number;
  team_abbr?: string | null;
  is_active?: boolean;
  year_signed?: number | null;
  years?: number | null;
  total_value?: number | null;
  apy?: number | null;
  guaranteed?: number | null;
  apy_cap_pct?: number | null;
  otc_url?: string | null;
  year_details?: Array<{
    year?: number | null;
    team?: string | null;
    base_salary?: number | null;
    signing_bonus?: number | null;
    roster_bonus?: number | null;
    per_game_roster_bonus?: number | null;
    workout_bonus?: number | null;
    other_bonus?: number | null;
    guaranteed_salary?: number | null;
    cap_hit?: number | null;
    cap_pct?: number | null;
    cash_paid?: number | null;
    dead_money?: Record<string, number> | null;
    cap_savings?: Record<string, number> | null;
  }> | null;
}

interface ApiGridstreamPlayerCombineRaw {
  id: number;
  season?: number | null;
  position?: string | null;
  height_inches?: number | null;
  weight?: number | null;
  arm_length?: number | null;
  hand_size?: number | null;
  forty_yard?: number | null;
  bench_press?: number | null;
  vertical_jump?: number | null;
  broad_jump?: number | null;
  three_cone?: number | null;
  shuttle?: number | null;
  draft_round?: number | null;
  draft_overall?: number | null;
}

interface ApiGridstreamPlayerCollegeHistoryRaw {
  id: number;
  college?: string | null;
  conference?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  is_redshirt?: boolean;
  is_primary?: boolean;
  sequence?: number | null;
}

interface ApiGridstreamPlayerTransactionRaw {
  id: number;
  transaction_type?: string | null;
  date?: string | null;
  from_team_abbr?: string | null;
  to_team_abbr?: string | null;
  description?: string | null;
  season?: number | null;
}

interface ApiGridstreamPlayerSocialAccountRaw {
  id: number;
  platform?: string | null;
  handle?: string | null;
  url?: string | null;
  display_name?: string | null;
  is_verified?: boolean;
}

interface ApiGridstreamPlayerDetail {
  id: number | string;
  gsis_id?: string | null;
  display_name?: string | null;
  short_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
  jersey_number?: string | null;
  position?: string | null;
  position_group?: string | null;
  roster_status?: string | null;
  depth_chart_position?: string | null;
  headshot_url?: string | null;
  height?: string | null;
  height_inches?: number | null;
  weight?: number | null;
  birth_date?: string | null;
  college?: string | null;
  college_conference?: string | null;
  draft_year?: number | null;
  draft_round?: number | null;
  draft_pick?: number | null;
  draft_overall?: number | null;
  rookie_season?: number | null;
  entry_year?: number | null;
  years_experience?: number | null;
  games_played?: number | null;
  first_season_played?: number | null;
  last_season_played?: number | null;
  is_active?: boolean;
  current_team_detail?: {
    abbreviation?: string | null;
    display_name?: string | null;
    color_primary?: string | null;
    color_secondary?: string | null;
  } | null;
  contracts?: ApiGridstreamPlayerContractRaw[];
  combine_results?: ApiGridstreamPlayerCombineRaw[];
  college_history?: ApiGridstreamPlayerCollegeHistoryRaw[];
  social_accounts?: ApiGridstreamPlayerSocialAccountRaw[];
  recent_transactions?: ApiGridstreamPlayerTransactionRaw[];
  awards?: { season: number; espn_award_id: string; name: string; description: string }[];
  madden_rating?: {
    madden_year: number;
    position_snapshot: string;
    team_snapshot: string;
    overall: number;
    general_rating?: number | null;
    passing_rating?: number | null;
    receiving_rating?: number | null;
    ball_carrier_rating?: number | null;
    defense_rating?: number | null;
    blocking_rating?: number | null;
    kicking_rating?: number | null;
    speed?: number | null;
    strength?: number | null;
    awareness?: number | null;
    agility?: number | null;
    acceleration?: number | null;
    tackle?: number | null;
    power_moves?: number | null;
    finesse_moves?: number | null;
    throw_power?: number | null;
    catching?: number | null;
    route_running?: number | null;
    run_block?: number | null;
    pass_block?: number | null;
    hit_power?: number | null;
    man_coverage?: number | null;
    zone_coverage?: number | null;
  } | null;
  latest_ff_ranking?: {
    season: number;
    week: number;
    position: string;
    rank: number;
    rank_sd?: number | null;
    rank_best?: number | null;
    rank_worst?: number | null;
    position_rank?: number | null;
  } | null;
}

interface ApiGridstreamPlayerGamelogRow {
  id: number;
  season_year?: number | null;
  week?: number | null;
  season_type?: string | null;
  team_abbr?: string | null;
  opponent_abbr?: string | null;
  completions?: number | null;
  pass_attempts?: number | null;
  passing_yards?: number | null;
  passing_tds?: number | null;
  interceptions_thrown?: number | null;
  carries?: number | null;
  rushing_yards?: number | null;
  rushing_tds?: number | null;
  receptions?: number | null;
  receiving_yards?: number | null;
  receiving_tds?: number | null;
  tackles_total?: number | null;
  sacks_made?: number | null;
  qb_hits?: number | null;
  passes_defended?: number | null;
  interceptions_caught?: number | null;
  interception_tds?: number | null;
  forced_fumbles?: number | null;
  defensive_tds?: number | null;
  fantasy_points_ppr?: number | null;
}

type SplitAggRow = Partial<
  Record<
    | 'games'
    | 'pass_yds' | 'pass_tds' | 'pass_first_downs'
    | 'rush_yds' | 'rush_tds' | 'rush_first_downs'
    | 'rec_yds' | 'rec_tds' | 'rec_first_downs'
    | 'fumbles' | 'fumbles_lost' | 'forced_fumbles'
    | 'ppr'
    | 'def_tackles' | 'def_sacks' | 'def_qb_hits'
    | 'def_pd' | 'def_ints' | 'def_int_tds' | 'def_tds',
    number
  >
>;

interface ApiGridstreamPlayerSplitsRaw {
  home?: SplitAggRow;
  away?: SplitAggRow;
  regular?: SplitAggRow;
  postseason?: SplitAggRow;
  grass?: SplitAggRow;
  turf?: SplitAggRow;
  wins?: SplitAggRow;
  losses?: SplitAggRow;
  division?: SplitAggRow;
  nondivision?: SplitAggRow;
}

export interface FetchGridstreamPlayersDirectoryPageInput {
  apiBase: string;
  filters: Partial<GridstreamPlayerFilterState>;
  page: number;
  pageSize?: number;
  sort?: GridstreamPlayerSortState | null;
  signal?: AbortSignal;
  fallbackToMock?: boolean;
}

export interface FetchGridstreamPlayerProfileInput {
  apiBase: string;
  playerId: string | number;
  signal?: AbortSignal;
}

export interface FetchGridstreamPlayerGamelogInput {
  apiBase: string;
  playerId: string | number;
  season?: number | null;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface FetchGridstreamPlayerSplitsInput {
  apiBase: string;
  playerId: string | number;
  season?: number | null;
  signal?: AbortSignal;
}

function padPositiveInt(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

function toSlug(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-') || 'player'
  );
}

function toAbbreviatedName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return displayName;
  return `${parts[0]?.charAt(0) ?? ''}. ${parts.slice(1).join(' ')}`.trim();
}

export function rosterStatusLabelFromCode(
  value: string | null | undefined,
  fallback?: { isActive?: boolean; teamAbbr?: string | null }
): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    if (fallback?.isActive && !normalizeString(fallback.teamAbbr)) return 'Free Agent';
    return 'Unknown';
  }
  const fromCode = ROSTER_STATUS_LABEL_BY_CODE[normalized.toUpperCase()];
  if (fromCode) return fromCode;
  return normalized;
}

export function rosterStatusCodeFromLabel(value: string | null | undefined): string | null {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return null;
  const mapped = ROSTER_STATUS_CODE_BY_LABEL[normalized];
  if (mapped) return mapped;
  const upper = normalizeString(value).toUpperCase();
  return upper || null;
}

function inferSeasonsPlayed(source: {
  first_season_played?: number | null;
  last_season_played?: number | null;
  entry_year?: number | null;
  rookie_season?: number | null;
  years_experience?: number | null;
  draft_year?: number | null;
}): number[] {
  const first = toSafeInt(source.first_season_played);
  const last = toSafeInt(source.last_season_played);
  if (first != null && last != null && last >= first) {
    return seasonRange(first, last);
  }

  const entryYear =
    toSafeInt(source.entry_year) ?? toSafeInt(source.rookie_season) ?? toSafeInt(source.draft_year);
  const experience = toSafeInt(source.years_experience);
  if (entryYear != null && experience != null && experience >= 0) {
    return seasonRange(entryYear, entryYear + experience);
  }
  if (entryYear != null) return [entryYear];
  return [];
}

function mapApiPlayerSummary(row: ApiGridstreamPlayerListItem): GridstreamPlayerSummary {
  const id = normalizeString(row.id) || normalizeString(row.gsis_id) || 'unknown-player';
  const displayName =
    normalizeString(row.display_name) ||
    [normalizeString(row.first_name), normalizeString(row.last_name)].filter(Boolean).join(' ') ||
    `Player ${id}`;
  const shortName = normalizeString(row.short_name) || toAbbreviatedName(displayName);
  const teamAbbr = normalizeUpper(row.current_team_abbr) || 'FA';
  const position = normalizeUpper(row.position) || 'UNK';
  const seasonsPlayed = inferSeasonsPlayed(row);
  const age = toSafeInt(row.age);
  return {
    id,
    slug: toSlug(displayName),
    displayName,
    shortName,
    teamAbbr,
    position,
    positionGroup: normalizeUpper(row.position_group) || position,
    jerseyNumber: normalizeString(row.jersey_number) || undefined,
    age,
    college: undefined,
    draftYear: toSafeInt(row.draft_year),
    draftRound: toSafeInt(row.draft_round),
    draftPick: toSafeInt(row.draft_pick),
    seasonsPlayed,
    gamesPlayed: toSafeInt(row.games_played) ?? 0,
    gamesStarted: toSafeInt(row.games_started),
    offensiveSnaps: toSafeInt(row.offensive_snaps),
    snapPct: row.snap_pct == null ? null : Number(row.snap_pct),
    seasonsCount: toSafeInt(row.seasons_count) ?? seasonsPlayed.length,
    passCompletions: toSafeInt(row.career_completions) ?? 0,
    passAttempts: toSafeInt(row.career_pass_attempts) ?? 0,
    completionPct:
      row.career_completion_pct == null ? undefined : Number(row.career_completion_pct),
    passingYards: toSafeInt(row.career_passing_yards) ?? 0,
    passingYardsPerGame:
      row.career_pass_yards_per_game == null ? undefined : Number(row.career_pass_yards_per_game),
    yardsPerAttempt:
      row.career_pass_yards_per_attempt == null
        ? undefined
        : Number(row.career_pass_yards_per_attempt),
    passingTds: toSafeInt(row.career_passing_tds) ?? 0,
    interceptionsThrown: toSafeInt(row.career_interceptions_thrown) ?? 0,
    passerRating: row.career_passer_rating == null ? undefined : Number(row.career_passer_rating),
    sacksTaken: toSafeInt(row.career_sacks_taken) ?? 0,
    carries: toSafeInt(row.career_carries) ?? 0,
    rushingYards: toSafeInt(row.career_rushing_yards) ?? 0,
    rushingYardsPerGame:
      row.career_rush_yards_per_game == null ? undefined : Number(row.career_rush_yards_per_game),
    yardsPerCarry:
      row.career_yards_per_carry == null ? undefined : Number(row.career_yards_per_carry),
    rushingTds: toSafeInt(row.career_rushing_tds) ?? 0,
    receptions: toSafeInt(row.career_receptions) ?? 0,
    targets: toSafeInt(row.career_targets) ?? 0,
    catchPct: row.career_catch_pct == null ? undefined : Number(row.career_catch_pct),
    receivingYards: toSafeInt(row.career_receiving_yards) ?? 0,
    receivingYardsPerGame:
      row.career_rec_yards_per_game == null ? undefined : Number(row.career_rec_yards_per_game),
    yardsPerReception:
      row.career_yards_per_reception == null ? undefined : Number(row.career_yards_per_reception),
    yardsPerTarget:
      row.career_yards_per_target == null ? undefined : Number(row.career_yards_per_target),
    receivingTds: toSafeInt(row.career_receiving_tds) ?? 0,
    scrimmageYards: toSafeInt(row.career_scrimmage_yards) ?? 0,
    totalTouchdowns: toSafeInt(row.career_total_touchdowns) ?? 0,
    touchdownsPerGame:
      row.career_touchdowns_per_game == null ? undefined : Number(row.career_touchdowns_per_game),
    longGain: toSafeInt(row.career_long_gain) ?? 0,
    firstDowns: toSafeInt(row.career_first_downs) ?? 0,
    fumbles: toSafeInt(row.career_fumbles) ?? 0,
    fumblesLost: toSafeInt(row.career_fumbles_lost) ?? 0,
    tacklesTotal: toSafeInt(row.career_tackles_total) ?? 0,
    sacksMade: row.career_sacks_made == null ? undefined : Number(row.career_sacks_made),
    interceptionsCaught: toSafeInt(row.career_interceptions_caught) ?? 0,
    passesDefended: toSafeInt(row.career_passes_defended) ?? 0,
    forcedFumbles: toSafeInt(row.career_forced_fumbles) ?? 0,
    fieldGoalsMade: toSafeInt(row.career_fg_made) ?? 0,
    fieldGoalsAttempted: toSafeInt(row.career_fg_attempts) ?? 0,
    puntAttempts: toSafeInt(row.career_punt_attempts) ?? 0,
    isActive: row.is_active == null ? undefined : Boolean(row.is_active),
    rosterStatus: rosterStatusLabelFromCode(row.roster_status_display ?? row.roster_status, {
      isActive: Boolean(row.is_active),
      teamAbbr: row.current_team_abbr,
    }),
  };
}

function mapApiPlayerProfile(row: ApiGridstreamPlayerDetail): GridstreamPlayerProfile {
  const id = normalizeString(row.id) || normalizeString(row.gsis_id) || 'unknown-player';
  const displayName =
    normalizeString(row.display_name) ||
    [normalizeString(row.first_name), normalizeString(row.last_name)].filter(Boolean).join(' ') ||
    `Player ${id}`;
  const shortName = normalizeString(row.short_name) || toAbbreviatedName(displayName);
  const teamAbbr = normalizeUpper(row.current_team_detail?.abbreviation) || 'FA';
  const seasonsPlayed = inferSeasonsPlayed(row);

  return {
    id,
    slug: toSlug(displayName),
    displayName,
    shortName,
    firstName: normalizeString(row.first_name) || undefined,
    lastName: normalizeString(row.last_name) || undefined,
    suffix: normalizeString(row.suffix) || undefined,
    teamAbbr,
    currentTeamName: normalizeString(row.current_team_detail?.display_name) || undefined,
    currentTeamColors: row.current_team_detail
      ? {
          primary: row.current_team_detail.color_primary ?? undefined,
          secondary: row.current_team_detail.color_secondary ?? undefined,
        }
      : null,
    position: normalizeUpper(row.position) || 'UNK',
    positionGroup: normalizeUpper(row.position_group) || normalizeUpper(row.position) || 'UNK',
    jerseyNumber: normalizeString(row.jersey_number) || undefined,
    age: row.birth_date ? calculateAgeFromDate(row.birth_date) : null,
    college: normalizeString(row.college) || undefined,
    draftYear: toSafeInt(row.draft_year),
    draftRound: toSafeInt(row.draft_round),
    draftPick: toSafeInt(row.draft_pick),
    seasonsPlayed,
    gamesPlayed: toSafeInt(row.games_played) ?? 0,
    rosterStatus: rosterStatusLabelFromCode(row.roster_status, {
      isActive: Boolean(row.is_active),
      teamAbbr,
    }),
    headshotUrl: row.headshot_url ?? undefined,
    isActive: Boolean(row.is_active),
    height: normalizeString(row.height) || undefined,
    heightInches: toSafeInt(row.height_inches),
    weight: toSafeInt(row.weight),
    birthDate: row.birth_date ?? undefined,
    draftOverall: toSafeInt(row.draft_overall),
    rookieSeason: toSafeInt(row.rookie_season),
    entryYear: toSafeInt(row.entry_year),
    yearsExperience: toSafeInt(row.years_experience),
    depthChartPosition: normalizeString(row.depth_chart_position) || null,
    collegeConference: normalizeString(row.college_conference) || null,
    contracts: (row.contracts ?? []).map((c) => ({
      id: c.id,
      teamAbbr: normalizeString(c.team_abbr) || null,
      isActive: Boolean(c.is_active),
      yearSigned: toSafeInt(c.year_signed),
      years: toSafeInt(c.years),
      totalValue: c.total_value ?? null,
      apy: c.apy ?? null,
      guaranteed: c.guaranteed ?? null,
      apyCapPct: c.apy_cap_pct ?? null,
      otcUrl: normalizeString(c.otc_url) || null,
      yearDetails: (c.year_details ?? []).map((d) => ({
        year: d.year ?? 0,
        team: normalizeString(d.team) || null,
        baseSalary: d.base_salary ?? null,
        signingBonus: d.signing_bonus ?? null,
        rosterBonus: d.roster_bonus ?? null,
        perGameRosterBonus: d.per_game_roster_bonus ?? null,
        workoutBonus: d.workout_bonus ?? null,
        otherBonus: d.other_bonus ?? null,
        guaranteedSalary: d.guaranteed_salary ?? null,
        capHit: d.cap_hit ?? null,
        capPct: d.cap_pct ?? null,
        cashPaid: d.cash_paid ?? null,
        deadMoney: d.dead_money
          ? {
              cut: d.dead_money['cut'] ?? null,
              june1Cut: d.dead_money['june_1_cut'] ?? null,
              trade: d.dead_money['trade'] ?? null,
              june1Trade: d.dead_money['june_1_trade'] ?? null,
              restructure: d.dead_money['restructure'] ?? null,
              extension: d.dead_money['extension'] ?? null,
            }
          : null,
        capSavings: d.cap_savings
          ? {
              cut: d.cap_savings['cut'] ?? null,
              june1Cut: d.cap_savings['june_1_cut'] ?? null,
              trade: d.cap_savings['trade'] ?? null,
              june1Trade: d.cap_savings['june_1_trade'] ?? null,
              restructure: d.cap_savings['restructure'] ?? null,
              extension: d.cap_savings['extension'] ?? null,
            }
          : null,
      })),
    })),
    combineResults: (row.combine_results ?? []).map((c) => ({
      id: c.id,
      season: toSafeInt(c.season),
      position: normalizeString(c.position) || null,
      heightInches: c.height_inches ?? null,
      weight: toSafeInt(c.weight),
      armLength: c.arm_length ?? null,
      handSize: c.hand_size ?? null,
      fortyYard: c.forty_yard ?? null,
      benchPress: toSafeInt(c.bench_press),
      verticalJump: c.vertical_jump ?? null,
      broadJump: toSafeInt(c.broad_jump),
      threeCone: c.three_cone ?? null,
      shuttle: c.shuttle ?? null,
      draftRound: toSafeInt(c.draft_round),
      draftOverall: toSafeInt(c.draft_overall),
    })),
    collegeHistory: (row.college_history ?? []).map((h) => ({
      id: h.id,
      college: normalizeString(h.college) || null,
      conference: normalizeString(h.conference) || null,
      startYear: toSafeInt(h.start_year),
      endYear: toSafeInt(h.end_year),
      isRedshirt: Boolean(h.is_redshirt),
      isPrimary: Boolean(h.is_primary),
      sequence: toSafeInt(h.sequence),
    })),
    socialAccounts: (row.social_accounts ?? []).map((s) => ({
      id: s.id,
      platform: normalizeString(s.platform) || null,
      handle: normalizeString(s.handle) || null,
      url: normalizeString(s.url) || null,
      displayName: normalizeString(s.display_name) || null,
      isVerified: Boolean(s.is_verified),
    })),
    recentTransactions: (row.recent_transactions ?? []).map((t) => ({
      id: t.id,
      transactionType: normalizeString(t.transaction_type) || null,
      date: normalizeString(t.date) || null,
      fromTeamAbbr: normalizeString(t.from_team_abbr) || null,
      toTeamAbbr: normalizeString(t.to_team_abbr) || null,
      description: normalizeString(t.description) || null,
      season: toSafeInt(t.season),
    })),
    awards: (row.awards ?? []).map((a) => ({
      season: a.season,
      espnAwardId: a.espn_award_id,
      name: a.name,
      description: a.description,
    })),
    maddenRating: row.madden_rating
      ? {
          maddenYear: row.madden_rating.madden_year,
          positionSnapshot: row.madden_rating.position_snapshot,
          teamSnapshot: row.madden_rating.team_snapshot,
          overall: row.madden_rating.overall,
          generalRating: row.madden_rating.general_rating ?? null,
          passingRating: row.madden_rating.passing_rating ?? null,
          receivingRating: row.madden_rating.receiving_rating ?? null,
          ballCarrierRating: row.madden_rating.ball_carrier_rating ?? null,
          defenseRating: row.madden_rating.defense_rating ?? null,
          blockingRating: row.madden_rating.blocking_rating ?? null,
          kickingRating: row.madden_rating.kicking_rating ?? null,
          speed: row.madden_rating.speed ?? null,
          strength: row.madden_rating.strength ?? null,
          awareness: row.madden_rating.awareness ?? null,
          agility: row.madden_rating.agility ?? null,
          acceleration: row.madden_rating.acceleration ?? null,
          tackle: row.madden_rating.tackle ?? null,
          powerMoves: row.madden_rating.power_moves ?? null,
          finesseMoves: row.madden_rating.finesse_moves ?? null,
          throwPower: row.madden_rating.throw_power ?? null,
          catching: row.madden_rating.catching ?? null,
          routeRunning: row.madden_rating.route_running ?? null,
          runBlock: row.madden_rating.run_block ?? null,
          passBlock: row.madden_rating.pass_block ?? null,
          hitPower: row.madden_rating.hit_power ?? null,
          manCoverage: row.madden_rating.man_coverage ?? null,
          zoneCoverage: row.madden_rating.zone_coverage ?? null,
        }
      : null,
    latestFfRanking: row.latest_ff_ranking
      ? {
          season: row.latest_ff_ranking.season,
          week: row.latest_ff_ranking.week,
          position: row.latest_ff_ranking.position,
          rank: row.latest_ff_ranking.rank,
          rankSd: row.latest_ff_ranking.rank_sd ?? null,
          rankBest: row.latest_ff_ranking.rank_best ?? null,
          rankWorst: row.latest_ff_ranking.rank_worst ?? null,
          positionRank: row.latest_ff_ranking.position_rank ?? null,
        }
      : null,
  };
}

function calculateAgeFromDate(birthDateIso: string): number | null {
  const normalized = normalizeString(birthDateIso);
  if (!normalized) return null;
  const birthDate = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  const dayDiff = now.getUTCDate() - birthDate.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
}

function mapApiPlayerGamelogRow(row: ApiGridstreamPlayerGamelogRow): GridstreamPlayerGamelogEntry {
  return {
    id: row.id,
    seasonYear: toSafeInt(row.season_year) ?? 0,
    week: toSafeInt(row.week) ?? 0,
    seasonType: normalizeString(row.season_type) || 'REG',
    teamAbbr: normalizeUpper(row.team_abbr) || '—',
    opponentAbbr: normalizeUpper(row.opponent_abbr) || '—',
    passComp: toSafeInt(row.completions) ?? 0,
    passAtt: toSafeInt(row.pass_attempts) ?? 0,
    passYards: toSafeInt(row.passing_yards) ?? 0,
    passTd: toSafeInt(row.passing_tds) ?? 0,
    interceptionsThrown: toSafeInt(row.interceptions_thrown) ?? 0,
    carries: toSafeInt(row.carries) ?? 0,
    rushYards: toSafeInt(row.rushing_yards) ?? 0,
    rushTd: toSafeInt(row.rushing_tds) ?? 0,
    receptions: toSafeInt(row.receptions) ?? 0,
    receivingYards: toSafeInt(row.receiving_yards) ?? 0,
    receivingTd: toSafeInt(row.receiving_tds) ?? 0,
    tacklesTotal: toSafeInt(row.tackles_total) ?? 0,
    sacksMade: Number(row.sacks_made ?? 0),
    qbHits: toSafeInt(row.qb_hits) ?? 0,
    passesDefended: toSafeInt(row.passes_defended) ?? 0,
    interceptionsCaught: toSafeInt(row.interceptions_caught) ?? 0,
    interceptionTds: toSafeInt(row.interception_tds) ?? 0,
    forcedFumbles: toSafeInt(row.forced_fumbles) ?? 0,
    defensiveTds: toSafeInt(row.defensive_tds) ?? 0,
    fantasyPointsPpr: Number(row.fantasy_points_ppr ?? 0),
  };
}

function toSplitAggregate(source: SplitAggRow | null): GridstreamPlayerSplitAggregate {
  return {
    games: Number(source?.games ?? 0),
    passYds: Number(source?.pass_yds ?? 0),
    passTds: Number(source?.pass_tds ?? 0),
    passFirstDowns: Number(source?.pass_first_downs ?? 0),
    rushYds: Number(source?.rush_yds ?? 0),
    rushTds: Number(source?.rush_tds ?? 0),
    rushFirstDowns: Number(source?.rush_first_downs ?? 0),
    recYds: Number(source?.rec_yds ?? 0),
    recTds: Number(source?.rec_tds ?? 0),
    recFirstDowns: Number(source?.rec_first_downs ?? 0),
    fumbles: Number(source?.fumbles ?? 0),
    fumblesLost: Number(source?.fumbles_lost ?? 0),
    forcedFumbles: Number(source?.forced_fumbles ?? 0),
    ppr: Number(source?.ppr ?? 0),
    defTackles: Number(source?.def_tackles ?? 0),
    defSacks: Number(source?.def_sacks ?? 0),
    defQbHits: Number(source?.def_qb_hits ?? 0),
    defPd: Number(source?.def_pd ?? 0),
    defInts: Number(source?.def_ints ?? 0),
    defIntTds: Number(source?.def_int_tds ?? 0),
    defTds: Number(source?.def_tds ?? 0),
  };
}

function sortFacetBuckets(
  criterion: GridstreamPlayerBrowseCriterion,
  buckets: GridstreamPlayerBucket[]
): GridstreamPlayerBucket[] {
  if (criterion === 'draftYear' || criterion === 'season') {
    return buckets.sort((a, b) => {
      const aInt = toSafeInt(a.key);
      const bInt = toSafeInt(b.key);
      if (aInt != null && bInt != null && aInt !== bInt) return bInt - aInt;
      return collator.compare(a.label, b.label);
    });
  }

  return buckets.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return collator.compare(a.label, b.label);
  });
}

function normalizeFacetBuckets(
  criterion: GridstreamPlayerBrowseCriterion,
  rows: ApiGridstreamFacetBucket[] | undefined
): GridstreamPlayerBucket[] {
  const parsed: GridstreamPlayerBucket[] = [];
  for (const row of rows ?? []) {
    const key = normalizeString(row.key);
    if (!key) continue;
    parsed.push({
      criterion,
      key,
      label: normalizeString(row.label) || key,
      count: Number(row.count ?? 0),
    });
  }
  return sortFacetBuckets(criterion, parsed);
}

function normalizeRosterStatusFacets(
  rows: ApiGridstreamFacetBucket[] | undefined
): GridstreamPlayerRosterStatusFacet[] {
  const parsed: GridstreamPlayerRosterStatusFacet[] = [];
  for (const row of rows ?? []) {
    const key = normalizeString(row.key);
    if (!key) continue;
    parsed.push({
      key,
      label: normalizeString(row.label) || key,
      count: Number(row.count ?? 0),
    });
  }
  return parsed.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return collator.compare(a.label, b.label);
  });
}

function resolveTeamLogoUrl(row: ApiGridstreamTeamListItem): string | null {
  const logos = row.logos ?? [];
  const byType = new Map<string, string>();
  for (const logo of logos) {
    const key = normalizeString(logo.logo_type).toLowerCase();
    const url = normalizeString(logo.url);
    if (!key || !url) continue;
    byType.set(key, url);
  }
  return (
    byType.get('scoreboard') ??
    byType.get('scoreboard-dark') ??
    byType.get('dark') ??
    byType.get('default') ??
    logos.map((logo) => normalizeString(logo.url)).find(Boolean) ??
    null
  );
}

function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    const normalized =
      typeof value === 'number'
        ? String(value)
        : typeof value === 'boolean'
          ? value
            ? 'true'
            : 'false'
          : normalizeString(value);
    if (!normalized) return;
    searchParams.set(key, normalized);
  });
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

async function fetchGridstreamJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeoutMs = 12_000;
  const timeoutController = new AbortController();
  const forwardAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', forwardAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: timeoutController.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = await response.text().catch(() => '');
      const message = payload || response.statusText || 'Gridstream API request failed';
      throw new Error(`${response.status}: ${message}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`Gridstream API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export function gridstreamYearRangeDescending(fromYear: number, toYear: number): number[] {
  const from = Math.floor(fromYear);
  const to = Math.floor(toYear);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, index) => to - index);
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = toSafeInt(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value: string | null | undefined): boolean | null {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'n') {
    return false;
  }
  return null;
}

function parseBrowseCriterion(value: string | null | undefined): GridstreamPlayerBrowseCriterion {
  const normalized = normalizeString(value);
  if (
    normalized === 'team' ||
    normalized === 'position' ||
    normalized === 'draftYear' ||
    normalized === 'season'
  ) {
    return normalized;
  }
  return 'team';
}

function parseColumnSelection(value: string | null | undefined): GridstreamPlayerTableColumnKey[] {
  const normalized = normalizeString(value);
  if (!normalized) return [...GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS];
  const rawColumns = normalized
    .split(',')
    .map((column) => normalizeString(column))
    .filter(Boolean);
  return sanitizeGridstreamPlayerTableColumns(rawColumns);
}

function columnSelectionToParam(columns: readonly GridstreamPlayerTableColumnKey[]): string | null {
  const normalized = sanitizeGridstreamPlayerTableColumns(columns);
  if (
    normalized.length === GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS.length &&
    normalized.every((column, index) => column === GRIDSTREAM_PLAYER_DEFAULT_VISIBLE_COLUMNS[index])
  ) {
    return null;
  }
  return normalized.join(',');
}

function parseSortState(
  sortValue: string | null | undefined,
  directionValue: string | null | undefined
): GridstreamPlayerSortState | null {
  const key = parseSortKey(sortValue);
  if (!key) return null;
  const direction = parseSortDirection(directionValue) ?? defaultGridstreamSortDirectionForKey(key);
  return { key, direction };
}

function toApiPlayerOrdering(sort: GridstreamPlayerSortState | null | undefined): string | null {
  if (!sort) return null;

  if (sort.key === 'age') {
    return sort.direction === 'asc' ? '-birth_date' : 'birth_date';
  }

  const fieldMap: Record<GridstreamPlayerSortKey, string> = {
    player: 'last_name',
    team: 'current_team__abbreviation',
    position: 'position',
    age: 'birth_date',
    status: 'roster_status',
    draftYear: 'draft_year',
    seasons: 'last_season_played',
    seasonsCount: 'seasons_count',
    gamesPlayed: 'games_played',
    completions: 'career_completions',
    passAttempts: 'career_pass_attempts',
    completionPct: 'career_completion_pct',
    passYards: 'career_passing_yards',
    passYdsPerGame: 'career_pass_yards_per_game',
    yardsPerAttempt: 'career_pass_yards_per_attempt',
    passTd: 'career_passing_tds',
    interceptions: 'career_interceptions_thrown',
    passerRating: 'career_passer_rating',
    sacksTaken: 'career_sacks_taken',
    carries: 'career_carries',
    rushYards: 'career_rushing_yards',
    rushYdsPerGame: 'career_rush_yards_per_game',
    yardsPerCarry: 'career_yards_per_carry',
    rushTd: 'career_rushing_tds',
    receptions: 'career_receptions',
    targets: 'career_targets',
    catchPct: 'career_catch_pct',
    recYards: 'career_receiving_yards',
    recYdsPerGame: 'career_rec_yards_per_game',
    yardsPerReception: 'career_yards_per_reception',
    yardsPerTarget: 'career_yards_per_target',
    recTd: 'career_receiving_tds',
    scrimmageYards: 'career_scrimmage_yards',
    totalTd: 'career_total_touchdowns',
    tdPerGame: 'career_touchdowns_per_game',
    longGain: 'career_long_gain',
    firstDowns: 'career_first_downs',
    fumbles: 'career_fumbles',
    fumblesLost: 'career_fumbles_lost',
    tackles: 'career_tackles_total',
    sacksMade: 'career_sacks_made',
    defInterceptions: 'career_interceptions_caught',
    passesDefended: 'career_passes_defended',
    forcedFumbles: 'career_forced_fumbles',
    fgMade: 'career_fg_made',
    fgAttempts: 'career_fg_attempts',
    punts: 'career_punt_attempts',
  };
  const field = fieldMap[sort.key];
  if (!field) return null;
  return sort.direction === 'desc' ? `-${field}` : field;
}

export function parseGridstreamPlayerRouteState(
  params: GridstreamSearchParamReader
): GridstreamPlayerRouteState {
  const search = normalizeString(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.search));
  const team = normalizeUpperTokenListParam(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.team));
  const teamNot = normalizeUpperTokenListParam(
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.teamNot)
  );
  const position = normalizeUpper(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.position)) || null;
  const draftYear = normalizeNumericTokenListParam(
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.draftYear)
  );
  const season = normalizeNumericTokenListParam(
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.season)
  );
  const statsSeason = toSafeInt(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.statsSeason));
  const rawStatsWeek = toSafeInt(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.statsWeek));
  const statsWeek = statsSeason == null ? null : rawStatsWeek;
  const rosterStatusTokens = rosterStatusTokensFromFilter(
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.rosterStatus)
  );
  const rosterStatus = rosterStatusTokens.length > 0 ? rosterStatusTokens.join(', ') : null;
  const activeRaw = params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.active);
  const activeParam = parseBooleanFlag(activeRaw);
  const isActive = activeRaw == null ? true : activeParam;
  const page = parsePositiveInt(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.page), 1);
  const browseBy = parseBrowseCriterion(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.browse));
  const sort = parseSortState(
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.sort),
    params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.direction)
  );
  const columns = parseColumnSelection(params.get(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.columns));

  return {
    filters: {
      search,
      team,
      teamNot,
      position,
      draftYear,
      season,
      statsSeason,
      statsWeek,
      rosterStatus,
      isActive,
    },
    page,
    browseBy,
    sort,
    columns,
  };
}

export function toGridstreamPlayerRouteSearchParams(
  state: GridstreamPlayerRouteState
): URLSearchParams {
  const params = new URLSearchParams();
  if (normalizeString(state.filters.search)) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.search, normalizeString(state.filters.search));
  }
  const normalizedTeam = normalizeUpperTokenListParam(state.filters.team);
  if (normalizedTeam) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.team, normalizedTeam);
  }
  const normalizedTeamNot = normalizeUpperTokenListParam(state.filters.teamNot);
  if (normalizedTeamNot) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.teamNot, normalizedTeamNot);
  }
  if (normalizeUpper(state.filters.position)) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.position, normalizeUpper(state.filters.position));
  }
  const normalizedDraftYears = normalizeNumericTokenListParam(state.filters.draftYear);
  if (normalizedDraftYears) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.draftYear, normalizedDraftYears);
  }
  const normalizedSeasons = normalizeNumericTokenListParam(state.filters.season);
  if (normalizedSeasons) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.season, normalizedSeasons);
  }
  if (state.filters.statsSeason != null) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.statsSeason, String(state.filters.statsSeason));
  }
  if (state.filters.statsSeason != null && state.filters.statsWeek != null) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.statsWeek, String(state.filters.statsWeek));
  }
  const rosterStatusParam = rosterStatusApiValueFromFilter(state.filters.rosterStatus);
  if (rosterStatusParam) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.rosterStatus, rosterStatusParam);
  }
  if (state.filters.isActive === false) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.active, '0');
  } else if (state.filters.isActive === null) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.active, 'all');
  }
  if (state.page > 1) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.page, String(state.page));
  }
  if (state.browseBy !== 'team') {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.browse, state.browseBy);
  }
  if (state.sort) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.sort, state.sort.key);
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.direction, state.sort.direction);
  }
  const columns = columnSelectionToParam(state.columns);
  if (columns) {
    params.set(GRIDSTREAM_PLAYER_ROUTE_PARAM_KEYS.columns, columns);
  }
  return params;
}

export async function fetchGridstreamPlayersDirectoryPage(
  input: FetchGridstreamPlayersDirectoryPageInput
): Promise<GridstreamPlayerDirectoryPage> {
  const page = padPositiveInt(input.page, 1);
  const pageSize = padPositiveInt(input.pageSize, 25);
  const fallbackEnabled = input.fallbackToMock !== false;
  const normalizedBase = resolveGridstreamApiBase(input.apiBase);
  const rosterStatusParam = rosterStatusApiValueFromFilter(input.filters.rosterStatus ?? null);
  const hasInactiveRosterStatus = rosterStatusTokensFromFilter(input.filters.rosterStatus).some(
    (token) => isInactiveRosterStatusToken(token)
  );
  const isActiveParam =
    input.filters.isActive === false
      ? false
      : input.filters.isActive === true && hasInactiveRosterStatus
        ? null
        : (input.filters.isActive ?? null);
  const effectiveFilters: Partial<GridstreamPlayerFilterState> = {
    ...input.filters,
    isActive: isActiveParam,
  };
  const ordering = toApiPlayerOrdering(input.sort);

  try {
    const query = buildQueryString({
      page,
      page_size: pageSize,
      search: input.filters.search ?? null,
      team: normalizeUpperTokenListParam(input.filters.team),
      team_not: normalizeUpperTokenListParam(input.filters.teamNot),
      position: normalizeUpper(input.filters.position) || null,
      draft_year: normalizeNumericTokenListParam(input.filters.draftYear),
      season: normalizeNumericTokenListParam(input.filters.season),
      stats_season: input.filters.statsSeason ?? null,
      stats_week: input.filters.statsSeason == null ? null : (input.filters.statsWeek ?? null),
      roster_status: rosterStatusParam,
      is_active: isActiveParam,
      ordering,
    });
    const url = `${normalizedBase}/players/${query}`;
    const payload = await fetchGridstreamJson<ApiGridstreamPlayerListResponse>(url, input.signal);
    const items = (payload.results ?? []).map(mapApiPlayerSummary);
    const total = Number(payload.count ?? items.length);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const facets: GridstreamPlayerDirectoryFacets = payload.facets
      ? {
          team: normalizeFacetBuckets('team', payload.facets.team),
          position: normalizeFacetBuckets('position', payload.facets.position),
          draftYear: normalizeFacetBuckets('draftYear', payload.facets.draftYear),
          season: normalizeFacetBuckets('season', payload.facets.season),
          rosterStatus: normalizeRosterStatusFacets(payload.facets.rosterStatus),
        }
      : {
          team: buildGridstreamPlayerBuckets(items, 'team'),
          position: buildGridstreamPlayerBuckets(items, 'position'),
          draftYear: buildGridstreamPlayerBuckets(items, 'draftYear'),
          season: buildGridstreamPlayerBuckets(items, 'season'),
          rosterStatus: buildGridstreamRosterStatusFacets(items),
        };
    return {
      items,
      count: total,
      page,
      pageSize,
      totalPages,
      next: payload.next ?? null,
      previous: payload.previous ?? null,
      facets,
      source: 'api',
    };
  } catch (error) {
    if (!fallbackEnabled) throw error;
    const filtered = filterGridstreamPlayers(GRIDSTREAM_PLAYERS_MOCK_DATA, effectiveFilters);
    const all = sortGridstreamPlayers(filtered, input.sort ?? null);
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    return {
      items,
      count: all.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      next: null,
      previous: null,
      facets: {
        team: buildGridstreamPlayerBuckets(all, 'team'),
        position: buildGridstreamPlayerBuckets(all, 'position'),
        draftYear: buildGridstreamPlayerBuckets(all, 'draftYear'),
        season: buildGridstreamPlayerBuckets(all, 'season'),
        rosterStatus: buildGridstreamRosterStatusFacets(all),
      },
      source: 'mock',
      error: error instanceof Error ? error.message : 'Failed to load players from API',
    };
  }
}

export async function fetchGridstreamPlayerTeamOptions(
  apiBase: string,
  signal?: AbortSignal
): Promise<GridstreamTeamFilterOption[]> {
  const normalizedBase = resolveGridstreamApiBase(apiBase);
  const url = `${normalizedBase}/teams/`;
  const payload = await fetchGridstreamJson<
    ApiGridstreamTeamListItem[] | ApiPageNumberResponse<ApiGridstreamTeamListItem>
  >(url, signal);
  const rows = Array.isArray(payload) ? payload : (payload.results ?? []);
  const mapped: GridstreamTeamFilterOption[] = [];
  for (const row of rows) {
    const abbreviation = normalizeUpper(row.abbreviation);
    if (!abbreviation) continue;
    const fallbackAlignment = GRIDSTREAM_TEAM_ALIGNMENT_BY_ABBR[abbreviation];
    mapped.push({
      abbreviation,
      displayName: normalizeString(row.display_name) || abbreviation,
      logoUrl: resolveTeamLogoUrl(row),
      colorPrimary: row.color_primary ?? null,
      colorSecondary: row.color_secondary ?? null,
      conference: normalizeString(row.conference) || fallbackAlignment?.conference || null,
      division: normalizeString(row.division) || fallbackAlignment?.division || null,
    });
  }

  const unique = new Map<string, GridstreamTeamFilterOption>();
  for (const team of mapped) unique.set(team.abbreviation, team);
  return sortGridstreamTeamFilterOptions(Array.from(unique.values()));
}

export async function fetchGridstreamPlayerProfile(
  input: FetchGridstreamPlayerProfileInput
): Promise<GridstreamPlayerProfile> {
  const normalizedBase = resolveGridstreamApiBase(input.apiBase);
  const playerId = normalizeString(input.playerId);
  const url = `${normalizedBase}/players/${encodeURIComponent(playerId)}/`;
  const payload = await fetchGridstreamJson<ApiGridstreamPlayerDetail>(url, input.signal);
  return mapApiPlayerProfile(payload);
}

export async function fetchGridstreamPlayerGamelogPage(
  input: FetchGridstreamPlayerGamelogInput
): Promise<GridstreamPlayerGamelogPage> {
  const normalizedBase = resolveGridstreamApiBase(input.apiBase);
  const playerId = normalizeString(input.playerId);
  const page = padPositiveInt(input.page, 1);
  const pageSize = padPositiveInt(input.pageSize, 20);
  const query = buildQueryString({
    page,
    page_size: pageSize,
    season: input.season ?? null,
  });
  const url = `${normalizedBase}/players/${encodeURIComponent(playerId)}/gamelog/${query}`;
  const payload = await fetchGridstreamJson<ApiPageNumberResponse<ApiGridstreamPlayerGamelogRow>>(
    url,
    input.signal
  );
  const items = (payload.results ?? []).map(mapApiPlayerGamelogRow);
  const count = Number(payload.count ?? items.length);
  return {
    items,
    count,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
    next: payload.next ?? null,
    previous: payload.previous ?? null,
  };
}

export async function fetchGridstreamPlayerSplits(
  input: FetchGridstreamPlayerSplitsInput
): Promise<GridstreamPlayerSplits> {
  const normalizedBase = resolveGridstreamApiBase(input.apiBase);
  const playerId = normalizeString(input.playerId);
  const query = buildQueryString({
    season: input.season ?? null,
  });
  const url = `${normalizedBase}/players/${encodeURIComponent(playerId)}/splits/${query}`;
  const payload = await fetchGridstreamJson<ApiGridstreamPlayerSplitsRaw>(url, input.signal);
  return {
    home: toSplitAggregate(payload.home ?? null),
    away: toSplitAggregate(payload.away ?? null),
    regular: toSplitAggregate(payload.regular ?? null),
    postseason: toSplitAggregate(payload.postseason ?? null),
    grass: toSplitAggregate(payload.grass ?? null),
    turf: toSplitAggregate(payload.turf ?? null),
    wins: toSplitAggregate(payload.wins ?? null),
    losses: toSplitAggregate(payload.losses ?? null),
    division: toSplitAggregate(payload.division ?? null),
    nondivision: toSplitAggregate(payload.nondivision ?? null),
  };
}
