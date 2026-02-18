/**
 * Football field SVG geometry constants.
 * Coordinate system for the perspective-rendered field (viewBox="0 0 1000 420").
 */

export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 420;

export const FIELD_LEFT = 132;
export const FIELD_RIGHT = 868;
export const FIELD_TOP = 30;
export const FIELD_BOTTOM = 390;
export const FIELD_PLAY_WIDTH = FIELD_RIGHT - FIELD_LEFT; // 736

export const AWAY_EZ_LEFT = 50;
export const AWAY_EZ_RIGHT = FIELD_LEFT;
export const HOME_EZ_LEFT = FIELD_RIGHT;
export const HOME_EZ_RIGHT = 950;

export const FIELD_CENTER_Y = 210;

/** Perspective transform for the field container — exact v11 values */
export const FIELD_PERSPECTIVE = {
  perspective: '800px',
  transform: 'rotateX(32deg)',
  transformOrigin: 'center bottom',
} as const;

/**
 * Convert a yard line + side to a 0–100 field percentage.
 *
 * Convention: 0% = away team's goal line, 100% = home team's goal line.
 * `yardLine` is "yards from the possessing team's own endzone" (yardline_100).
 *
 * Examples:
 *   away team at their own 20 → yardToFieldPct(20, 'KC', 'KC') = 20
 *   home team at their own 34 → yardToFieldPct(34, 'SF', 'KC') = 100 - 34 = 66
 */
export function yardToFieldPct(
  yardLine: number,
  side: string,
  awayAbbr: string,
): number {
  return side === awayAbbr ? yardLine : 100 - yardLine;
}

export function fieldPctToSvgX(pct: number): number {
  return FIELD_LEFT + (pct / 100) * FIELD_PLAY_WIDTH;
}

export function getFgEndpoints(possIsAway: boolean) {
  return {
    goalLineX: possIsAway ? HOME_EZ_LEFT : AWAY_EZ_RIGHT,
    backWallX: possIsAway ? HOME_EZ_RIGHT : AWAY_EZ_LEFT,
  };
}

export const YARD_LINE_POSITIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => ({
  yard: yd,
  displayNumber: yd <= 50 ? yd : 100 - yd,
  x: fieldPctToSvgX(yd),
}));
