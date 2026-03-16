import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { FantasyRosterEntry, HudTeam } from '@atlas/sdk/gridstream/types';
import { FantasyPanel } from '../FantasyPanel';

const away: HudTeam = {
  abbr: 'SEA',
  name: 'Seahawks',
  displayName: 'Seattle Seahawks',
  color: '69be28',
  altColor: '002244',
  logoUrl: '',
  record: '14-3',
  endzoneName: 'SEAHAWKS',
};

const home: HudTeam = {
  abbr: 'NE',
  name: 'Patriots',
  displayName: 'New England Patriots',
  color: '002244',
  altColor: 'c60c30',
  logoUrl: '',
  record: '14-3',
  endzoneName: 'PATRIOTS',
};

describe('FantasyPanel scoring views', () => {
  it('switches displayed points between PPR, HALF, and STD', () => {
    const fantasyAway: FantasyRosterEntry[] = [
      {
        name: 'R.Shaheed',
        position: 'WR',
        points: 10.4,
        pointsPpr: 10.4,
        pointsHalfPpr: 8.9,
        pointsStandard: 7.1,
        breakdown: '3 rec · 41 yds · 1 car · 5 yds',
      },
    ];

    render(
      <FantasyPanel
        away={away}
        home={home}
        fantasyAway={fantasyAway}
        fantasyHome={[]}
        playerSeasonStats={{}}
      />
    );

    expect(screen.getByText('10.4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'HALF' }));
    expect(screen.getByText('8.9')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'STD' }));
    expect(screen.getByText('7.1')).toBeInTheDocument();
  });
});
