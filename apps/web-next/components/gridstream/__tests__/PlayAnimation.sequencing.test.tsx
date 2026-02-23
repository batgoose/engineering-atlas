import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { PlayAnimationData } from '@atlas/sdk/gridstream/types';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';
import { gridstreamColors as C } from '@atlas/sdk/gridstream/theme';
import { PlayAnimation } from '../PlayAnimation';
import { PLAY_ANIMATION_SCENARIOS } from '../play-animation-scenarios';

/**
 * Sequencing regressions:
 * - makes sure delayed overlays stay delayed
 * - verifies line-draw behavior is normalized and deterministic
 * - checks directional mirroring and key multi-phase play flows
 */
function scenarioById(id: string) {
  const found = PLAY_ANIMATION_SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`Missing scenario "${id}"`);
  return found;
}

function _parseTranslateXY(transform: string | null): { x: number; y: number } | null {
  if (!transform) return null;
  const match = transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)\s*[ ,]\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (!match) return null;
  return {
    x: Number.parseFloat(match[1] ?? ''),
    y: Number.parseFloat(match[2] ?? ''),
  };
}

describe('PlayAnimation sequencing guards', () => {
  it('delays kickoff return trail and runner until after kick flight', () => {
    const kickoffReturn = scenarioById('kickoff-return');
    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={kickoffReturn.play} awayAbbr={kickoffReturn.awayAbbr} />
      </svg>
    );

    const returnPath = container.querySelector('[data-anim="kick-return-path"]');
    const returnRunner = container.querySelector('[data-anim="kick-return-runner"]');
    const landingDot = container.querySelector('[data-anim="kick-landing-dot"]');
    const endDot = container.querySelector('[data-anim="kick-end-dot"]');
    expect(returnPath).toBeInTheDocument();
    expect(returnRunner).toBeInTheDocument();
    expect(landingDot).toBeInTheDocument();
    expect(endDot).toBeInTheDocument();
    expect(returnPath).toHaveAttribute('visibility', 'hidden');
    expect(returnRunner).toHaveAttribute('visibility', 'hidden');
    expect(landingDot).toHaveAttribute('visibility', 'hidden');
    expect(endDot).toHaveAttribute('visibility', 'hidden');

    const returnPathAnimate = returnPath?.querySelector(
      'animate[attributeName="stroke-dashoffset"]'
    );
    expect(returnPathAnimate).toBeInTheDocument();
    const begin = returnPathAnimate?.getAttribute('begin') ?? '0s';
    const beginSeconds = Number.parseFloat(begin.replace('s', ''));
    expect(beginSeconds).toBeGreaterThan(0.5);
    expect(beginSeconds).toBeGreaterThan(ANIM_TIMING.kick * 0.45);

    const runnerMotion = returnRunner?.querySelector('animateMotion');
    expect(runnerMotion).toBeInTheDocument();
    const runnerBegin = runnerMotion?.getAttribute('begin') ?? '0s';
    const runnerBeginSeconds = Number.parseFloat(runnerBegin.replace('s', ''));
    expect(runnerBeginSeconds).toBeGreaterThan(0.5);

    const landingSet = landingDot?.querySelector('set[attributeName="visibility"]');
    const endSet = endDot?.querySelector('set[attributeName="visibility"]');
    expect(landingSet).toBeInTheDocument();
    expect(endSet).toBeInTheDocument();
    const landingBeginSeconds = Number.parseFloat(
      (landingSet?.getAttribute('begin') ?? '0s').replace('s', '')
    );
    const endBeginSeconds = Number.parseFloat(
      (endSet?.getAttribute('begin') ?? '0s').replace('s', '')
    );
    expect(landingBeginSeconds).toBeGreaterThan(ANIM_TIMING.kick * 0.45);
    expect(endBeginSeconds).toBeGreaterThan(landingBeginSeconds);
  });

  it('delays pass endpoint marker until the pass flight finishes', () => {
    const completePass = scenarioById('pass-complete-right');
    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={completePass.play} awayAbbr={completePass.awayAbbr} />
      </svg>
    );

    const endDot = container.querySelector('[data-anim="pass-end-dot"]');
    expect(endDot).toBeInTheDocument();
    expect(endDot).toHaveAttribute('visibility', 'hidden');

    const opacityAnim = endDot?.querySelector('animate[attributeName="opacity"]');
    expect(opacityAnim).toBeInTheDocument();
    const begin = opacityAnim?.getAttribute('begin') ?? '0s';
    const beginSeconds = Number.parseFloat(begin.replace('s', ''));
    expect(beginSeconds).toBeGreaterThan(ANIM_TIMING.pass);
  });

  it('renders penalty-only no-play without drawing a fake pass trace', () => {
    const base = scenarioById('pass-complete-right').play;
    const penaltyOnlyPlay: PlayAnimationData = {
      ...base,
      offenseTeam: 'NE',
      type: 'pass',
      isComplete: false,
      isNoPlay: true,
      yardsGained: 0,
      penaltyTeam: 'NE',
      penaltyType: 'False Start',
      penaltyYards: 5,
      description: 'PENALTY on NE-W.Campbell, False Start, 5 yards, enforced at NE 17 - No Play.',
      actor: null,
      qbActor: null,
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={penaltyOnlyPlay} awayAbbr="SEA" homeAbbr="NE" />
      </svg>
    );

    expect(container.querySelector('[data-anim="pass-main-path"]')).toBeNull();
    expect(container.textContent).toContain('FLAG');
    expect(container.textContent).toContain('5 Yard Penalty');
  });

  it('keeps the moving pass marker aligned with the leading edge of the arc', () => {
    const completePass = scenarioById('pass-complete-right');
    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={completePass.play} awayAbbr={completePass.awayAbbr} />
      </svg>
    );

    const passPath = container.querySelector('[data-anim="pass-main-path"]');
    const passMarker = container.querySelector('[data-anim="pass-main-marker"]');
    const pathAnim = passPath?.querySelector('animate[attributeName="stroke-dashoffset"]');
    const markerMotion = passMarker?.querySelector('animateMotion');

    expect(passPath).toBeInTheDocument();
    expect(passMarker).toBeInTheDocument();
    expect(pathAnim).toBeInTheDocument();
    expect(markerMotion).toBeInTheDocument();

    const markerBegin = markerMotion?.getAttribute('begin') ?? '0s';
    const markerBeginSeconds = Number.parseFloat(markerBegin.replace('s', ''));
    expect(markerBeginSeconds).toBeLessThanOrEqual(0.01);
  });

  it('uses normalized path-length draw for pass and kick arcs', () => {
    const completePass = scenarioById('pass-complete-right');
    const kickoffReturn = scenarioById('kickoff-return');

    const passRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={completePass.play} awayAbbr={completePass.awayAbbr} />
      </svg>
    );
    const kickRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={kickoffReturn.play} awayAbbr={kickoffReturn.awayAbbr} />
      </svg>
    );

    const passPath = passRender.container.querySelector('[data-anim="pass-main-path"]');
    const kickPath = kickRender.container.querySelector('[data-anim="kick-main-path"]');
    expect(passPath).toBeInTheDocument();
    expect(kickPath).toBeInTheDocument();
    expect(passPath).toHaveAttribute('pathLength', '1');
    expect(kickPath).toHaveAttribute('pathLength', '1');
    expect(passPath?.querySelector('animate')).toBeInTheDocument();
    expect(kickPath?.querySelector('animate')).toBeInTheDocument();
  });

  it('mirrors left/right direction when offense moves toward the left endzone', () => {
    const play: PlayAnimationData = {
      type: 'pass',
      direction: 'left',
      offenseTeam: 'NE',
      startDistance: 10,
      fromYardline: 35,
      fromSide: 'SEA',
      toYardline: 5,
      toSide: 'SEA',
      yardsGained: 30,
      isComplete: true,
      isFirstDown: true,
      isTurnover: false,
      description: 'D.Maye pass deep left to M.Hollins for 30 yards',
      actor: { name: 'M.Hollins', summary: '30 Yard Catch', lines: ['3 Catches - 67 Yards'] },
      qbActor: { name: 'D.Maye', summary: '30 Yard Pass', lines: ['25/45 Passing - 242 Yards'] },
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={play} awayAbbr="SEA" />
      </svg>
    );

    const passPath = container.querySelector('[data-anim="pass-main-path"]');
    expect(passPath).toBeInTheDocument();
    const d = passPath?.getAttribute('d') ?? '';
    const match = d.match(/([0-9.]+),([0-9.]+)\s*$/);
    expect(match).not.toBeNull();
    if (match) {
      const endY = Number.parseFloat(match[2]);
      // Home offense moving left should mirror "left" to lower half of field.
      expect(endY).toBeGreaterThan(210);
    }
  });

  it('shows pre-try LOS + ball markers for touchdown plays with a post-score try', () => {
    const tdWithXp: PlayAnimationData = {
      type: 'pass',
      direction: 'left',
      offenseTeam: 'NE',
      startDistance: 10,
      fromYardline: 35,
      fromSide: 'SEA',
      toYardline: 0,
      toSide: 'SEA',
      yardsGained: 35,
      isComplete: true,
      isFirstDown: true,
      isTurnover: false,
      isTouchdown: true,
      description: 'D.Maye pass deep left for touchdown. Extra point is good.',
      postScoreTryKind: 'extra_point',
      postScoreTryPlayType: 'kick',
      postScoreTryDirection: 'middle',
      postScoreTryIsGood: true,
      postScoreTryFromYardline: 15,
      postScoreTryFromSide: 'SEA',
      postScoreTryToYardline: 0,
      postScoreTryToSide: 'SEA',
    };

    const { container, queryByText } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={tdWithXp} awayAbbr="SEA" />
      </svg>
    );

    expect(container.querySelector('[data-anim="pretry-los"]')).toBeInTheDocument();
    expect(container.querySelector('[data-anim="pretry-ball"]')).toBeInTheDocument();
    expect(queryByText('XP ATTEMPT')).not.toBeInTheDocument();
  });

  it('does not render kickoff/punt/field-goal attempt labels on the field', () => {
    const kickoff = scenarioById('kickoff-return');
    const punt = scenarioById('punt-out-of-bounds');
    const fg = scenarioById('field-goal-good');

    const kickoffRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={kickoff.play} awayAbbr={kickoff.awayAbbr} />
      </svg>
    );
    expect(kickoffRender.queryByText('KICKOFF')).not.toBeInTheDocument();
    expect(
      kickoffRender.container.querySelector('[data-anim="kick-main-path"]')
    ).toBeInTheDocument();

    const puntRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={punt.play} awayAbbr={punt.awayAbbr} />
      </svg>
    );
    expect(puntRender.queryByText('PUNT')).not.toBeInTheDocument();
    expect(puntRender.container.querySelector('[data-anim="kick-main-path"]')).toBeInTheDocument();

    const fgRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={fg.play} awayAbbr={fg.awayAbbr} />
      </svg>
    );
    expect(fgRender.queryByText('FG ATTEMPT')).not.toBeInTheDocument();
  });

  it('uses team palette colors for field headshot rings', () => {
    const play: PlayAnimationData = {
      type: 'kick',
      direction: 'middle',
      offenseTeam: 'SEA',
      startDistance: 0,
      fromYardline: 40,
      fromSide: 'SEA',
      toYardline: 30,
      toSide: 'NE',
      kickLandingYardline: 24,
      kickLandingSide: 'NE',
      yardsGained: 6,
      isComplete: true,
      isFirstDown: false,
      isTurnover: false,
      description: 'M.Dickson punts 46 yards to NE 24. R.Shaheed return 6 yards to NE 30.',
      qbActor: {
        name: 'M.Dickson',
        summary: 'Punt',
        lines: ['5 Punts - 236 Yards'],
        headshotUrl: 'https://example.com/dickson.png',
      },
      actor: {
        name: 'R.Shaheed',
        summary: '6 Yard Return',
        lines: ['1 Return - 6 Yards'],
        headshotUrl: 'https://example.com/shaheed.png',
      },
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation
          play={play}
          awayAbbr="SEA"
          homeAbbr="NE"
          teamColorsByAbbr={{
            SEA: { color: '69be28', altColor: '002244' },
            NE: { color: 'c60c30', altColor: '002244' },
          }}
        />
      </svg>
    );

    const kickerRing = container.querySelector('[data-anim="kick-start-headshot"] circle[stroke]');
    const returnRing = container.querySelector('[data-anim="kick-return-runner"] circle[stroke]');
    expect(kickerRing).toBeInTheDocument();
    expect(returnRing).toBeInTheDocument();
    expect(kickerRing).toHaveAttribute('stroke', '#69be28');
    expect(returnRing).toHaveAttribute('stroke', '#c60c30');
  });

  it('renders negative rushing yard labels in red on the field', () => {
    const play: PlayAnimationData = {
      type: 'rush',
      direction: 'left',
      offenseTeam: 'SEA',
      startDistance: 6,
      fromYardline: 33,
      fromSide: 'SEA',
      toYardline: 28,
      toSide: 'SEA',
      yardsGained: -5,
      isComplete: true,
      isFirstDown: false,
      isTurnover: false,
      description: 'K.Walker rush left end for -5 yards.',
      actor: {
        name: 'K.Walker',
        summary: '-5 Yard Rush',
        lines: ['5 Rushes - 15 Yards'],
      },
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={play} awayAbbr="SEA" />
      </svg>
    );

    const fieldYardsLabel = Array.from(container.querySelectorAll('text')).find(
      (node) =>
        node.textContent === '-5' &&
        node.getAttribute('text-anchor') === 'middle' &&
        node.getAttribute('font-size') === '12'
    );
    expect(fieldYardsLabel).toBeInTheDocument();
    expect(fieldYardsLabel).toHaveAttribute('fill', C.red);
  });

  it('keeps the first-down marker pulse running until play changes', () => {
    const play: PlayAnimationData = {
      type: 'rush',
      direction: 'middle',
      offenseTeam: 'SEA',
      startDistance: 2,
      fromYardline: 49,
      fromSide: 'SEA',
      toYardline: 53,
      toSide: 'NE',
      yardsGained: 4,
      isComplete: true,
      isFirstDown: true,
      isTurnover: false,
      description: 'K.Walker rush up middle for 4 yards and a first down.',
      actor: {
        name: 'K.Walker',
        summary: '4 Yard Rush',
        lines: ['6 Rushes - 19 Yards'],
      },
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={play} awayAbbr="SEA" />
      </svg>
    );

    const firstDownLine = container.querySelector(`line[stroke="${C.green}"][stroke-width="3"]`);
    expect(firstDownLine).toBeInTheDocument();
    expect(firstDownLine?.getAttribute('style') ?? '').toContain('firstDownPulse');
    expect(firstDownLine?.getAttribute('style') ?? '').toContain('infinite');
  });

  it('renders a larger first-down badge label for readability', () => {
    const play: PlayAnimationData = {
      type: 'pass',
      direction: 'middle',
      offenseTeam: 'SEA',
      startDistance: 4,
      fromYardline: 40,
      fromSide: 'SEA',
      toYardline: 46,
      toSide: 'NE',
      yardsGained: 6,
      isComplete: true,
      isFirstDown: true,
      isTurnover: false,
      description: 'S.Darnold pass short middle to N.Fant for 6 yards, first down.',
      actor: { name: 'N.Fant', summary: '6 Yard Catch', lines: ['2 Catches - 12 Yards'] },
      qbActor: { name: 'S.Darnold', summary: '6 Yard Pass', lines: ['7/10 Passing - 61 Yards'] },
    };

    const { getByText } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={play} awayAbbr="SEA" />
      </svg>
    );

    const badgeText = getByText('1ST DOWN');
    expect(badgeText).toHaveAttribute('font-size', '16');
  });

  it('shows a static returner headshot on zero-yard returns', () => {
    const play: PlayAnimationData = {
      type: 'kick',
      direction: 'middle',
      offenseTeam: 'SEA',
      startDistance: 0,
      fromYardline: 35,
      fromSide: 'SEA',
      toYardline: 20,
      toSide: 'NE',
      kickLandingYardline: 20,
      kickLandingSide: 'NE',
      yardsGained: 0,
      isComplete: true,
      isFirstDown: false,
      isTurnover: false,
      description: 'M.Dickson punts 45 yards to NE 20. M.Jones return 0 yards to NE 20.',
      qbActor: {
        name: 'M.Dickson',
        summary: '45 Yard Punt',
        lines: ['2 Punts - 46.5 Yards Avg'],
        headshotUrl: 'https://example.com/dickson.png',
      },
      actor: {
        name: 'M.Jones',
        summary: '0 Yard Return',
        lines: ['1 Return - 0 Yards'],
        headshotUrl: 'https://example.com/mjones.png',
      },
    };

    const { container } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={play} awayAbbr="SEA" />
      </svg>
    );

    expect(
      container.querySelector('[data-anim="kick-return-static-headshot"]')
    ).toBeInTheDocument();
    expect(container.querySelector('[data-anim="kick-landing-dot"]')).not.toBeInTheDocument();
  });
});
