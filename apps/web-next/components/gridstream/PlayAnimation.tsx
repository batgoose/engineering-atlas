'use client';

/**
 * Field animation renderer for replay/live plays.
 *
 * Timing notes:
 * - Paths are animated with `pathLength` so lines draw as the ball marker moves.
 * - Secondary sequences (penalty adjustments, PAT/2PT after TD) are delayed from
 *   the primary action using shared timing constants in `ANIM_TIMING`.
 * - Actor cards are intentionally driven off `PlayAnimationData` so all rendering
 *   stays deterministic in snapshot tests.
 *
 * Documentation hooks:
 * - Sequence behavior reference: docs/gridstream-live-runtime.md
 */

import type { PlayAnimationData } from '@atlas/sdk/gridstream/types';
import { yardToFieldPct } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import {
  fieldPctToSvgX,
  FIELD_CENTER_Y,
  FIELD_TOP,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  getFgEndpoints,
} from '@atlas/sdk/gridstream/field';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';

interface PlayAnimationProps {
  play: PlayAnimationData;
  awayAbbr: string;
}

function clampX(value: number): number {
  return Math.max(50, Math.min(950, value));
}

const YARDS_TO_PX = 7.36;

interface PostScoreTryOverlayData {
  kind: 'two_point' | 'extra_point';
  playType: 'pass' | 'rush' | 'kick';
  direction: 'left' | 'middle' | 'right';
  isGood: boolean;
  fromX: number;
  toX: number;
  qbActor?: PlayAnimationData['postScoreTryQbActor'];
  actor?: PlayAnimationData['postScoreTryActor'];
}

export function PlayAnimation({ play, awayAbbr }: PlayAnimationProps) {
  const possIsAway = (play.offenseTeam ?? play.fromSide) === awayAbbr;
  const fromPct = yardToFieldPct(play.fromYardline, play.fromSide, awayAbbr);
  const toPct = yardToFieldPct(play.toYardline, play.toSide, awayAbbr);
  const fromX = fieldPctToSvgX(fromPct);
  const toX = fieldPctToSvgX(toPct);
  const turnoverPct =
    play.turnoverSpotSide && typeof play.turnoverSpotYardline === 'number'
      ? yardToFieldPct(play.turnoverSpotYardline, play.turnoverSpotSide, awayAbbr)
      : toPct;
  const turnoverX = fieldPctToSvgX(turnoverPct);
  const penaltyAdjustedPct =
    play.penaltyAdjustedSide && typeof play.penaltyAdjustedYardline === 'number'
      ? yardToFieldPct(play.penaltyAdjustedYardline, play.penaltyAdjustedSide, awayAbbr)
      : null;
  const penaltyAdjustedX = penaltyAdjustedPct == null ? null : fieldPctToSvgX(penaltyAdjustedPct);
  const postScoreTry: PostScoreTryOverlayData | null =
    play.postScoreTryKind &&
    play.postScoreTryPlayType &&
    play.postScoreTryFromSide &&
    typeof play.postScoreTryFromYardline === 'number' &&
    play.postScoreTryToSide &&
    typeof play.postScoreTryToYardline === 'number'
      ? {
          kind: play.postScoreTryKind,
          playType: play.postScoreTryPlayType,
          direction: play.postScoreTryDirection ?? 'middle',
          isGood: Boolean(play.postScoreTryIsGood),
          fromX: fieldPctToSvgX(
            yardToFieldPct(play.postScoreTryFromYardline, play.postScoreTryFromSide, awayAbbr)
          ),
          toX: fieldPctToSvgX(
            yardToFieldPct(play.postScoreTryToYardline, play.postScoreTryToSide, awayAbbr)
          ),
          qbActor: play.postScoreTryQbActor,
          actor: play.postScoreTryActor,
        }
      : null;

  // Direction offset for pass/rush visualization
  const lateralSign = play.direction === 'left' ? -1 : play.direction === 'right' ? 1 : 0;
  const dirY = FIELD_CENTER_Y + lateralSign * (possIsAway ? 60 : -60);

  switch (play.type) {
    case 'pass':
      return (
        <PassAnimation
          fromX={fromX}
          toX={toX}
          penaltyAdjustedX={penaltyAdjustedX}
          dirY={dirY}
          play={play}
          possIsAway={possIsAway}
          postScoreTry={postScoreTry}
        />
      );
    case 'rush':
      return (
        <RushAnimation
          fromX={fromX}
          toX={toX}
          penaltyAdjustedX={penaltyAdjustedX}
          dirY={dirY}
          play={play}
          possIsAway={possIsAway}
          postScoreTry={postScoreTry}
        />
      );
    case 'turnover':
      return (
        <TurnoverAnimation fromX={fromX} turnoverX={turnoverX} toX={toX} dirY={dirY} play={play} />
      );
    case 'kick':
      return <KickAnimation fromX={fromX} toX={toX} play={play} awayAbbr={awayAbbr} />;
    case 'fieldgoal':
      return (
        <FieldGoalAnimation
          fromX={fromX}
          play={play}
          possIsAway={possIsAway}
        />
      );
    default:
      return null;
  }
}

// ── Pass ──────────────────────────────────────────────────────

