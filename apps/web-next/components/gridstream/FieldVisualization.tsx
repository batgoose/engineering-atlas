'use client';

/**
 * 3D field canvas + static overlays (LOS/first-down/drive-start/timeout banner).
 *
 * Animation sequencing lives in `PlayAnimation`; this component only decides
 * which persistent guides should render at the current replay frame.
 */

import { useEffect, useRef } from 'react';
import type { HudTeam, Situation, PlayAnimationData, WeatherState, DriveProgress } from '@atlas/sdk/gridstream/types';
import { yardToFieldPct } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { FIELD_LEFT, FIELD_RIGHT, FIELD_TOP, FIELD_BOTTOM, FIELD_CENTER_Y, FIELD_PERSPECTIVE, YARD_LINE_POSITIONS, fieldPctToSvgX } from '@atlas/sdk/gridstream/field';
import { PlayAnimation } from './PlayAnimation';

interface FieldVisualizationProps {
  away: HudTeam;
  home: HudTeam;
  situation: Situation;
  lastPlay: PlayAnimationData | null;
  animationKey: number;
  weather: WeatherState;
  venue: string;
  currentDrive?: DriveProgress | null;
  isFinal: boolean;
  fieldNotice?: string | null;
  showPlayStartSpot?: boolean;
}

