/**
 * Atlas Visualization Utilities
 *
 * Shared math, layout, and state management for the 3D competency sphere
 * Framework-agnostic - implementations in React/Vue/Angular/Svelte
 *
 * use these utilities with their respective 3D libraries
 */

// sphere distribution and math
export {
  fibonacciSphere,
  lerp3D,
  easeOutCubic,
  easeOutExpo,
  easeOutBack,
  getFilteredSphereScale,
  type Point3D,
  type SpherePoint,
} from './sphere-math';

// grid layout for filtered view
export {
  getDefaultGridConfig,
  calculateGridPositions,
  getSecondarySpherePlacement,
  getStaggerDelay,
  type GridConfig,
  type GridPosition,
} from './grid-layout';

// animation transitions
export {
  createInitialIconStates,
  applyFilter,
  clearFilter,
  updateTransitions,
  DEFAULT_TRANSITION,
  SNAPPY_TRANSITION,
  type AtlasViewState,
  type IconState,
  type TransitionConfig,
} from './transitions';

// icon registry
export {
  ICON_REGISTRY,
  getIcon,
  getIconsByCategory,
  getCategories,
  type IconDefinition,
} from './icon-registry';
