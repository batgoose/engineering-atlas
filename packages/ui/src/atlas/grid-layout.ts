/**
 * Grid Layout Utilities
 *
 * Calculates positions for icons when they leave the sphere
 * and arrange into a browsable grid/list
 */

import type { Point3D } from './sphere-math';

export interface GridConfig {
  columns: number;
  cellWidth: number;
  cellHeight: number;
  startX: number; // left edge of grid
  startY: number; // top edge of grid
  z: number; // z-depth (typically 0 or slightly forward)
  gap: number; // space between cells
}

export interface GridPosition extends Point3D {
  row: number;
  col: number;
}

/**
 * Default grid configuration
 * Adjust based on viewport and desired layout
 */
export function getDefaultGridConfig(itemCount: number, viewportWidth: number): GridConfig {
  // responsive columns
  let columns = 4;
  if (viewportWidth < 640) columns = 2;
  else if (viewportWidth < 1024) columns = 3;
  else if (itemCount > 12) columns = 5;

  const cellWidth = 1.2;
  const cellHeight = 1.2;
  const gap = 0.3;

  const totalWidth = columns * cellWidth + (columns - 1) * gap;

  return {
    columns,
    cellWidth,
    cellHeight,
    startX: -totalWidth / 2, // center the grid
    startY: 2.5, // above center (below top nav area)
    z: 0,
    gap,
  };
}

/**
 * Calculates grid positions for a list of items.
 * Returns positions in 3D space where icons should animate to.
 *
 * @param count - number of items to position
 * @param config - grid configuration
 */
export function calculateGridPositions(count: number, config: GridConfig): GridPosition[] {
  const positions: GridPosition[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % config.columns;
    const row = Math.floor(i / config.columns);

    const x = config.startX + col * (config.cellWidth + config.gap) + config.cellWidth / 2;
    const y = config.startY - row * (config.cellHeight + config.gap) - config.cellHeight / 2;
    const z = config.z;

    positions.push({ x, y, z, row, col });
  }

  return positions;
}

/**
 * Gets position for the secondary sphere (non-filtered icons)
 * Places it below and slightly back from the main view
 */
export function getSecondarySpherePlacement(): Point3D {
  return {
    x: 0,
    y: -2, // below the grid
    z: -1, // slightly back
  };
}

/**
 * Calculates staggered animation delays for grid items.
 * Items animate in a wave from top-left to bottom-right.
 *
 * @param index - item index in the grid
 * @param row - item's row
 * @param col - item's column
 * @param baseDelay - starting delay in ms
 * @param stagger - delay increment per step in ms
 */
export function getStaggerDelay(
  index: number,
  row: number,
  col: number,
  baseDelay: number = 0,
  stagger: number = 30
): number {
  // diagonal wave effect
  return baseDelay + (row + col) * stagger;
}
