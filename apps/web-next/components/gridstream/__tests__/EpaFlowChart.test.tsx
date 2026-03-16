import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { EpaTimelinePoint, GameTiming, HudTeam } from '@atlas/sdk/gridstream/types';
import { EpaFlowChart } from '../EpaFlowChart';

const away: HudTeam = {
  abbr: 'WAS',
  name: 'Commanders',
  displayName: 'Washington Commanders',
  color: '5a1414',
  altColor: 'ffb612',
  logoUrl: '',
  record: '5-12',
  endzoneName: 'COMMANDERS',
};

const home: HudTeam = {
  abbr: 'PHI',
  name: 'Eagles',
  displayName: 'Philadelphia Eagles',
  color: '004c54',
  altColor: 'a5acaf',
  logoUrl: '',
  record: '11-6',
  endzoneName: 'EAGLES',
};

const timing: GameTiming = {
  quarter: 3,
  clock: '11:38',
  elapsedMin: 33,
  totalMin: 60,
  isOT: false,
};

const timeline: EpaTimelinePoint[] = [
  {
    gameMin: 0,
    awayTotal: 0,
    homeTotal: 0,
    awayPass: 0,
    awayRush: 0,
    homePass: 0,
    homeRush: 0,
  },
  {
    gameMin: 30,
    awayTotal: 2.8,
    homeTotal: -2.8,
    awayPass: 1.2,
    awayRush: 1.6,
    homePass: -1.1,
    homeRush: -1.7,
  },
];

describe('EpaFlowChart', () => {
  it('shows per-chart legends and line hover label', () => {
    const { container } = render(
      <EpaFlowChart timeline={timeline} timing={timing} away={away} home={home} />
    );

    expect(
      screen.getByText('Estimated Points Allowed (EPA) - TOTAL / PASS / RUSH')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('WAS EPA legend')).toBeInTheDocument();
    expect(screen.getByLabelText('PHI EPA legend')).toBeInTheDocument();
    expect(screen.queryByText('PASS EPA Line')).not.toBeInTheDocument();

    const passLine = container.querySelector('path[stroke-dasharray="6 3"]');
    expect(passLine).toBeTruthy();
    fireEvent.mouseEnter(passLine!);
    expect(screen.getByText(/pass epa line/i)).toBeInTheDocument();
  });
});
