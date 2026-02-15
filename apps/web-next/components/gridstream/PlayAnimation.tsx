'use client';

import type { PlayAnimationData } from '@atlas/sdk/gridstream/types';
import { yardToFieldPct } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import {
  fieldPctToSvgX, FIELD_CENTER_Y, FIELD_TOP, FIELD_BOTTOM,
  getFgEndpoints,
} from '@atlas/sdk/gridstream/field';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';

interface PlayAnimationProps {
  play: PlayAnimationData;
  awayAbbr: string;
}

export function PlayAnimation({ play, awayAbbr }: PlayAnimationProps) {
  const fromPct = yardToFieldPct(play.fromYardline, play.fromSide, awayAbbr);
  const toPct = yardToFieldPct(play.toYardline, play.toSide, awayAbbr);
  const fromX = fieldPctToSvgX(fromPct);
  const toX = fieldPctToSvgX(toPct);

  // Direction offset for pass/rush visualization
  const dirY = play.direction === 'left' ? FIELD_CENTER_Y - 60
    : play.direction === 'right' ? FIELD_CENTER_Y + 60
    : FIELD_CENTER_Y;

  switch (play.type) {
    case 'pass':
      return <PassAnimation fromX={fromX} toX={toX} dirY={dirY} play={play} />;
    case 'rush':
      return <RushAnimation fromX={fromX} toX={toX} dirY={dirY} play={play} />;
    case 'turnover':
      return <TurnoverAnimation fromX={fromX} toX={toX} dirY={dirY} play={play} />;
    case 'kick':
      return <KickAnimation fromX={fromX} toX={toX} />;
    case 'fieldgoal':
      return <FieldGoalAnimation fromX={fromX} play={play} possIsAway={play.fromSide === awayAbbr} />;
    default:
      return null;
  }
}

// ── Pass ──────────────────────────────────────────────────────

function PassAnimation({ fromX, toX, dirY, play }: {
  fromX: number; toX: number; dirY: number; play: PlayAnimationData;
}) {
  const isComplete = play.isComplete;
  const trailColor = isComplete ? C.cyan : C.red;
  const duration = ANIM_TIMING.pass;

  // Air yards endpoint (where the catch/incompletion happens)
  const airPct = play.airYards
    ? Math.abs(play.airYards) / Math.max(Math.abs(play.yardsGained), 1)
    : 0.7;
  const catchX = fromX + (toX - fromX) * Math.min(airPct, 1);

  return (
    <g>
      {/* Pass trail */}
      <line
        x1={fromX} y1={FIELD_CENTER_Y} x2={catchX} y2={dirY}
        stroke={trailColor} strokeWidth={2} opacity={0.5}
        strokeDasharray="1000" strokeDashoffset="1000"
        style={{ animation: `trailDraw ${duration}s ease forwards` }}
      />

      {/* YAC trail (if complete) */}
      {isComplete && catchX !== toX && (
        <line
          x1={catchX} y1={dirY} x2={toX} y2={dirY}
          stroke={C.green} strokeWidth={2} opacity={0.3}
          strokeDasharray="6 3"
          style={{ animation: `trailDraw 0.4s ease ${duration}s forwards` }}
        />
      )}

      {/* Catch/incompletion flash */}
      <circle
        cx={catchX} cy={dirY} r={4}
        fill="none"
        stroke={isComplete ? C.green : C.red}
        strokeWidth={2}
        style={{
          animation: `catchFlash 0.6s ease ${duration - 0.1}s forwards`,
          opacity: 0,
        }}
      />

      {/* Yards gained label */}
      <text
        x={toX} y={dirY - 12}
        textAnchor="middle" fill={isComplete ? C.green : C.red}
        fontSize={12} fontFamily={F.display} fontWeight={700}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${duration + 0.2}s forwards`,
        }}
      >
        {isComplete ? `+${play.yardsGained}` : 'INC'}
      </text>

      {/* Receiver tooltip */}
      {play.receiver && isComplete && (
        <g style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${ANIM_TIMING.receiverDelay}s forwards`,
        }}>
          <rect
            x={toX - 50} y={dirY + 10} width={100} height={30} rx={3}
            fill={C.bg} stroke={C.cyanBorder} strokeWidth={1} opacity={0.9}
          />
          <text x={toX} y={dirY + 24} textAnchor="middle" fill={C.cyan} fontSize={9} fontFamily={F.display} fontWeight={600}>
            #{play.receiver.number} {play.receiver.name}
          </text>
          <text x={toX} y={dirY + 35} textAnchor="middle" fill={C.textDim} fontSize={8} fontFamily={F.mono}>
            {play.receiver.yards} YDS · {play.receiver.tds} TD
          </text>
        </g>
      )}

      {/* First down animation */}
      {play.isFirstDown && <FirstDownMarker x={toX} />}
    </g>
  );
}

