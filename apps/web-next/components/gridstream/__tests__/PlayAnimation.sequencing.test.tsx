import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import type { PlayAnimationData } from '@atlas/sdk/gridstream/types';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';
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

    const returnPathAnimate = returnPath?.querySelector('animate[attributeName="stroke-dashoffset"]');
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
    const landingBeginSeconds = Number.parseFloat((landingSet?.getAttribute('begin') ?? '0s').replace('s', ''));
    const endBeginSeconds = Number.parseFloat((endSet?.getAttribute('begin') ?? '0s').replace('s', ''));
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

    const { container, getAllByText } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={tdWithXp} awayAbbr="SEA" />
      </svg>
    );

    expect(container.querySelector('[data-anim="pretry-los"]')).toBeInTheDocument();
    expect(container.querySelector('[data-anim="pretry-ball"]')).toBeInTheDocument();
    expect(getAllByText('XP ATTEMPT').length).toBeGreaterThan(0);
  });

  it('renders distinct kick-attempt labels for kickoff, punt, and field goal', () => {
    const kickoff = scenarioById('kickoff-return');
    const punt = scenarioById('punt-out-of-bounds');
    const fg = scenarioById('field-goal-good');

    const kickoffRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={kickoff.play} awayAbbr={kickoff.awayAbbr} />
      </svg>
    );
    expect(kickoffRender.getByText('KICKOFF')).toBeInTheDocument();

    const puntRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={punt.play} awayAbbr={punt.awayAbbr} />
      </svg>
    );
    const puntLabel = puntRender.getByText('PUNT');
    expect(puntLabel).toBeInTheDocument();
    expect(puntLabel).toHaveAttribute('font-size', '30');

    const fgRender = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={fg.play} awayAbbr={fg.awayAbbr} />
      </svg>
    );
    const fgLabel = fgRender.getByText('FG ATTEMPT');
    expect(fgLabel).toBeInTheDocument();
    expect(fgLabel).toHaveAttribute('font-size', '30');
  });

  it('does not render duplicate stale passing lines when QB rush adds a new rushing line', () => {
    const rushByQb: PlayAnimationData = {
      type: 'rush',
      direction: 'right',
      offenseTeam: 'SEA',
      startDistance: 10,
      fromYardline: 43,
      fromSide: 'SEA',
      toYardline: 46,
      toSide: 'NE',
      yardsGained: 11,
      isComplete: true,
      isFirstDown: true,
      isTurnover: false,
      description: 'S.Darnold scrambles right tackle for 11 yards.',
      actor: {
        name: 'S.Darnold',
        summary: '11 Yard Rush',
        lines: ['1 Rush - 11 Yards', '11/24 Passing - 120 Yards'],
        previousLines: ['11/24 Passing - 120 Yards'],
      },
    };

    const { getAllByText } = render(
      <svg viewBox="0 0 1000 420">
        <PlayAnimation play={rushByQb} awayAbbr="SEA" />
      </svg>
    );

    expect(getAllByText('11/24 Passing - 120 Yards')).toHaveLength(1);
  });
});
