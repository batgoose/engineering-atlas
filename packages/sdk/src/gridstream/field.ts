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

/** Half the span of the FG upright gate in SVG units (centred on FIELD_CENTER_Y).
 *  Gate runs from FIELD_CENTER_Y - FG_UPRIGHT_Y_HALF to FIELD_CENTER_Y + FG_UPRIGHT_Y_HALF.
 *  Wide-miss endY values should land outside this range.
 *  55px chosen to appear ~90px on screen after the 32-degree perspective compression. */
export const FG_UPRIGHT_Y_HALF = 55;

/** Depth of the gate frame in SVG X units (how far the prongs extend into the field). */
export const FG_UPRIGHT_DEPTH = 18;

/** X position of the FG upright gate BACK WALL within each endzone.
 *  Ball arcs terminate here; the open face (where the ball enters) is FG_UPRIGHT_DEPTH further in. */
export const AWAY_FG_UPRIGHT_X = AWAY_EZ_LEFT + 5; // = 55  (near back wall of away EZ — matches portal X)
export const HOME_FG_UPRIGHT_X = HOME_EZ_RIGHT - 5; // = 945 (near back wall of home EZ — matches portal X)

/** Field SVG Y coordinate targeted by made FG/XP arcs so the ball sweeps INTO the portal interior.
 *  Must stay in sync with PORTAL_CENTER_Y in FieldVisualization. */
export const FG_PORTAL_CENTER_Y = FIELD_CENTER_Y - 50; // = 160

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
export function yardToFieldPct(yardLine: number, side: string, awayAbbr: string): number {
  return side === awayAbbr ? yardLine : 100 - yardLine;
}

export function fieldPctToSvgX(pct: number): number {
  return FIELD_LEFT + (pct / 100) * FIELD_PLAY_WIDTH;
}

export function getFgEndpoints(possIsAway: boolean) {
  return {
    goalLineX: possIsAway ? HOME_EZ_LEFT : AWAY_EZ_RIGHT,
    /** X where the ball arc terminates for made/wide kicks — the upright gate centre. */
    uprightX: possIsAway ? HOME_FG_UPRIGHT_X : AWAY_FG_UPRIGHT_X,
    /** Absolute back wall of the endzone; still used by extra-point animations. */
    backWallX: possIsAway ? HOME_EZ_RIGHT : AWAY_EZ_LEFT,
  };
}

export const YARD_LINE_POSITIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((yd) => ({
  yard: yd,
  displayNumber: yd <= 50 ? yd : 100 - yd,
  x: fieldPctToSvgX(yd),
}));