// ── Rush ──────────────────────────────────────────────────────

function RushAnimation({ fromX, toX, dirY, play }: {
  fromX: number; toX: number; dirY: number; play: PlayAnimationData;
}) {
  const duration = ANIM_TIMING.rush;

  return (
    <g>
      {/* Rush trail */}
      <line
        x1={fromX} y1={FIELD_CENTER_Y} x2={toX} y2={dirY}
        stroke={C.amber} strokeWidth={3} opacity={0.4}
        strokeDasharray="1000" strokeDashoffset="1000"
        style={{ animation: `trailDraw ${duration}s ease forwards` }}
      />

      {/* End marker */}
      <circle
        cx={toX} cy={dirY} r={5}
        fill={C.amber} opacity={0}
        style={{ animation: `fadeIn 0.3s ease ${duration}s forwards` }}
      />

      {/* Yards label */}
      <text
        x={toX} y={dirY - 12}
        textAnchor="middle" fill={C.amber}
        fontSize={12} fontFamily={F.display} fontWeight={700}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${duration + 0.1}s forwards`,
        }}
      >
        +{play.yardsGained}
      </text>

      {play.isFirstDown && <FirstDownMarker x={toX} />}
    </g>
  );
}

// ── Turnover ──────────────────────────────────────────────────

function TurnoverAnimation({ fromX, toX, dirY, play }: {
  fromX: number; toX: number; dirY: number; play: PlayAnimationData;
}) {
  const duration = ANIM_TIMING.turnover;

  return (
    <g>
      {/* Red flash overlay */}
      <rect
        x={50} y={FIELD_TOP} width={900} height={FIELD_BOTTOM - FIELD_TOP}
        fill={C.red}
        style={{ animation: `turnoverFlash 1s ease forwards` }}
      />

      {/* Trail */}
      <line
        x1={fromX} y1={FIELD_CENTER_Y} x2={toX} y2={dirY}
        stroke={C.red} strokeWidth={2.5} opacity={0.5}
        strokeDasharray="1000" strokeDashoffset="1000"
        style={{ animation: `trailDraw ${duration}s ease forwards` }}
      />

      {/* Turnover label */}
      <g style={{
        opacity: 0,
        animation: `slideUp 0.3s ease ${duration + 0.2}s forwards`,
      }}>
        {play.turnoverBy && (
          <text x={toX} y={dirY - 22} textAnchor="middle" fill={C.red} fontSize={11} fontFamily={F.display} fontWeight={800}>
            {play.turnoverBy}
          </text>
        )}
        <text x={toX} y={dirY - 10} textAnchor="middle" fill={C.red} fontSize={10} fontFamily={F.display} fontWeight={700} letterSpacing={2}>
          TURNOVER
        </text>
      </g>
    </g>
  );
}

// ── Kick (Punt) ───────────────────────────────────────────────

function KickAnimation({ fromX, toX }: { fromX: number; toX: number }) {
  const duration = ANIM_TIMING.kick;
  const midX = (fromX + toX) / 2;
  const arcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${midX},${FIELD_CENTER_Y - 100} ${toX},${FIELD_CENTER_Y}`;
  const kickYards = Math.abs(toX - fromX);

  return (
    <g>
      <path
        d={arcPath}
        fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.4}
        strokeDasharray="1000" strokeDashoffset="1000"
        style={{ animation: `trailDraw ${duration}s ease forwards` }}
      />

      {/* Landing marker */}
      <circle
        cx={toX} cy={FIELD_CENTER_Y} r={5}
        fill={C.cyan} opacity={0}
        style={{ animation: `fadeIn 0.3s ease ${duration}s forwards` }}
      />

      {/* Yardage label */}
      <text
        x={toX} y={FIELD_CENTER_Y + 18}
        textAnchor="middle" fill={C.textDim}
        fontSize={10} fontFamily={F.display} fontWeight={600}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${duration + 0.1}s forwards`,
        }}
      >
        {Math.round(kickYards / 7.36)} YDS
      </text>
    </g>
  );
}

// ── Field Goal ────────────────────────────────────────────────

function FieldGoalAnimation({ fromX, play, possIsAway }: {
  fromX: number; play: PlayAnimationData; possIsAway: boolean;
}) {
  const { goalLineX, backWallX } = getFgEndpoints(possIsAway);
  const isMade = play.fgResult === 'made';
  const isShort = play.fgResult === 'short';
  const endX = isShort ? goalLineX : backWallX;
  const midX = (fromX + endX) / 2;
  const arcHeight = 160;
  const duration = ANIM_TIMING.fieldgoal;

  // Veer offset for wide kicks
  let endY = FIELD_CENTER_Y;
  if (play.fgResult === 'wide_left') endY = FIELD_CENTER_Y - 60;
  if (play.fgResult === 'wide_right') endY = FIELD_CENTER_Y + 60;

  const arcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${midX},${FIELD_CENTER_Y - arcHeight} ${endX},${endY}`;
  const trailColor = isMade ? C.green : C.red;

  return (
    <g>
      <path
        d={arcPath}
        fill="none" stroke={trailColor} strokeWidth={2} opacity={0.5}
        strokeDasharray="1000" strokeDashoffset="1000"
        style={{ animation: `trailDraw ${duration}s ease forwards` }}
      />

      {/* Landing dot */}
      <circle
        cx={endX} cy={endY} r={5}
        fill={trailColor} opacity={0}
        style={{ animation: `fadeIn 0.3s ease ${duration}s forwards` }}
      />

      {/* Result label */}
      <text
        x={endX} y={endY - 14}
        textAnchor="middle" fill={trailColor}
        fontSize={11} fontFamily={F.display} fontWeight={800}
        letterSpacing={2}
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${duration + 0.1}s forwards`,
        }}
      >
        {isMade ? 'GOOD' : play.fgResult?.replace('_', ' ').toUpperCase()}
      </text>
      {play.fgDistance && (
        <text
          x={endX} y={endY - 2}
          textAnchor="middle" fill={C.textDim}
          fontSize={9} fontFamily={F.mono}
          style={{
            opacity: 0,
            animation: `slideUp 0.3s ease ${duration + 0.2}s forwards`,
          }}
        >
          {play.fgDistance} YDS
        </text>
      )}
    </g>
  );
}

// ── First Down Marker ─────────────────────────────────────────

function FirstDownMarker({ x }: { x: number }) {
  return (
    <g>
      {/* Green pulsing line at new first-down position */}
      <line
        x1={x} y1={FIELD_TOP} x2={x} y2={FIELD_BOTTOM}
        stroke={C.green} strokeWidth={3} opacity={0.6}
        style={{ animation: `firstDownPulse 1.2s ease ${ANIM_TIMING.firstDownDelay}s forwards` }}
      />

      {/* Amber dashed sweep */}
      <line
        x1={x} y1={FIELD_TOP} x2={x} y2={FIELD_BOTTOM}
        stroke={C.amber} strokeWidth={1.5} opacity={0.4}
        strokeDasharray="6 4"
        style={{ animation: `firstDownSweep 0.8s ease ${ANIM_TIMING.firstDownDelay}s forwards` }}
      />

      {/* 1ST DOWN badge */}
      <g style={{
        opacity: 0,
        animation: `slideUp 0.3s ease ${ANIM_TIMING.firstDownDelay + 0.3}s forwards`,
      }}>
        <rect x={x - 30} y={FIELD_TOP - 2} width={60} height={14} rx={2} fill={C.green} opacity={0.9} />
        <text x={x} y={FIELD_TOP + 9} textAnchor="middle" fill={C.bg} fontSize={8} fontFamily={F.display} fontWeight={800}>
          1ST DOWN
        </text>
      </g>
    </g>
  );
}
