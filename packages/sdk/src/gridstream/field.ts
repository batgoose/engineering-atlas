/**
 * Football field SVG geometry constants.
 *
 * Defines the coordinate system for the perspective-rendered field.
 * All values are in SVG viewBox units (the field uses viewBox="0 0 1000 420").
 */

/** SVG viewBox dimensions */
export const FIELD_WIDTH = 1000;
export const FIELD_HEIGHT = 420;

/** Playing field boundaries (between goal lines) */
export const FIELD_LEFT = 132;    // away goal line x
export const FIELD_RIGHT = 868;   // home goal line x
export const FIELD_TOP = 30;
export const FIELD_BOTTOM = 390;
export const FIELD_PLAY_WIDTH = FIELD_RIGHT - FIELD_LEFT; // 736

/** Endzone boundaries */
export const AWAY_EZ_LEFT = 50;   // back wall of away endzone
export const AWAY_EZ_RIGHT = FIELD_LEFT; // 132 (goal line)
export const HOME_EZ_LEFT = FIELD_RIGHT; // 868 (goal line)
export const HOME_EZ_RIGHT = 950; // back wall of home endzone

/** Center line of the field (vertical midpoint) */
export const FIELD_CENTER_Y = 210;

/** Perspective transform for the field container */
export const FIELD_PERSPECTIVE = {
  perspective: '1100px',
  transform: 'rotateX(32deg)',
  transformOrigin: 'center 55%',
} as const;

/**
 * Convert a field percentage (0-100) to SVG x coordinate.
 * 0% = away goal line (x=132), 100% = home goal line (x=868).
 */
export function fieldPctToSvgX(pct: number): number {
  return FIELD_LEFT + (pct / 100) * FIELD_PLAY_WIDTH;
}

/**
 * Get the SVG x coordinates for a field goal target.
 *
 * goalLineX = front of target endzone (where uprights are)
 * backWallX = far end of target endzone
 *
 * @param possIsAway - true if the possessing team is the away team (kicking right)
 */
export function getFgEndpoints(possIsAway: boolean) {
  return {
    goalLineX: possIsAway ? HOME_EZ_LEFT : AWAY_EZ_RIGHT,  // 868 or 132
    backWallX: possIsAway ? HOME_EZ_RIGHT : AWAY_EZ_LEFT,  // 950 or 50
  };
}

/**
 * Yard line SVG x positions for the 10-yard markers.
 */
export const YARD_LINE_POSITIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => ({
  yard: yd,
  displayNumber: yd <= 50 ? yd : 100 - yd,
  x: fieldPctToSvgX(yd),
}));
