/**
 * Sphere Math Utilities
 *
 * Distributes points evenly across a sphere surface using the fibonacci spiral method
 * Framework-agnostic - used by React/Vue/Angular/Svelte implementations
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface SpherePoint extends Point3D {
  index: number;
  phi: number; // polar angle
  theta: number; // azimuthal angle
}

/**
 * Generates evenly distributed points on a sphere using fibonacci spiral.
 * This gives better distribution than random or lat/long grids.
 *
 * @param count - number of points to generate
 * @param radius - sphere radius (default 1, scale as needed)
 */
export function fibonacciSphere(count: number, radius: number = 1): SpherePoint[] {
  const points: SpherePoint[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    // y goes from 1 to -1 (top to bottom of sphere)
    const y = 1 - (i / (count - 1)) * 2;

    // radius at this y level
    const radiusAtY = Math.sqrt(1 - y * y);

    // golden angle increment
    const theta = (2 * Math.PI * i) / goldenRatio;

    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;

    // calculate spherical coordinates for potential use
    const phi = Math.acos(y);

    points.push({
      index: i,
      x: x * radius,
      y: y * radius,
      z: z * radius,
      phi,
      theta: theta % (2 * Math.PI),
    });
  }

  return points;
}

/**
 * interpolates between two 3D points.
 *
 * @param from - starting position
 * @param to - target position
 * @param t - progress from 0 to 1
 */
export function lerp3D(from: Point3D, to: Point3D, t: number): Point3D {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * Easing function for smooth animations (ease-out cubic)
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Easing function for snappy animations (ease-out expo)
 */
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * Easing function for bouncy feel (ease-out back)
 */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Calculates the scale factor for a secondary (filtered-out) sphere
 *
 * @param originalCount - total icons
 * @param remainingCount - icons staying in sphere
 */
export function getFilteredSphereScale(originalCount: number, remainingCount: number): number {
  // scale proportionally to cube root of ratio (preserves visual density)
  const ratio = remainingCount / originalCount;
  return Math.cbrt(ratio);
}