function PassAnimation({
  fromX,
  toX,
  penaltyAdjustedX,
  dirY,
  play,
  possIsAway,
  postScoreTry,
}: {
  fromX: number;
  toX: number;
  penaltyAdjustedX: number | null;
  dirY: number;
  play: PlayAnimationData;
  possIsAway: boolean;
  postScoreTry: PostScoreTryOverlayData | null;
}) {
  const isComplete = play.isComplete;
  const text = play.description.toLowerCase();
  const isSack = !isComplete && (text.includes('sack') || play.yardsGained < 0);
  const missLabel = isSack ? 'SACK' : 'INC';
  const trailColor = isComplete ? C.cyan : C.red;
  // Main pass timing. Follow-on overlays (penalty / post-score try) key off this.
  const duration = Math.max(ANIM_TIMING.pass * 1.03, 1.24);
  const offenseDir = possIsAway ? 1 : -1;

  const estimatedDepthYards = (() => {
    if (
      typeof play.airYards === 'number' &&
      Number.isFinite(play.airYards) &&
      Math.abs(play.airYards) > 0
    ) {
      return Math.min(45, Math.max(6, Math.abs(play.airYards)));
    }
    const base = Math.max(6, play.startDistance ?? 10);
    if (text.includes('deep')) return Math.min(45, Math.max(15, base * 1.9));
    if (text.includes('short') || text.includes('screen') || text.includes('flat'))
      return Math.min(6, Math.max(3, base * 0.45));
    return Math.min(25, Math.max(8, base * 1.3));
  })();

  const incompleteX = (() => {
    const dir = play.direction === 'middle' ? 1 : play.direction === 'left' ? 0.95 : 1.05;
    const sign = possIsAway ? 1 : -1;
    const raw = fromX + sign * estimatedDepthYards * YARDS_TO_PX * dir;
    return clampX(raw);
  })();

  const touchdownInsetX = isComplete && play.isTouchdown ? clampX(toX + offenseDir * 26) : toX;
  const targetX = isSack ? toX : isComplete ? touchdownInsetX : incompleteX;
  const targetY = isSack ? FIELD_CENTER_Y : dirY;
  const arcPeakY =
    Math.min(FIELD_CENTER_Y, targetY) -
    Math.max(32, Math.min(140, Math.abs(targetX - fromX) * 0.35));
  const pathD = isSack
    ? `M ${fromX},${FIELD_CENTER_Y} L ${targetX},${targetY}`
    : `M ${fromX},${FIELD_CENTER_Y} Q ${(fromX + targetX) / 2},${arcPeakY} ${targetX},${targetY}`;
  const hasPenalty = (play.penaltyYards ?? 0) > 0;
  const penaltyDelay = duration + 0.16;
  const penaltyAdjustDir =
    play.penaltyTeam && play.offenseTeam && play.penaltyTeam === play.offenseTeam
      ? -offenseDir
      : offenseDir;
  const computedPenaltyAdjustedX = clampX(
    targetX + penaltyAdjustDir * (play.penaltyYards ?? 0) * YARDS_TO_PX
  );
  const penaltyEndX = penaltyAdjustedX ?? computedPenaltyAdjustedX;
  const postTryDelay = duration + 4.85;
  const hasPostTrySequence = Boolean(postScoreTry);
  // On TD + XP/2PT plays we intentionally clear primary pass visuals before rendering try.
  const hidePrimaryAt = hasPostTrySequence
    ? Math.max(duration + 0.6, postTryDelay - 0.35)
    : undefined;
  const primaryFadeOutDelay =
    hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;
  const cardSide: 'left' | 'right' = targetX >= fromX ? 'right' : 'left';
  const qbCardSide: 'left' | 'right' = targetX >= fromX ? 'left' : 'right';
  const renderReceiverCard = Boolean(isComplete && play.actor?.name);
  const renderQbCard = Boolean(play.qbActor?.name);
  const cardsCrowded = renderReceiverCard && renderQbCard && Math.abs(targetX - fromX) < 180;

  return (
    <g>
      {hasPostTrySequence && (
        <PreTrySnapGuide x={fromX} hideAt={hidePrimaryAt} />
      )}

      {/* Main path */}
      <path
        d={pathD}
        fill="none"
        stroke={trailColor}
        strokeWidth={isSack ? 2.4 : 2}
        opacity={0.5}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
        data-anim="pass-main-path"
        style={
          primaryFadeOutDelay == null
            ? undefined
            : { animation: `fadeOut 0.22s ease ${primaryFadeOutDelay}s forwards` }
        }
      >
        <animate attributeName="stroke-dashoffset" from="1" to="0" dur={`${duration}s`} fill="freeze" />
      </path>
      <circle
        r="3.6"
        fill={trailColor}
        opacity={0.95}
        style={
          primaryFadeOutDelay == null
            ? undefined
            : { animation: `fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards` }
        }
      >
        <animateMotion dur={`${duration}s`} fill="freeze" path={pathD} />
      </circle>

      {/* End flash */}
      <circle
        cx={targetX}
        cy={targetY}
        r={4}
        fill="none"
        stroke={isComplete ? C.green : C.red}
        strokeWidth={2}
        data-anim="pass-end-flash"
        style={{
          animation: `catchFlash 0.6s ease ${duration + 0.02}s forwards`,
          opacity: 0,
        }}
      />
      {isSack && (
        <circle
          cx={targetX}
          cy={targetY}
          r={4.4}
          fill={C.red}
          opacity={0}
          visibility="hidden"
          data-anim="pass-end-dot"
        >
          <set attributeName="visibility" to="visible" begin={`${duration + 0.04}s`} fill="freeze" />
          <animate
            attributeName="opacity"
            begin={`${duration + 0.04}s`}
            dur="0.22s"
            from="0"
            to="1"
            fill="freeze"
          />
          {primaryFadeOutDelay != null && (
            <animate
              attributeName="opacity"
              begin={`${primaryFadeOutDelay}s`}
              dur="0.2s"
              from="1"
              to="0"
              fill="freeze"
            />
          )}
        </circle>
      )}
      {isComplete && (
        <circle
          cx={targetX}
          cy={targetY}
          r={4.6}
          fill={C.cyan}
          opacity={0}
          visibility="hidden"
          data-anim="pass-end-dot"
        >
          <set attributeName="visibility" to="visible" begin={`${duration + 0.04}s`} fill="freeze" />
          <animate
            attributeName="opacity"
            begin={`${duration + 0.04}s`}
            dur="0.22s"
            from="0"
            to="1"
            fill="freeze"
          />
          {primaryFadeOutDelay != null && (
            <animate
              attributeName="opacity"
              begin={`${primaryFadeOutDelay}s`}
              dur="0.2s"
              from="1"
              to="0"
              fill="freeze"
            />
          )}
        </circle>
      )}

      {/* Incompletion endpoint marker */}
      {!isComplete && !isSack && (
        <g style={{ opacity: 0, animation: `slideUp 0.25s ease ${duration + 0.05}s forwards` }}>
          <line
            x1={targetX - 8}
            y1={targetY - 8}
            x2={targetX + 8}
            y2={targetY + 8}
            stroke={C.red}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line
            x1={targetX + 8}
            y1={targetY - 8}
            x2={targetX - 8}
            y2={targetY + 8}
            stroke={C.red}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Result label */}
      <text
        x={targetX}
        y={targetY - 14}
        textAnchor="middle"
        fill={isComplete ? C.green : C.red}
        fontSize={12}
        fontFamily={F.display}
        fontWeight={700}
        style={{
          opacity: 0,
          animation:
            primaryFadeOutDelay == null
              ? `slideUp 0.3s ease ${duration + 0.2}s forwards`
              : `slideUp 0.3s ease ${duration + 0.2}s forwards, fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards`,
        }}
      >
        {isComplete ? `+${play.yardsGained}` : missLabel}
      </text>

      {hasPenalty && (
        <>
          <PenaltyAdjustmentOverlay
            fromX={targetX}
            toX={penaltyEndX}
            y={targetY}
            delay={penaltyDelay + 0.05}
          />
          <PenaltyCallout
            x={penaltyEndX}
            y={targetY}
            play={play}
            delay={penaltyDelay + 0.02}
            side={penaltyEndX >= fromX ? 'right' : 'left'}
          />
        </>
      )}

      {isComplete && play.actor?.name && (
        <ActorCard
          x={targetX}
          y={targetY + 8}
          title={play.actor.name}
          summary={play.actor.summary}
          lines={play.actor.lines}
          previousLines={play.actor.previousLines}
          headshotUrl={play.actor.headshotUrl}
          accent={C.amber}
          delay={ANIM_TIMING.receiverDelay}
          side={cardSide}
          anchor="above"
          disappearAfter={hidePrimaryAt}
        />
      )}

      {play.qbActor?.name && (
        <ActorCard
          x={fromX}
          y={FIELD_CENTER_Y + (cardsCrowded ? -18 : -6)}
          title={play.qbActor.name}
          summary={play.qbActor.summary}
          lines={play.qbActor.lines}
          previousLines={play.qbActor.previousLines}
          headshotUrl={play.qbActor.headshotUrl}
          accent={isSack ? C.red : C.cyan}
          delay={ANIM_TIMING.receiverDelay * 0.55}
          side={qbCardSide}
          anchor="above"
          disappearAfter={hidePrimaryAt}
        />
      )}

      {/* First down animation */}
      {play.isFirstDown && !hasPostTrySequence && <FirstDownMarker x={toX} />}

      {postScoreTry && (
        <PostScoreAttemptOverlay data={postScoreTry} delay={postTryDelay} fallbackSide={cardSide} />
      )}
    </g>
  );
}

// ── Rush ──────────────────────────────────────────────────────

function RushAnimation({
  fromX,
  toX,
  penaltyAdjustedX,
  dirY,
  play,
  possIsAway,
  postScoreTry,
}: {
  fromX: number;
  toX: number;
  penaltyAdjustedX: number | null;
  dirY: number;
  play: PlayAnimationData;
  possIsAway: boolean;
  postScoreTry: PostScoreTryOverlayData | null;
}) {
  const duration = ANIM_TIMING.rush * 1.08;
  const touchdownTargetX = play.isTouchdown
    ? Math.max(50, Math.min(950, toX + (possIsAway ? 26 : -26)))
    : toX;
  const offenseDir = possIsAway ? 1 : -1;
  const hasPenalty = (play.penaltyYards ?? 0) > 0;
  const penaltyAdjustDir =
    play.penaltyTeam && play.offenseTeam && play.penaltyTeam === play.offenseTeam
      ? -offenseDir
      : offenseDir;
  const computedPenaltyAdjustedX = clampX(
    touchdownTargetX + penaltyAdjustDir * (play.penaltyYards ?? 0) * YARDS_TO_PX
  );
  const penaltyEndX = penaltyAdjustedX ?? computedPenaltyAdjustedX;
  const penaltyDelay = duration + 0.12;
  const postTryDelay = duration + 4.85;
  const hasPostTrySequence = Boolean(postScoreTry);
  const hidePrimaryAt = hasPostTrySequence
    ? Math.max(duration + 0.6, postTryDelay - 0.35)
    : undefined;
  const primaryFadeOutDelay =
    hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;

  const bend = play.direction === 'left' ? -34 : play.direction === 'right' ? 34 : 12;
  const c1X = fromX + (touchdownTargetX - fromX) * 0.35;
  const c2X = fromX + (touchdownTargetX - fromX) * 0.72;
  const c1Y = FIELD_CENTER_Y + bend;
  const c2Y = dirY + bend * 0.35;
  const pathD = `M ${fromX},${FIELD_CENTER_Y} C ${c1X},${c1Y} ${c2X},${c2Y} ${touchdownTargetX},${dirY}`;
  const cardSide: 'left' | 'right' = touchdownTargetX >= fromX ? 'right' : 'left';

  return (
    <g>
      {hasPostTrySequence && (
        <PreTrySnapGuide x={fromX} hideAt={hidePrimaryAt} />
      )}

      {/* Rush trail */}
      <path
        d={pathD}
        fill="none"
        stroke={C.cyan}
        strokeWidth={2.2}
        opacity={0.58}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
        data-anim="rush-main-path"
        style={
          primaryFadeOutDelay == null
            ? undefined
            : { animation: `fadeOut 0.22s ease ${primaryFadeOutDelay}s forwards` }
        }
      >
        <animate attributeName="stroke-dashoffset" from="1" to="0" dur={`${duration}s`} fill="freeze" />
      </path>

      {/* Moving runner marker */}
      <circle
        r="4.2"
        fill={C.cyan}
        opacity={0.95}
        style={{
          filter: `drop-shadow(0 0 6px ${C.cyanGlow})`,
          ...(primaryFadeOutDelay == null
            ? {}
            : { animation: `fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards` }),
        }}
      >
        <animateMotion dur={`${duration}s`} fill="freeze" path={pathD} />
      </circle>

      {/* End marker glow */}
      <circle
        cx={touchdownTargetX}
        cy={dirY}
        r={5}
        fill={C.cyan}
        opacity={0}
        style={{
          animation:
            primaryFadeOutDelay == null
              ? `fadeIn 0.3s ease ${duration}s forwards`
              : `fadeIn 0.3s ease ${duration}s forwards, fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards`,
        }}
      />

      {/* Yards label */}
      <text
        x={touchdownTargetX}
        y={dirY - 12}
        textAnchor="middle"
        fill={C.cyan}
        fontSize={12}
        fontFamily={F.display}
        fontWeight={700}
        style={{
          opacity: 0,
          animation:
            primaryFadeOutDelay == null
              ? `slideUp 0.3s ease ${duration + 0.1}s forwards`
              : `slideUp 0.3s ease ${duration + 0.1}s forwards, fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards`,
        }}
      >
        {play.yardsGained >= 0 ? '+' : ''}
        {play.yardsGained}
      </text>

      {hasPenalty && (
        <>
          <PenaltyAdjustmentOverlay
            fromX={touchdownTargetX}
            toX={penaltyEndX}
            y={dirY}
            delay={penaltyDelay + 0.05}
          />
          <PenaltyCallout
            x={penaltyEndX}
            y={dirY}
            play={play}
            delay={penaltyDelay + 0.03}
            side={penaltyEndX >= fromX ? 'right' : 'left'}
          />
        </>
      )}

      {play.actor?.name && (
        <ActorCard
          x={touchdownTargetX}
          y={dirY + 8}
          title={play.actor.name}
          summary={play.actor.summary}
          lines={play.actor.lines}
          previousLines={play.actor.previousLines}
          headshotUrl={play.actor.headshotUrl}
          accent={C.cyan}
          delay={ANIM_TIMING.receiverDelay}
          side={cardSide}
          anchor="above"
          disappearAfter={hidePrimaryAt}
        />
      )}

      {play.isFirstDown && !hasPostTrySequence && <FirstDownMarker x={touchdownTargetX} />}

      {postScoreTry && (
        <PostScoreAttemptOverlay data={postScoreTry} delay={postTryDelay} fallbackSide={cardSide} />
      )}
    </g>
  );
}

function PenaltyAdjustmentOverlay({
  fromX,
  toX,
  y,
  delay = 0,
}: {
  fromX: number;
  toX: number;
  y: number;
  delay?: number;
}) {
  const connectorPath = `M ${fromX},${y} L ${toX},${y}`;

  return (
    <g>
      <line
        x1={fromX}
        y1={FIELD_TOP}
        x2={fromX}
        y2={FIELD_BOTTOM}
        stroke="#3b82f6"
        strokeWidth={1.6}
        opacity={0}
        strokeDasharray="6 5"
        style={{ animation: `fadeIn 0.16s ease ${Math.max(delay - 0.04, 0)}s forwards` }}
      >
        <animate
          attributeName="x1"
          begin={`${delay + 0.04}s`}
          dur="0.34s"
          from={fromX}
          to={toX}
          fill="freeze"
        />
        <animate
          attributeName="x2"
          begin={`${delay + 0.04}s`}
          dur="0.34s"
          from={fromX}
          to={toX}
          fill="freeze"
        />
      </line>
      <line
        x1={toX}
        y1={FIELD_TOP}
        x2={toX}
        y2={FIELD_BOTTOM}
        stroke={C.amber}
        strokeWidth={2.2}
        strokeDasharray="8 5"
        opacity={0}
        style={{ animation: `fadeIn 0.2s ease ${delay}s forwards` }}
      />
      <path
        d={connectorPath}
        fill="none"
        stroke={C.amber}
        strokeWidth={2}
        opacity={0.65}
        strokeDasharray="6 4"
        strokeDashoffset="1000"
        style={{ animation: `trailDraw 0.34s ease ${delay + 0.04}s forwards` }}
      />
      <circle
        cx={toX}
        cy={y}
        r={5}
        fill={C.amber}
        opacity={0}
        style={{ animation: `fadeIn 0.2s ease ${delay + 0.08}s forwards` }}
      />
    </g>
  );
}

function PostScoreAttemptOverlay({
  data,
  delay,
  fallbackSide,
}: {
  data: PostScoreTryOverlayData;
  delay: number;
  fallbackSide: 'left' | 'right';
}) {
  const travelRight = data.toX >= data.fromX;
  const { backWallX } = getFgEndpoints(travelRight);
  const endX = data.playType === 'kick' ? backWallX : data.toX;
  const qbSide: 'left' | 'right' = travelRight ? 'left' : 'right';
  const actorSide: 'left' | 'right' = travelRight ? 'right' : 'left';
  const directionY =
    data.direction === 'left'
      ? FIELD_CENTER_Y - 52
      : data.direction === 'right'
        ? FIELD_CENTER_Y + 52
        : FIELD_CENTER_Y;
  const attemptDuration = data.playType === 'kick' ? 0.72 : 0.78;
  const resultColor = data.isGood ? C.green : C.red;
  const traceColor = data.playType === 'kick' ? C.amber : C.cyan;
  const isPassLike = data.playType === 'pass';
  const isRushLike = data.playType === 'rush';
  const endY = isPassLike ? directionY : FIELD_CENTER_Y;
  const peakY = FIELD_CENTER_Y - (data.playType === 'kick' ? 110 : 72);
  const pathD = isRushLike
    ? `M ${data.fromX},${FIELD_CENTER_Y} C ${data.fromX + (endX - data.fromX) * 0.32},${directionY} ${data.fromX + (endX - data.fromX) * 0.7},${directionY * 0.7 + FIELD_CENTER_Y * 0.3} ${endX},${endY}`
    : `M ${data.fromX},${FIELD_CENTER_Y} Q ${(data.fromX + endX) / 2},${peakY} ${endX},${endY}`;
  const losLabel = data.kind === 'two_point'
    ? '2PT TRY'
    : data.playType === 'kick'
      ? 'XP ATTEMPT'
      : 'XP TRY';
  const resultLabel =
    data.kind === 'two_point'
      ? data.isGood
        ? '2PT GOOD'
        : '2PT NO GOOD'
      : data.isGood
        ? 'XP GOOD'
        : 'XP NO GOOD';

  return (
    <g
      style={{
        opacity: 0,
        animation: `fadeIn 0.02s linear ${Math.max(delay - 0.02, 0)}s forwards`,
      }}
    >
      {data.playType === 'kick' && (
        <KickAttemptLabel x={data.fromX} label="XP ATTEMPT" delay={delay} />
      )}

      <line
        x1={data.fromX}
        y1={FIELD_TOP}
        x2={data.fromX}
        y2={FIELD_BOTTOM}
        stroke="#3b82f6"
        strokeWidth={1.8}
        opacity={0}
        style={{ animation: `fadeIn 0.2s ease ${delay}s forwards` }}
      />
      <rect
        x={data.fromX - 32}
        y={FIELD_TOP + 2}
        width={64}
        height={14}
        rx={2}
        fill="rgba(7,11,20,.9)"
        stroke="#3b82f6"
        strokeOpacity={0.65}
        strokeWidth={0.8}
        style={{ opacity: 0, animation: `fadeIn 0.2s ease ${delay + 0.04}s forwards` }}
      />
      <text
        x={data.fromX}
        y={FIELD_TOP + 12}
        textAnchor="middle"
        fill="#7db6ff"
        fontSize={8.5}
        fontFamily={F.display}
        fontWeight={700}
        letterSpacing=".08em"
        style={{ opacity: 0, animation: `fadeIn 0.2s ease ${delay + 0.06}s forwards` }}
      >
        {losLabel}
      </text>

      <path
        d={pathD}
        fill="none"
        stroke={traceColor}
        strokeWidth={2}
        opacity={0.58}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
      >
        <animate
          attributeName="stroke-dashoffset"
          begin={`${delay + 0.08}s`}
          dur={`${attemptDuration}s`}
          from="1"
          to="0"
          fill="freeze"
        />
      </path>
      <circle r="3.8" fill={traceColor} opacity={0.95}>
        <animateMotion
          begin={`${delay + 0.08}s`}
          dur={`${attemptDuration}s`}
          fill="freeze"
          path={pathD}
        />
      </circle>

      {!data.isGood && (
        <g
          style={{
            opacity: 0,
            animation: `fadeIn 0.2s ease ${delay + attemptDuration + 0.1}s forwards`,
          }}
        >
          <line
            x1={endX - 8}
            y1={endY - 8}
            x2={endX + 8}
            y2={endY + 8}
            stroke={C.red}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line
            x1={endX + 8}
            y1={endY - 8}
            x2={endX - 8}
            y2={endY + 8}
            stroke={C.red}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      )}

      <circle
        cx={endX}
        cy={endY}
        r={4.8}
        fill={resultColor}
        opacity={0}
        style={{ animation: `fadeIn 0.2s ease ${delay + attemptDuration + 0.02}s forwards` }}
      />
      <text
        x={endX}
        y={endY - 14}
        textAnchor="middle"
        fill={resultColor}
        fontSize={10}
        fontFamily={F.display}
        fontWeight={700}
        letterSpacing=".12em"
        style={{
          opacity: 0,
          animation: `slideUp 0.24s ease ${delay + attemptDuration + 0.12}s forwards`,
        }}
      >
        {resultLabel}
      </text>

      {data.qbActor?.name && (
        <ActorCard
          x={data.fromX}
          y={FIELD_CENTER_Y - 6}
          title={data.qbActor.name}
          summary={data.qbActor.summary}
          lines={data.qbActor.lines}
          previousLines={data.qbActor.previousLines}
          headshotUrl={data.qbActor.headshotUrl}
          accent={C.cyan}
          delay={delay + 0.12}
          side={qbSide}
          anchor="above"
        />
      )}

      {data.actor?.name && data.playType !== 'kick' && (
        <ActorCard
          x={endX}
          y={endY}
          title={data.actor.name}
          summary={data.actor.summary}
          lines={data.actor.lines}
          previousLines={data.actor.previousLines}
          headshotUrl={data.actor.headshotUrl}
          accent={data.isGood ? C.amber : C.red}
          delay={delay + attemptDuration + 0.1}
          side={actorSide ?? fallbackSide}
          anchor="above"
        />
      )}
      {data.actor?.name && data.playType === 'kick' && (
        <ActorCard
          x={data.fromX}
          y={FIELD_CENTER_Y + 4}
          title={data.actor.name}
          summary={data.actor.summary}
          lines={data.actor.lines}
          previousLines={data.actor.previousLines}
          headshotUrl={data.actor.headshotUrl}
          accent={data.isGood ? C.amber : C.red}
          delay={delay + attemptDuration + 0.18}
          side={travelRight ? 'left' : 'right'}
          anchor="above"
        />
      )}
    </g>
  );
}

// ── Turnover ──────────────────────────────────────────────────

/**
 * Turnover sequence:
 * 1) offense ball flight/path to takeaway spot
 * 2) turnover callout
 * 3) return trail to end spot
 */
function TurnoverAnimation({
  fromX,
  turnoverX,
  toX,
  dirY,
  play,
}: {
  fromX: number;
  turnoverX: number;
  toX: number;
  dirY: number;
  play: PlayAnimationData;
}) {
  const text = play.description.toLowerCase();
  const isInterception = text.includes('intercept');
  const hasReturn = Math.abs(toX - turnoverX) > 2;
  const totalDuration = Math.max(ANIM_TIMING.turnover * 2, 1.65);
  const firstDuration = totalDuration * 0.52;
  const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
  const turnoverLabelDelay = firstDuration + 0.08;
  const returnStartDelay = firstDuration + 0.22;
  const actorDelay = hasReturn
    ? returnStartDelay + returnDuration + 0.08
    : turnoverLabelDelay + 0.14;
  const turnoverY = isInterception ? dirY : FIELD_CENTER_Y;
  const firstPath = isInterception
    ? `M ${fromX},${FIELD_CENTER_Y} Q ${(fromX + turnoverX) / 2},${Math.min(FIELD_CENTER_Y, turnoverY) - Math.max(36, Math.min(128, Math.abs(turnoverX - fromX) * 0.32))} ${turnoverX},${turnoverY}`
    : `M ${fromX},${FIELD_CENTER_Y} Q ${(fromX + turnoverX) / 2},${FIELD_CENTER_Y - 20} ${turnoverX},${FIELD_CENTER_Y}`;
  const returnPath = `M ${turnoverX},${turnoverY} Q ${(turnoverX + toX) / 2},${FIELD_CENTER_Y + (toX > turnoverX ? 36 : -36)} ${toX},${FIELD_CENTER_Y}`;
  const firstColor = isInterception ? C.cyan : C.amber;
  const actorSide: 'left' | 'right' = toX >= turnoverX ? 'right' : 'left';

  return (
    <g>
      {/* Red flash overlay */}
      <rect
        x={50}
        y={FIELD_TOP}
        width={900}
        height={FIELD_BOTTOM - FIELD_TOP}
        fill={C.red}
        style={{ animation: `turnoverFlash 1s ease forwards` }}
      />

      {/* Ball to takeaway spot */}
      <path
        d={firstPath}
        fill="none"
        stroke={firstColor}
        strokeWidth={2.1}
        opacity={0.58}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
        data-anim="turnover-main-path"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${firstDuration}s`}
          fill="freeze"
        />
      </path>
      <circle r="3.8" fill={firstColor} opacity={0.95}>
        <animateMotion dur={`${firstDuration}s`} fill="freeze" path={firstPath} />
      </circle>

      {/* Takeaway marker */}
      <circle
        cx={turnoverX}
        cy={turnoverY}
        r={4.6}
        fill={C.red}
        opacity={0}
        style={{ animation: `fadeIn 0.22s ease ${firstDuration}s forwards` }}
      />

      {/* Return trail */}
      {hasReturn && (
        <>
          <path
            d={returnPath}
            fill="none"
            stroke={C.red}
            strokeWidth={2.3}
            opacity={0}
            strokeDasharray="5 4"
            strokeDashoffset="1000"
            style={{
              animation: [
                `fadeIn 0.08s linear ${returnStartDelay}s forwards`,
                `trailDraw ${returnDuration}s ease ${returnStartDelay}s forwards`,
              ].join(', '),
            }}
          />
          <circle
            r="4"
            fill={C.red}
            opacity={0}
            style={{
              filter: `drop-shadow(0 0 6px rgba(255,59,79,0.6))`,
              animation: `fadeIn 0.08s linear ${returnStartDelay}s forwards`,
            }}
          >
            <animateMotion
              begin={`${returnStartDelay}s`}
              dur={`${returnDuration}s`}
              fill="freeze"
              path={returnPath}
            />
          </circle>
          <circle
            cx={toX}
            cy={FIELD_CENTER_Y}
            r={4.6}
            fill={C.red}
            opacity={0}
            style={{ animation: `fadeIn 0.22s ease ${returnStartDelay + returnDuration}s forwards` }}
          />
        </>
      )}

      {/* Turnover label */}
      <g
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${turnoverLabelDelay}s forwards`,
        }}
      >
        {play.turnoverBy && (
          <text
            x={turnoverX}
            y={turnoverY - 22}
            textAnchor="middle"
            fill={C.red}
            fontSize={11}
            fontFamily={F.display}
            fontWeight={800}
          >
            {play.turnoverBy}
          </text>
        )}
        <text
          x={turnoverX}
          y={turnoverY - 10}
          textAnchor="middle"
          fill={C.red}
          fontSize={10}
          fontFamily={F.display}
          fontWeight={700}
          letterSpacing={2}
        >
          TURNOVER
        </text>
      </g>

      {play.actor?.name && (
        <ActorCard
          x={toX}
          y={FIELD_CENTER_Y}
          title={play.actor.name}
          summary={play.actor.summary}
          lines={play.actor.lines}
          previousLines={play.actor.previousLines}
          headshotUrl={play.actor.headshotUrl}
          accent={C.red}
          delay={actorDelay}
          side={actorSide}
          anchor="above"
        />
      )}
    </g>
  );
}

