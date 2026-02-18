import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { PlayAnimation } from '../PlayAnimation';
import { PLAY_ANIMATION_SCENARIOS } from '../play-animation-scenarios';

/**
 * Broad snapshot coverage for supported play shapes.
 *
 * Note: this file validates rendering structure + snapshots.
 * Animation ordering/timing guarantees live in PlayAnimation.sequencing.test.tsx.
 */
describe('PlayAnimation scenario coverage', () => {
  it.each(PLAY_ANIMATION_SCENARIOS)('renders scenario: $id', (scenario) => {
    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={scenario.play} awayAbbr={scenario.awayAbbr} />
      </svg>
    );

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('g').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it.each(PLAY_ANIMATION_SCENARIOS)('matches scenario snapshot: $id', (scenario) => {
    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={scenario.play} awayAbbr={scenario.awayAbbr} />
      </svg>
    );

    expect(container.firstChild).toMatchSnapshot();
  });
});
