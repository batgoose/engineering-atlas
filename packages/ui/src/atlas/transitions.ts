/**
 * Transition Utilities
 *
 * Manages animated transitions between sphere and grid states
 */

import type { Point3D } from './sphere-math';
import { lerp3D, easeOutCubic, easeOutExpo } from './sphere-math';

export type AtlasViewState = 'sphere' | 'filtered';

export interface IconState {
  id: string;
  currentPosition: Point3D;
  targetPosition: Point3D;
  spherePosition: Point3D; // original position on sphere
  gridPosition?: Point3D; // position when filtered (if applicable)
  isFiltered: boolean; // true = goes to grid, false = stays in sphere
  scale: number;
  opacity: number;
  transitionProgress: number; // 0 to 1
}

export interface TransitionConfig {
  duration: number; // ms
  staggerDelay: number; // ms between each icon starting
  easing: (t: number) => number;
}

export const DEFAULT_TRANSITION: TransitionConfig = {
  duration: 600,
  staggerDelay: 20,
  easing: easeOutCubic,
};

export const SNAPPY_TRANSITION: TransitionConfig = {
  duration: 400,
  staggerDelay: 15,
  easing: easeOutExpo,
};

/**
 * Creates the initial state for all icons on the sphere
 */
export function createInitialIconStates(
  ids: string[],
  spherePositions: Point3D[]
): Map<string, IconState> {
  const states = new Map<string, IconState>();

  ids.forEach((id, index) => {
    const pos = spherePositions[index];
    states.set(id, {
      id,
      currentPosition: { ...pos },
      targetPosition: { ...pos },
      spherePosition: { ...pos },
      isFiltered: false,
      scale: 1,
      opacity: 1,
      transitionProgress: 1,
    });
  });

  return states;
}

/**
 * Updates icon states when a filter is applied
 *
 * @param states - current icon states
 * @param filteredIds - IDs of icons that match the filter (go to grid)
 * @param gridPositions - target positions for filtered icons
 * @param secondarySphereCenter - center point for non-filtered sphere
 * @param secondarySphereScale - scale factor for non-filtered sphere
 */
export function applyFilter(
  states: Map<string, IconState>,
  filteredIds: Set<string>,
  gridPositions: Point3D[],
  secondarySphereCenter: Point3D,
  secondarySphereScale: number
): Map<string, IconState> {
  const newStates = new Map<string, IconState>();
  let gridIndex = 0;

  states.forEach((state, id) => {
    const isFiltered = filteredIds.has(id);

    let targetPosition: Point3D;
    let gridPosition: Point3D | undefined;

    if (isFiltered) {
      // goes to grid
      gridPosition = gridPositions[gridIndex++];
      targetPosition = gridPosition;
    } else {
      // stays in sphere, but sphere moves and shrinks
      targetPosition = {
        x: state.spherePosition.x * secondarySphereScale + secondarySphereCenter.x,
        y: state.spherePosition.y * secondarySphereScale + secondarySphereCenter.y,
        z: state.spherePosition.z * secondarySphereScale + secondarySphereCenter.z,
      };
    }

    newStates.set(id, {
      ...state,
      targetPosition,
      gridPosition,
      isFiltered,
      transitionProgress: 0, // restart animation
      scale: isFiltered ? 1 : secondarySphereScale * 0.8,
      opacity: isFiltered ? 1 : 0.5,
    });
  });

  return newStates;
}

/**
 * Resets all icons back to sphere state
 */
export function clearFilter(states: Map<string, IconState>): Map<string, IconState> {
  const newStates = new Map<string, IconState>();

  states.forEach((state, id) => {
    newStates.set(id, {
      ...state,
      targetPosition: { ...state.spherePosition },
      isFiltered: false,
      transitionProgress: 0,
      scale: 1,
      opacity: 1,
    });
  });

  return newStates;
}

/**
 * Updates positions during animation frame
 * Call this in your render loop
 *
 * @param states - current icon states
 * @param deltaTime - time since last frame in ms
 * @param config - transition configuration
 * @returns updated states and whether animation is complete
 */
export function updateTransitions(
  states: Map<string, IconState>,
  deltaTime: number,
  config: TransitionConfig = DEFAULT_TRANSITION
): { states: Map<string, IconState>; isComplete: boolean } {
  const newStates = new Map<string, IconState>();
  let allComplete = true;

  states.forEach((state, id) => {
    if (state.transitionProgress >= 1) {
      newStates.set(id, state);
      return;
    }

    allComplete = false;

    // increment progress
    const progress = Math.min(1, state.transitionProgress + deltaTime / config.duration);
    const easedProgress = config.easing(progress);

    // interpolate position
    const currentPosition = lerp3D(state.currentPosition, state.targetPosition, easedProgress);

    newStates.set(id, {
      ...state,
      currentPosition,
      transitionProgress: progress,
    });
  });

  return { states: newStates, isComplete: allComplete };
}