// ── Kick / Return ─────────────────────────────────────────────

/**
 * Handles kickoff and punt trajectories + optional return leg.
 */
function KickAnimation({
  fromX,
  toX,
  play,
  awayAbbr,
}: {
  fromX: number;
  toX: number;
  play: PlayAnimationData;
  awayAbbr: string;
}) {
  const totalDuration = ANIM_TIMING.kick * 0.74;
  const landingX =
    play.kickLandingSide && typeof play.kickLandingYardline === 'number'
      ? fieldPctToSvgX(yardToFieldPct(play.kickLandingYardline, play.kickLandingSide, awayAbbr))
      : toX;
  const hasReturn = Math.abs(toX - landingX) > 2;
  const isTouchback = /touchback/i.test(play.description);
  const kickOutOfBounds = /\bout of bounds\b/i.test(play.description);
  const returnOutOfBounds = /\b(?:ran|pushed)\s+ob\b/i.test(play.description);
  const hasReturnRunner = hasReturn && Boolean(play.actor?.name);
  const kickDuration = hasReturn ? totalDuration * 0.62 : totalDuration;
  const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
  const kickMidX = (fromX + landingX) / 2;
  const landingY = kickOutOfBounds && !hasReturnRunner ? FIELD_TOP - 8 : FIELD_CENTER_Y;
  const kickPeakY =
    kickOutOfBounds && !hasReturnRunner ? FIELD_CENTER_Y - 140 : FIELD_CENTER_Y - 120;
  const kickArcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${kickMidX},${kickPeakY} ${landingX},${landingY}`;
  const returnEndY = returnOutOfBounds ? FIELD_TOP - 8 : FIELD_CENTER_Y;
  const returnCurveY = returnEndY + (toX > landingX ? 34 : -34);
  const returnPath =
    isTouchback && !hasReturnRunner
      ? `M ${landingX},${landingY} L ${toX},${FIELD_CENTER_Y}`
      : `M ${landingX},${landingY} Q ${(landingX + toX) / 2},${returnCurveY} ${toX},${returnEndY}`;
  const finishColor = hasReturnRunner ? C.amber : C.cyan;
  const finishY = hasReturn ? returnEndY : landingY;
  const resultLabelY =
    kickOutOfBounds && !hasReturn ? Math.max(FIELD_TOP + 12, landingY + 14) : finishY + 18;
  const kickKindLabel = /\bpunts?\b/i.test(play.description) ? 'PUNT' : 'KICKOFF';

  return (
    <g>
      <KickAttemptLabel x={fromX} label={kickKindLabel} />

      <path
        d={kickArcPath}
        fill="none"
        stroke={C.cyan}
        strokeWidth={1.8}
        opacity={0.52}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
        data-anim="kick-main-path"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${kickDuration}s`}
          fill="freeze"
        />
      </path>

      <circle r="3.5" fill={C.cyan} opacity={0.95}>
        <animateMotion dur={`${kickDuration}s`} fill="freeze" path={kickArcPath} />
      </circle>

      {hasReturn && (
        <>
          <path
            d={returnPath}
            fill="none"
            stroke={hasReturnRunner ? C.amber : C.cyan}
            strokeWidth={2.2}
            opacity={0.68}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1}
            data-anim="kick-return-path"
            visibility="hidden"
          >
            <set attributeName="visibility" to="visible" begin={`${kickDuration}s`} fill="freeze" />
            <animate
              attributeName="stroke-dashoffset"
              begin={`${kickDuration}s`}
              dur={`${returnDuration}s`}
              from="1"
              to="0"
              fill="freeze"
            />
          </path>
          {hasReturnRunner && (
            <circle
              r="4.2"
              fill={C.amber}
              opacity={0.96}
              visibility="hidden"
              data-anim="kick-return-runner"
              style={{
                filter: `drop-shadow(0 0 6px ${C.amberGlow})`,
              }}
            >
              <set attributeName="visibility" to="visible" begin={`${kickDuration}s`} fill="freeze" />
              <animateMotion
                begin={`${kickDuration}s`}
                dur={`${returnDuration}s`}
                fill="freeze"
                path={returnPath}
              />
            </circle>
          )}
        </>
      )}

      <circle
        cx={landingX}
        cy={landingY}
        r={hasReturn ? 3.2 : 5}
        fill={C.cyan}
        opacity={0}
        visibility="hidden"
        data-anim="kick-landing-dot"
      >
        <set attributeName="visibility" to="visible" begin={`${kickDuration + 0.04}s`} fill="freeze" />
        <animate
          attributeName="opacity"
          begin={`${kickDuration + 0.04}s`}
          dur="0.25s"
          from="0"
          to="1"
          fill="freeze"
        />
      </circle>

      <circle
        cx={toX}
        cy={finishY}
        r={5}
        fill={hasReturn ? finishColor : C.cyan}
        opacity={0}
        visibility="hidden"
        data-anim="kick-end-dot"
      >
        <set
          attributeName="visibility"
          to="visible"
          begin={`${hasReturn ? kickDuration + returnDuration + 0.04 : kickDuration + 0.04}s`}
          fill="freeze"
        />
        <animate
          attributeName="opacity"
          begin={`${hasReturn ? kickDuration + returnDuration + 0.04 : kickDuration + 0.04}s`}
          dur="0.25s"
          from="0"
          to="1"
          fill="freeze"
        />
      </circle>

      <text
        x={toX}
        y={resultLabelY}
        textAnchor="middle"
        fill={C.textDim}
        fontSize={10}
        fontFamily={F.display}
        fontWeight={600}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${hasReturn ? kickDuration + returnDuration + 0.05 : kickDuration + 0.1}s forwards`,
        }}
      >
        {hasReturn
          ? isTouchback && !hasReturnRunner
            ? 'TOUCHBACK'
            : `${play.yardsGained >= 0 ? '+' : ''}${play.yardsGained} RET`
          : `${Math.round(Math.abs(landingX - fromX) / 7.36)} YDS${kickOutOfBounds ? ' OOB' : ''}`}
      </text>

      {play.actor?.name && (
        <ActorCard
          x={toX}
          y={finishY}
          title={play.actor.name}
          summary={play.actor.summary}
          lines={play.actor.lines}
          previousLines={play.actor.previousLines}
          headshotUrl={play.actor.headshotUrl}
          accent={C.amber}
          delay={hasReturn ? kickDuration + returnDuration + 0.05 : kickDuration + 0.05}
          side={toX >= landingX ? 'right' : 'left'}
          anchor="above"
        />
      )}
    </g>
  );
}

// ── Field Goal ────────────────────────────────────────────────

/**
 * Renders FG/XP attempt from snap spot to goal posts/endzone target.
 */
function FieldGoalAnimation({
  fromX,
  play,
  possIsAway,
}: {
  fromX: number;
  play: PlayAnimationData;
  possIsAway: boolean;
}) {
  const { goalLineX, backWallX } = getFgEndpoints(possIsAway);
  const isMade = play.fgResult === 'made';
  const isShort = play.fgResult === 'short';
  const endX = isShort ? goalLineX : backWallX;
  const midX = (fromX + endX) / 2;
  const arcHeight = 160;
  const duration = ANIM_TIMING.fieldgoal;
  const durationFast = duration * 0.74;

  // Veer offset for wide kicks
  let endY = FIELD_CENTER_Y;
  if (play.fgResult === 'wide_left') endY = FIELD_CENTER_Y - 60;
  if (play.fgResult === 'wide_right') endY = FIELD_CENTER_Y + 60;

  const arcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${midX},${FIELD_CENTER_Y - arcHeight} ${endX},${endY}`;
  const trailColor = isMade ? C.green : C.red;
  const cardSide: 'left' | 'right' = possIsAway ? 'left' : 'right';

  return (
    <g>
      <KickAttemptLabel x={fromX} label="FG ATTEMPT" />

      <path
        d={arcPath}
        fill="none"
        stroke={trailColor}
        strokeWidth={2}
        opacity={0.5}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${durationFast}s`}
          fill="freeze"
        />
      </path>

      {/* Landing dot */}
      <circle
        cx={endX}
        cy={endY}
        r={5}
        fill={trailColor}
        opacity={0}
        style={{ animation: `fadeIn 0.3s ease ${durationFast}s forwards` }}
      />

      {/* Result label */}
      <text
        x={endX}
        y={endY - 14}
        textAnchor="middle"
        fill={trailColor}
        fontSize={11}
        fontFamily={F.display}
        fontWeight={800}
        letterSpacing={2}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${durationFast + 0.1}s forwards`,
        }}
      >
        {isMade ? 'GOOD' : play.fgResult?.replace('_', ' ').toUpperCase()}
      </text>
      {play.fgDistance && (
        <text
          x={endX}
          y={endY - 2}
          textAnchor="middle"
          fill={C.textDim}
          fontSize={9}
          fontFamily={F.mono}
          style={{
            opacity: 0,
            animation: `slideUp 0.3s ease ${durationFast + 0.2}s forwards`,
          }}
        >
          {play.fgDistance} YDS
        </text>
      )}
      {play.actor?.name && (
        <ActorCard
          x={fromX}
          y={FIELD_CENTER_Y + 4}
          title={play.actor.name}
          summary={play.actor.summary}
          lines={play.actor.lines}
          previousLines={play.actor.previousLines}
          headshotUrl={play.actor.headshotUrl}
          accent={isMade ? C.amber : C.red}
          delay={durationFast + 0.24}
          side={cardSide}
          anchor="above"
        />
      )}
    </g>
  );
}

