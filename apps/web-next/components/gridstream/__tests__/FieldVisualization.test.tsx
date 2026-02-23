import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type {
  DriveProgress,
  HudTeam,
  PlayAnimationData,
  Situation,
  WeatherState,
} from '@atlas/sdk/gridstream/types';
import { FieldVisualization } from '../FieldVisualization';

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
  color: 'c60c30',
  altColor: '002244',
  logoUrl: '',
  record: '14-3',
  endzoneName: 'PATRIOTS',
};

const weather: WeatherState = {
  temperature: 72,
  condition: 'Clear',
  wind: '',
  isIndoor: false,
};

describe('FieldVisualization', () => {
  it('resets svg animation timeline when animation key changes', async () => {
    const setCurrentTime = vi.fn();
    const unpauseAnimations = vi.fn();
    Object.defineProperty(SVGSVGElement.prototype, 'setCurrentTime', {
      configurable: true,
      value: setCurrentTime,
    });
    Object.defineProperty(SVGSVGElement.prototype, 'unpauseAnimations', {
      configurable: true,
      value: unpauseAnimations,
    });

    const situation: Situation = {
      down: 1,
      distance: 10,
      yardLine: 35,
      side: 'SEA',
      downDistText: '1st & 10',
      possessionTeam: 'SEA',
    };

    const { rerender } = render(
      <FieldVisualization
        away={away}
        home={home}
        situation={situation}
        lastPlay={null}
        animationKey={1}
        weather={weather}
        venue="Levi's Stadium"
        currentDrive={null}
        isFinal={false}
      />
    );

    await waitFor(() => expect(unpauseAnimations).toHaveBeenCalled());
    await waitFor(() => expect(setCurrentTime).toHaveBeenCalledWith(0));

    rerender(
      <FieldVisualization
        away={away}
        home={home}
        situation={situation}
        lastPlay={null}
        animationKey={2}
        weather={weather}
        venue="Levi's Stadium"
        currentDrive={null}
        isFinal={false}
      />
    );

    await waitFor(() => expect(setCurrentTime).toHaveBeenCalled());
  });

  it('keeps LOS/drive/first-down guides visible during official timeout frames', () => {
    const situation: Situation = {
      down: 1,
      distance: 10,
      yardLine: 35,
      side: 'SEA',
      downDistText: '1st & 10',
      possessionTeam: 'SEA',
    };
    const currentDrive: DriveProgress = {
      plays: 2,
      yards: 30,
      time: '0:51',
      startYardLine: 35,
      startSide: 'SEA',
      team: 'SEA',
    };

    const { container } = render(
      <FieldVisualization
        away={away}
        home={home}
        situation={situation}
        lastPlay={null}
        animationKey={1}
        weather={weather}
        venue="Levi's Stadium"
        currentDrive={currentDrive}
        isFinal={false}
        fieldNotice="Official Timeout"
      />
    );

    expect(screen.getByText('OFFICIAL TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('DRIVE STARTED')).toBeInTheDocument();
    expect(screen.getByText('SEA 35')).toBeInTheDocument();
    expect(container.querySelector('line[stroke="#3b82f6"]')).toBeInTheDocument();
    expect(
      container.querySelector('line[stroke="#ffb612"][stroke-dasharray="8 5"]')
    ).toBeInTheDocument();
  });

  it('hides guides during official timeout before a kickoff', () => {
    const situation: Situation = {
      down: 0,
      distance: 0,
      yardLine: 35,
      side: 'SEA',
      downDistText: '',
      possessionTeam: 'SEA',
    };
    const currentDrive: DriveProgress = {
      plays: 0,
      yards: 0,
      time: '0:00',
      startYardLine: 35,
      startSide: 'SEA',
      team: 'SEA',
    };
    const lastPlay: PlayAnimationData = {
      type: 'kick',
      direction: 'middle',
      offenseTeam: 'SEA',
      startDistance: 0,
      fromYardline: 35,
      fromSide: 'SEA',
      toYardline: 0,
      toSide: 'NE',
      yardsGained: 65,
      isComplete: true,
      isFirstDown: false,
      isTurnover: false,
      description: 'Kickoff sequence pending',
    };

    const { container } = render(
      <FieldVisualization
        away={away}
        home={home}
        situation={situation}
        lastPlay={lastPlay}
        animationKey={1}
        weather={weather}
        venue="Levi's Stadium"
        currentDrive={currentDrive}
        isFinal={false}
        fieldNotice="Official Timeout"
        showPlayStartSpot
      />
    );

    expect(screen.getByText('OFFICIAL TIMEOUT')).toBeInTheDocument();
    expect(screen.queryByText('DRIVE STARTED')).not.toBeInTheDocument();
    expect(
      container.querySelector('line[stroke="#3b82f6"][stroke-width="2.5"]')
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('line[stroke="#ffb612"][stroke-dasharray="8 5"]')
    ).not.toBeInTheDocument();
  });
});
