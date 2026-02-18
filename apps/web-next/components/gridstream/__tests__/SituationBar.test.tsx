import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { Situation } from '@atlas/sdk/gridstream/types';
import { SituationBar } from '../SituationBar';

// These guard against layout regressions where timeout states collapse or replace
// the down/distance row under the score bug.
const baseSituation: Situation = {
  down: 1,
  distance: 10,
  yardLine: 35,
  side: 'SEA',
  downDistText: '1st & 10',
  possessionTeam: 'SEA',
};

describe('SituationBar', () => {
  it('keeps down-and-distance visible during team timeout', () => {
    const { container } = render(
      <SituationBar
        situation={baseSituation}
        isFinal={false}
        timeoutNotice="SEA Timeout"
      />
    );

    expect(screen.getByText('1ST & 10')).toBeInTheDocument();
    expect(screen.getByText('AT')).toBeInTheDocument();
    expect(screen.getByText('SEA 35')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveStyle({ minHeight: '48px' });
  });

  it('does not replace down-and-distance with OFFICIAL TIMEOUT', () => {
    render(
      <SituationBar
        situation={baseSituation}
        isFinal={false}
        timeoutNotice="Official Timeout"
      />
    );

    expect(screen.getByText('1ST & 10')).toBeInTheDocument();
    expect(screen.queryByText('OFFICIAL TIMEOUT')).not.toBeInTheDocument();
    expect(screen.getByText('SEA 35')).toBeInTheDocument();
  });

  it('keeps the same outer min height for normal down-and-distance state', () => {
    const { container } = render(
      <SituationBar
        situation={baseSituation}
        isFinal={false}
      />
    );

    expect(screen.getByText('1ST & 10')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveStyle({ minHeight: '48px' });
  });
});