function KickAttemptLabel({
  x,
  label,
  delay = 0,
}: {
  x: number;
  label: string;
  delay?: number;
}) {
  const width = Math.max(220, Math.min(420, 88 + label.length * 25));
  const height = 46;
  const y = FIELD_TOP + 2;
  return (
    <g style={{ opacity: 0, animation: `fadeIn 0.16s ease ${delay}s forwards` }}>
      <rect
        x={x - width / 2}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill="rgba(7,11,20,.9)"
        stroke={C.amberBorder}
        strokeWidth={1.2}
      />
      <text
        x={x}
        y={y + 32}
        textAnchor="middle"
        fill={C.amber}
        fontSize={30}
        fontFamily={F.display}
        fontWeight={700}
        letterSpacing=".08em"
      >
        {label}
      </text>
    </g>
  );
}

function PreTrySnapGuide({
  x,
  hideAt,
}: {
  x: number;
  hideAt?: number;
}) {
  const fadeOutStyle =
    hideAt == null ? undefined : { animation: `fadeOut 0.22s ease ${hideAt}s forwards` };

  return (
    <g>
      <line
        x1={x}
        y1={FIELD_TOP}
        x2={x}
        y2={FIELD_BOTTOM}
        stroke="#3b82f6"
        strokeWidth={2.5}
        opacity={0.45}
        data-anim="pretry-los"
        style={fadeOutStyle}
      />
      <g data-anim="pretry-ball" style={fadeOutStyle}>
        <circle cx={x} cy={FIELD_CENTER_Y} r="28" fill="url(#ballG)" />
        <circle cx={x} cy={FIELD_CENTER_Y} r="12" fill="none" stroke={C.amber} strokeWidth="1.4" opacity=".34" />
        <circle cx={x} cy={FIELD_CENTER_Y} r="7" fill={C.amber} filter="url(#gf)" opacity=".9" />
        <circle cx={x} cy={FIELD_CENTER_Y} r="2.4" fill="#fff" opacity=".82" />
      </g>
    </g>
  );
}

