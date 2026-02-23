/**
 * Gridstream constants.
 *
 * Static data consumed by transforms and UI layers.
 * No runtime dependencies — just plain objects and arrays.
 */

import type { PositionGroup } from './types';

// ─── Position Grouping ─────────────────────────────────────────

export const POSITION_ORDER: PositionGroup[] = ['QB', 'WR', 'RB', 'TE', 'K', 'DEF'];

export const POSITION_LABELS: Record<PositionGroup, string> = {
  QB: 'QUARTERBACK',
  WR: 'WIDE RECEIVER',
  RB: 'RUNNING BACK',
  TE: 'TIGHT END',
  K: 'KICKER',
  DEF: 'DEF / ST',
};

// ─── Play Type Mapping ──────────────────────────────────────────
// Maps Django/Go play_type strings to animation types

export const PLAY_TYPE_TO_ANIM = {
  pass: 'pass',
  run: 'rush',
  punt: 'kick',
  kickoff: 'kick',
  field_goal: 'fieldgoal',
  extra_point: 'fieldgoal',
  qb_kneel: 'rush',
  qb_spike: 'pass',
} as const;

// ─── Dome / Indoor Venues ───────────────────────────────────────
// Suppress weather particles for these venues

export const INDOOR_VENUE_KEYWORDS = new Set([
  'dome',
  'sofi',
  'allegiant',
  'at&t',
  'mercedes-benz',
  'lucas oil',
  'caesars superdome',
  'nrg',
  'ford field',
  'us bank',
  'state farm',
]);

/**
 * Check if a venue name suggests an indoor/domed stadium.
 * The Venue model has `is_indoor` but this is a client-side fallback.
 */
export function isLikelyIndoor(venueName: string): boolean {
  const lower = venueName.toLowerCase();
  for (const keyword of INDOOR_VENUE_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }
  return false;
}

// ─── Team Endzone Names ─────────────────────────────────────────
// Some teams use shortened endzone text vs full name

export const ENDZONE_NAMES: Record<string, string> = {
  ARI: 'CARDINALS',
  ATL: 'FALCONS',
  BAL: 'RAVENS',
  BUF: 'BILLS',
  CAR: 'PANTHERS',
  CHI: 'BEARS',
  CIN: 'BENGALS',
  CLE: 'BROWNS',
  DAL: 'COWBOYS',
  DEN: 'BRONCOS',
  DET: 'LIONS',
  GB: 'PACKERS',
  HOU: 'TEXANS',
  IND: 'COLTS',
  JAX: 'JAGUARS',
  KC: 'CHIEFS',
  LAC: 'CHARGERS',
  LAR: 'RAMS',
  LV: 'RAIDERS',
  MIA: 'DOLPHINS',
  MIN: 'VIKINGS',
  NE: 'PATRIOTS',
  NO: 'SAINTS',
  NYG: 'GIANTS',
  NYJ: 'JETS',
  PHI: 'EAGLES',
  PIT: 'STEELERS',
  SEA: 'SEAHAWKS',
  SF: '49ERS',
  TB: 'BUCCANEERS',
  TEN: 'TITANS',
  WAS: 'COMMANDERS',
};

// ─── Quarter Length ─────────────────────────────────────────────

/** Minutes per regulation quarter */
export const QUARTER_MINUTES = 15;

/** Minutes per overtime period */
export const OT_MINUTES = 10;

/** Total regulation game length in minutes */
export const REGULATION_MINUTES = QUARTER_MINUTES * 4; // 60

/** Total game length if overtime is played */
export const OT_GAME_MINUTES = REGULATION_MINUTES + OT_MINUTES; // 70