export function FieldVisualization({
  away, home, situation, lastPlay, animationKey, weather, venue, currentDrive, isFinal, fieldNotice,
  showPlayStartSpot = false,
}: FieldVisualizationProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    try {
      // SMIL timelines are document-based; resetting time on each animation key
      // ensures replay/prev/next re-runs animations instead of showing final state.
      if (typeof (svg as SVGSVGElement & { unpauseAnimations?: () => void }).unpauseAnimations === 'function') {
        (svg as SVGSVGElement & { unpauseAnimations: () => void }).unpauseAnimations();
      }
      if (typeof (svg as SVGSVGElement & { setCurrentTime?: (seconds: number) => void }).setCurrentTime === 'function') {
        (svg as SVGSVGElement & { setCurrentTime: (seconds: number) => void }).setCurrentTime(0);
      }
    } catch {
      // Ignore unsupported SVG animation APIs in non-browser/test environments.
    }
  }, [animationKey]);

  const hasReplaySpot = showPlayStartSpot && Boolean(lastPlay);
  const isOfficialTimeoutNotice = /^official timeout$/i.test((fieldNotice ?? '').trim());
  const hasSituation = !isFinal && (situation.yardLine > 0 || hasReplaySpot);
  const suppressSituationGuides = Boolean(lastPlay?.isTouchdown && lastPlay?.postScoreTryKind);
  const situationPct = hasSituation ? yardToFieldPct(situation.yardLine, situation.side, away.abbr) : 50;
  const replaySpotPct = (showPlayStartSpot && lastPlay)
    ? yardToFieldPct(lastPlay.fromYardline, lastPlay.fromSide, away.abbr)
    : situationPct;
  const fallbackDrivePct = currentDrive
    ? yardToFieldPct(currentDrive.startYardLine, currentDrive.startSide, away.abbr)
    : 50;
  const guideSpotPct = hasSituation ? replaySpotPct : fallbackDrivePct;
  const losX = fieldPctToSvgX(guideSpotPct);
  const replayPossessionTeam = (showPlayStartSpot && lastPlay?.offenseTeam)
    ? lastPlay.offenseTeam
    : (situation.possessionTeam || currentDrive?.team || '');
  const replayPossIsAway = replayPossessionTeam === away.abbr;
  const replayDistanceRaw = showPlayStartSpot ? Math.max(0, lastPlay?.startDistance ?? situation.distance) : situation.distance;
  const replayDistance = replayDistanceRaw > 0 ? replayDistanceRaw : (isOfficialTimeoutNotice ? 10 : 0);
  const firstDownPct = Math.max(0, Math.min(100, guideSpotPct + (replayPossIsAway ? replayDistance : -replayDistance)));
  const fdX = fieldPctToSvgX(firstDownPct);
  const possTeam = replayPossIsAway ? away : home;

  const driveStartPct = currentDrive
    ? yardToFieldPct(currentDrive.startYardLine, currentDrive.startSide, away.abbr)
    : situationPct;
  const driveStartX = fieldPctToSvgX(driveStartPct);

  const markerSide = (showPlayStartSpot && lastPlay?.fromSide) ? lastPlay.fromSide : situation.side;
  const markerYardLine = (showPlayStartSpot && lastPlay) ? lastPlay.fromYardline : situation.yardLine;
  // Timeout before kickoff should not show inherited drive/situation guides.
  const isPreKickoffOfficialTimeout =
    isOfficialTimeoutNotice &&
    (situation.down <= 0 || situation.distance <= 0 || !situation.side || situation.yardLine <= 0);
  const showGuidesDuringTimeout =
    isOfficialTimeoutNotice &&
    !isPreKickoffOfficialTimeout &&
    Boolean(currentDrive) &&
    ((currentDrive?.plays ?? 0) > 0);
  const showSituationGuides = !isPreKickoffOfficialTimeout && (hasSituation || showGuidesDuringTimeout) && !suppressSituationGuides;
  const markerDisplaySide = markerSide || currentDrive?.startSide || situation.side;
  const markerDisplayYard = markerYardLine > 0 ? markerYardLine : (currentDrive?.startYardLine ?? situation.yardLine);

  return (
    <div style={{ position: 'relative', perspective: FIELD_PERSPECTIVE.perspective }}>
      <div style={{ transform: FIELD_PERSPECTIVE.transform, transformOrigin: FIELD_PERSPECTIVE.transformOrigin, position: 'relative' }}>
        <svg key={animationKey} ref={svgRef} viewBox="0 0 1000 420" style={{ width: '100%', display: 'block' }}>
          <defs>
            <linearGradient id="fGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.cyan} stopOpacity=".07" />
              <stop offset="50%" stopColor={C.cyan} stopOpacity=".02" />
              <stop offset="100%" stopColor={C.cyan} stopOpacity=".05" />
            </linearGradient>
            <radialGradient id="ballG" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.amber} stopOpacity=".6" />
              <stop offset="60%" stopColor={C.amber} stopOpacity=".1" />
              <stop offset="100%" stopColor={C.amber} stopOpacity="0" />
            </radialGradient>
            <filter id="gf"><feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <pattern id="ezPatA" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="12" stroke={`#${away.altColor}`} strokeWidth="3" opacity=".12" />
            </pattern>
            <pattern id="ezPatH" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="12" stroke={`#${home.color}`} strokeWidth="3" opacity=".12" />
            </pattern>
          </defs>

          {/* Field body */}
          <rect x="50" y={FIELD_TOP} width="900" height={FIELD_BOTTOM - FIELD_TOP} fill="url(#fGrad)" stroke={C.cyanDim} strokeWidth="1.5" opacity=".8" filter="url(#gf)" />

          {/* Away endzone */}
          <rect x="50" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} fill={`#${away.color}`} opacity=".28" />
          <rect x="50" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} fill="url(#ezPatA)" />
          <rect x="50" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} stroke={C.cyanDim} strokeWidth=".5" fill="none" />
          <text x="91" y={FIELD_CENTER_Y} textAnchor="middle" dominantBaseline="central" fill={`#${away.altColor}`} opacity=".55" fontSize="36" fontFamily="'Barlow Condensed'" fontWeight="800" letterSpacing="16" transform={`rotate(-90 91 ${FIELD_CENTER_Y})`} style={{ filter: `drop-shadow(0 0 5px #${away.color})` }}>{away.endzoneName}</text>

          {/* Home endzone */}
          <rect x="868" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} fill={`#${home.color}`} opacity=".28" />
          <rect x="868" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} fill="url(#ezPatH)" />
          <rect x="868" y={FIELD_TOP} width="82" height={FIELD_BOTTOM - FIELD_TOP} stroke={C.cyanDim} strokeWidth=".5" fill="none" />
          <text x="909" y={FIELD_CENTER_Y} textAnchor="middle" dominantBaseline="central" fill={`#${home.altColor}`} opacity=".55" fontSize="44" fontFamily="'Barlow Condensed'" fontWeight="800" letterSpacing="18" transform={`rotate(90 909 ${FIELD_CENTER_Y})`} style={{ filter: `drop-shadow(0 0 5px #${home.color})` }}>{home.endzoneName}</text>

          {/* Goal line glows */}
          <line x1={FIELD_LEFT} y1={FIELD_TOP} x2={FIELD_LEFT} y2={FIELD_BOTTOM} stroke={`#${away.altColor}`} strokeWidth="2" opacity=".2" style={{ filter: `drop-shadow(0 0 4px #${away.altColor}40)` }} />
          <line x1={FIELD_RIGHT} y1={FIELD_TOP} x2={FIELD_RIGHT} y2={FIELD_BOTTOM} stroke={`#${home.altColor || home.color}`} strokeWidth="2" opacity=".2" style={{ filter: `drop-shadow(0 0 4px #${home.color}40)` }} />

          {/* Drive start marker */}
          {!isPreKickoffOfficialTimeout && (hasSituation || showGuidesDuringTimeout) && currentDrive && (
            <g>
              <line
                x1={driveStartX}
                y1={FIELD_TOP}
                x2={driveStartX}
                y2={FIELD_BOTTOM}
                stroke={`#${possTeam.altColor || possTeam.color}`}
                strokeWidth="1.2"
                strokeDasharray="4 6"
                opacity=".38"
              />
              <rect
                x={driveStartX - 40}
                y={FIELD_BOTTOM - 14}
                width="80"
                height="12"
                rx="2"
                fill="rgba(7,11,20,.9)"
                stroke={`#${possTeam.altColor || possTeam.color}`}
                strokeOpacity=".45"
                strokeWidth="0.8"
              />
              <text
                x={driveStartX}
                y={FIELD_BOTTOM - 5}
                textAnchor="middle"
                fill={`#${possTeam.altColor || possTeam.color}`}
                fontSize="7.5"
                fontFamily={F.display}
                fontWeight="700"
                letterSpacing=".08em"
              >
                DRIVE STARTED
              </text>
            </g>
          )}

          {/* Yard lines */}
          {YARD_LINE_POSITIONS.map(({ yard, displayNumber, x }) => (
            <g key={yard}>
              <line x1={x} y1={FIELD_TOP} x2={x} y2={FIELD_BOTTOM} stroke={C.cyan} strokeWidth=".6" opacity=".12" />
              <text x={x} y="24" textAnchor="middle" fill={C.cyanDim} fontSize="11" fontFamily="'Share Tech Mono'" opacity=".5">{displayNumber}</text>
              <text x={x} y="406" textAnchor="middle" fill={C.cyanDim} fontSize="11" fontFamily="'Share Tech Mono'" opacity=".5">{displayNumber}</text>
            </g>
          ))}
          {[5, 15, 25, 35, 45, 55, 65, 75, 85, 95].map((yd) => <line key={yd} x1={fieldPctToSvgX(yd)} y1={FIELD_TOP} x2={fieldPctToSvgX(yd)} y2={FIELD_BOTTOM} stroke={C.cyan} strokeWidth=".3" opacity=".06" />)}

          {/* Hash marks */}
          {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((yd) => {
            const x = fieldPctToSvgX(yd);
            return (<g key={`h${yd}`}>
              <line x1={x - 4} y1={155} x2={x + 4} y2={155} stroke={C.cyan} strokeWidth=".5" opacity=".1" />
              <line x1={x - 4} y1={265} x2={x + 4} y2={265} stroke={C.cyan} strokeWidth=".5" opacity=".1" />
            </g>);
          })}

          {/* LOS + First down */}
          {showSituationGuides && <>
            <line x1={losX} y1={FIELD_TOP} x2={losX} y2={FIELD_BOTTOM} stroke="#3b82f6" strokeWidth="2.5" opacity=".45" />
            {replayDistance > 0 && <line x1={fdX} y1={FIELD_TOP} x2={fdX} y2={FIELD_BOTTOM} stroke={C.amber} strokeWidth="2" strokeDasharray="8 5" opacity=".45" />}
          </>}

          {/* Ball marker — full v11 treatment */}
          {showSituationGuides && (() => {
            const bx = losX, by = FIELD_CENTER_Y;
            return (<g>
              <circle cx={bx} cy={by} r="28" fill="url(#ballG)" />
              <circle cx={bx} cy={by} r="12" fill="none" stroke={`#${possTeam.altColor || possTeam.color}`} strokeWidth="1.5" opacity=".3" />
              <circle cx={bx} cy={by} r="7" fill={C.amber} filter="url(#gf)" opacity=".9">
                <animate attributeName="r" values="6;8;6" dur="2.5s" repeatCount="indefinite" />
              </circle>
              <circle cx={bx} cy={by} r="2.5" fill="#fff" opacity=".8" />
              {/* Position label pinned to top */}
              <line x1={bx} y1="30" x2={bx} y2="52" stroke={C.amber} strokeWidth="1" opacity=".3" strokeDasharray="2 2" />
              <rect x={bx - 34} y="32" width="68" height="18" rx="2" fill="rgba(7,11,20,.88)" stroke={C.amberBorder} strokeWidth="1" />
              <text x={bx} y="44" textAnchor="middle" fill={C.amber} fontSize="9" fontFamily="'Orbitron'" fontWeight="700">{markerDisplaySide} {markerDisplayYard}</text>
            </g>);
          })()}

          {/* Play animation above LOS marker labels/cards */}
          {lastPlay && <PlayAnimation key={animationKey} play={lastPlay} awayAbbr={away.abbr} />}

          {/* Administrative notice overlay (timeouts, etc.) — render last so it sits above field guides/animations */}
          {fieldNotice && (
            <g>
              <rect
                x="240"
                y="58"
                width="520"
                height="84"
                rx="3"
                fill="rgba(7,11,20,.9)"
                stroke={C.amber}
                strokeOpacity=".45"
                strokeWidth="0.8"
              />
              <text
                x="500"
                y="112"
                textAnchor="middle"
                fill={C.amber}
                fontSize="34"
                fontFamily={F.display}
                fontWeight="700"
                letterSpacing=".12em"
              >
                {fieldNotice.toUpperCase()}
              </text>
            </g>
          )}

          {/* Footer captions */}
          <text x="55" y="416" fill={C.textDim} fontSize="9" fontFamily="'Share Tech Mono'">◂ {away.abbr} END ZONE</text>
          <text x="945" y="416" textAnchor="end" fill={C.textDim} fontSize="9" fontFamily="'Share Tech Mono'">{home.abbr} END ZONE ▸</text>
          <text x="500" y="14" textAnchor="middle" fill={C.textDim} fontSize="9" fontFamily="'Share Tech Mono'" letterSpacing="4">{venue.toUpperCase()}</text>
        </svg>
      </div>
    </div>
  );
}