function PenaltyCallout({
  x,
  y,
  play,
  delay = 0,
  side,
}: {
  x: number;
  y: number;
  play: PlayAnimationData;
  delay?: number;
  side: 'left' | 'right';
}) {
  const teamLine = play.penaltyTeam ? `${play.penaltyTeam} PENALTY` : 'PENALTY';
  const typeLine = play.penaltyType || 'Penalty';
  const yards = Math.max(0, play.penaltyYards ?? 0);
  const yardsLine = yards > 0 ? `${yards} Yard Penalty` : 'Penalty';
  const playerLine = play.penaltyPlayer?.trim();
  const detailLines = [teamLine, typeLine, yardsLine, playerLine].filter(Boolean) as string[];
  const longest = Math.max(...detailLines.map((line) => line.length), 14);
  const width = Math.max(180, Math.min(300, 84 + longest * 7.2));
  const height = 22 + detailLines.length * 16;
  const desiredX = side === 'right' ? x + 14 : x - width - 14;
  const boxX = Math.max(FIELD_LEFT + 4, Math.min(FIELD_RIGHT - width - 4, desiredX));
  const desiredY = y - height - 12;
  const boxY = Math.max(FIELD_TOP + 4, Math.min(FIELD_BOTTOM - height - 4, desiredY));

  return (
    <g style={{ opacity: 0, animation: `slideUp 0.24s ease ${delay}s forwards` }}>
      <rect
        x={boxX}
        y={boxY}
        width={width}
        height={height}
        rx={2}
        fill="rgba(18,14,2,.96)"
        stroke={C.amber}
        strokeOpacity={0.7}
        strokeWidth={1}
      />
      <text
        x={boxX + 10}
        y={boxY + 13}
        textAnchor="start"
        fill={C.amber}
        fontSize={9}
        fontFamily={F.display}
        fontWeight={800}
        letterSpacing=".16em"
      >
        FLAG
      </text>
      {detailLines.map((line, index) => (
        <text
          key={`${line}-${index}`}
          x={boxX + 10}
          y={boxY + 30 + index * 16}
          textAnchor="start"
          fill={index === 0 ? C.amber : C.textBright}
          fontSize={index === 1 ? 14 : 12}
          fontFamily={F.display}
          fontWeight={index === 1 ? 700 : 600}
          letterSpacing={index === 1 ? '.02em' : '.08em'}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function ActorCard({
  x,
  y,
  title,
  summary,
  lines,
  previousLines,
  headshotUrl,
  accent,
  delay = 0,
  side,
  anchor = 'above',
  disappearAfter,
}: {
  x: number;
  y: number;
  title: string;
  summary?: string;
  lines?: string[];
  previousLines?: string[];
  headshotUrl?: string;
  accent: string;
  delay?: number;
  side: 'left' | 'right';
  anchor?: 'above' | 'below';
  disappearAfter?: number;
}) {
  const detailLines = (lines ?? []).filter((line) => line.trim().length > 0).slice(0, 4);
  const priorLines = (previousLines ?? []).filter((line) => line.trim().length > 0).slice(0, 4);
  const lineCount = Math.max(detailLines.length, priorLines.length);
  const detailLineHeight = 20;
  const headerHeight = 18 + (summary ? 18 : 0);
  const hasAvatar = Boolean(headshotUrl);
  const longestLineLength = Math.max(
    title.length,
    summary?.length ?? 0,
    ...detailLines.map((line) => line.length),
    ...priorLines.map((line) => line.length),
    0
  );
  const baseWidth = (hasAvatar ? 82 : 28) + longestLineLength * 9.3;
  const width = Math.max(hasAvatar ? 184 : 148, Math.min(380, Math.round(baseWidth)));
  const contentHeight = headerHeight + lineCount * detailLineHeight;
  const height = Math.max(56, contentHeight + 18);
  const desiredX = side === 'right' ? x + 12 : x - width - 12;
  const cardX = Math.max(4, Math.min(1000 - width - 4, desiredX));
  const desiredY = anchor === 'above' ? y - height - 10 : y + 8;
  const cardY = Math.max(FIELD_TOP + 4, Math.min(FIELD_BOTTOM - height - 4, desiredY));
  const avatarSize = 32;
  const avatarX = cardX + 8;
  const avatarY = cardY + 8;
  const textStartX = hasAvatar ? avatarX + avatarSize + 8 : cardX + 10;
  const titleY = cardY + 18;
  const summaryY = titleY + 18;
  const detailsStartY = summary ? summaryY + 20 : titleY + 20;
  const clipId = `actor-headshot-${Math.abs(Math.round(cardX))}-${Math.abs(Math.round(cardY))}-${title.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
  const animationParts = [`slideUp 0.28s ease ${delay}s forwards`];
  if (disappearAfter != null) {
    animationParts.push(`fadeOut 0.22s ease ${disappearAfter}s forwards`);
  }

  const charWidth = 8.7;

  return (
    <g style={{ opacity: 0, animation: animationParts.join(', ') }}>
      <rect
        x={cardX}
        y={cardY}
        width={width}
        height={height}
        rx={2}
        fill="rgba(4,11,24,.94)"
        stroke={accent}
        strokeOpacity={0.4}
        strokeWidth={1}
      />
      {hasAvatar && (
        <circle
          cx={avatarX + avatarSize / 2}
          cy={avatarY + avatarSize / 2}
          r={avatarSize / 2}
          fill="rgba(255,255,255,.04)"
          stroke={accent}
          strokeOpacity={0.5}
          strokeWidth={0.8}
        />
      )}
      {headshotUrl && (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle
                cx={avatarX + avatarSize / 2}
                cy={avatarY + avatarSize / 2}
                r={avatarSize / 2 - 0.4}
              />
            </clipPath>
          </defs>
          <image
            href={headshotUrl}
            x={avatarX}
            y={avatarY}
            width={avatarSize}
            height={avatarSize}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      )}
      <text
        x={textStartX}
        y={titleY}
        textAnchor="start"
        fill={C.textBright}
        fontSize={17}
        fontFamily={F.display}
        fontWeight={700}
      >
        {title}
      </text>
      {summary && (
        <text
          x={textStartX}
          y={summaryY}
          textAnchor="start"
          fill={accent}
          fontSize={16}
          fontFamily={F.display}
          fontWeight={700}
        >
          {summary}
        </text>
      )}
      {Array.from({ length: lineCount }, (_, index) => {
        const line = detailLines[index];
        const prev = priorLines[index];
        if (!line && !prev) return null;

        const yPos = detailsStartY + index * detailLineHeight;
        const shouldAnimateSwap = Boolean(line && prev && line !== prev);
        const numericSwap = shouldAnimateSwap && line && prev ? buildNumericSwapPlan(prev, line) : null;

        return (
          <g key={`line-${index}-${line ?? 'empty'}-${prev ?? 'none'}`}>
            {numericSwap && (
              <>
                <text
                  x={textStartX}
                  y={yPos}
                  textAnchor="start"
                  fill={C.textBright}
                  fillOpacity={0.98}
                  fontSize={15}
                  fontFamily={F.mono}
                  letterSpacing=".02em"
                >
                  {numericSwap.baseLine}
                </text>
                {numericSwap.changed.map((segment) => (
                  <text
                    key={`old-${segment.start}-${segment.prev}`}
                    x={textStartX + segment.start * charWidth}
                    y={yPos}
                    textAnchor="start"
                    fill={C.textBright}
                    fillOpacity={0.95}
                    fontSize={15}
                    fontFamily={F.mono}
                    letterSpacing=".02em"
                    style={{ animation: `fadeOut 0.16s linear ${delay + 0.95}s forwards` }}
                  >
                    {segment.prev}
                  </text>
                ))}
                {numericSwap.changed.map((segment) => (
                  <text
                    key={`new-${segment.start}-${segment.next}`}
                    x={textStartX + segment.start * charWidth}
                    y={yPos}
                    textAnchor="start"
                    fill={C.textBright}
                    fillOpacity={0.98}
                    fontSize={15}
                    fontFamily={F.mono}
                    letterSpacing=".02em"
                    style={{ opacity: 0, animation: `fadeIn 0.18s ease ${delay + 1.1}s forwards` }}
                  >
                    {segment.next}
                  </text>
                ))}
              </>
            )}
            {!numericSwap && line && (
              <text
                x={textStartX}
                y={yPos}
                textAnchor="start"
                fill={C.textBright}
                fillOpacity={0.98}
                fontSize={15}
                fontFamily={F.mono}
                letterSpacing=".02em"
              >
                {line}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

interface NumericSwapSegment {
  start: number;
  prev: string;
  next: string;
}

interface NumericSwapPlan {
  baseLine: string;
  changed: NumericSwapSegment[];
}

function buildNumericSwapPlan(previousLine: string, nextLine: string): NumericSwapPlan | null {
  const prevSkeleton = previousLine.replace(/\d+/g, '#');
  const nextSkeleton = nextLine.replace(/\d+/g, '#');
  if (prevSkeleton !== nextSkeleton) return null;

  const prevTokens = [...previousLine.matchAll(/\d+/g)].map((match) => ({
    value: match[0],
    start: match.index ?? -1,
  }));
  const nextTokens = [...nextLine.matchAll(/\d+/g)].map((match) => ({
    value: match[0],
    start: match.index ?? -1,
  }));
  if (prevTokens.length === 0 || prevTokens.length !== nextTokens.length) return null;

  const changed: NumericSwapSegment[] = [];
  for (let i = 0; i < prevTokens.length; i += 1) {
    const prevToken = prevTokens[i]!;
    const nextToken = nextTokens[i]!;
    if (prevToken.start !== nextToken.start) return null;
    if (prevToken.value !== nextToken.value) {
      changed.push({ start: nextToken.start, prev: prevToken.value, next: nextToken.value });
    }
  }
  if (changed.length === 0) return null;

  const chars = [...nextLine];
  for (const segment of changed) {
    for (let i = 0; i < segment.next.length; i += 1) {
      if (segment.start + i < chars.length) {
        chars[segment.start + i] = '\u00A0';
      }
    }
  }

  return {
    baseLine: chars.join('').replace(/ /g, '\u00A0'),
    changed,
  };
}

// ── First Down Marker ─────────────────────────────────────────

function FirstDownMarker({ x }: { x: number }) {
  return (
    <g>
      {/* Green pulsing line at new first-down position */}
      <line
        x1={x}
        y1={FIELD_TOP}
        x2={x}
        y2={FIELD_BOTTOM}
        stroke={C.green}
        strokeWidth={3}
        opacity={0.6}
        style={{ animation: `firstDownPulse 1.2s ease ${ANIM_TIMING.firstDownDelay}s forwards` }}
      />

      {/* Amber dashed sweep */}
      <line
        x1={x}
        y1={FIELD_TOP}
        x2={x}
        y2={FIELD_BOTTOM}
        stroke={C.amber}
        strokeWidth={1.5}
        opacity={0.4}
        strokeDasharray="6 4"
        style={{ animation: `firstDownSweep 0.8s ease ${ANIM_TIMING.firstDownDelay}s forwards` }}
      />

      {/* 1ST DOWN badge */}
      <g
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${ANIM_TIMING.firstDownDelay + 0.3}s forwards`,
        }}
      >
        <rect
          x={x - 34}
          y={FIELD_TOP - 24}
          width={68}
          height={14}
          rx={2}
          fill={C.green}
          opacity={0.9}
        />
        <text
          x={x}
          y={FIELD_TOP - 13}
          textAnchor="middle"
          fill={C.bg}
          fontSize={8}
          fontFamily={F.display}
          fontWeight={800}
        >
          1ST DOWN
        </text>
      </g>
    </g>
  );
}
