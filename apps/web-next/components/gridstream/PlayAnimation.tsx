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

import type { CSSProperties } from 'react';
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
  AWAY_EZ_LEFT,
  AWAY_EZ_RIGHT,
  HOME_EZ_LEFT,
  HOME_EZ_RIGHT,
  FG_UPRIGHT_Y_HALF,
  FG_PORTAL_CENTER_Y,
  getFgEndpoints,
} from '@atlas/sdk/gridstream/field';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';

interface PlayAnimationProps {
  play: PlayAnimationData;
  awayAbbr: string;
  homeAbbr?: string;
  teamColorsByAbbr?: Record<string, TeamMarkerPalette>;
  hideHeadshots?: boolean;
  hidePenaltyCallout?: boolean;
  /** When true, suppress the FG arc trail + ball (overlay SVG renders it in screen space). */
  hideFgTrail?: boolean;
}

interface TeamMarkerPalette {
  color?: string;
  altColor?: string;
}

function clampX(value: number): number {
  return Math.max(50, Math.min(950, value));
}

const FIELD_HEADSHOT_SCALE = 4;
const FIELD_HEADSHOT_FIELD_OFFSET_Y = 0;
const FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y = -48;
const FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y = -40;
const FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER = 2;
const FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X = 56;
const SHORT_RUSH_DEPTH_DISTANCE_PX = 110;
const SHORT_RUSH_MAX_EXTRA_DEPTH_Y = 0;
const FIELD_TILT_RAD = (32 * Math.PI) / 180;
const FIELD_PERSPECTIVE_PX = 800;
const FIELD_PERSPECTIVE_ORIGIN_X = 500;
const FIELD_PERSPECTIVE_ORIGIN_Y = 420;

function markerHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function normalizeHeadshotUrl(url: string | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

function stripPlayHeadshots(play: PlayAnimationData): PlayAnimationData {
  return {
    ...play,
    actor: play.actor ? { ...play.actor, headshotUrl: undefined } : play.actor,
    qbActor: play.qbActor ? { ...play.qbActor, headshotUrl: undefined } : play.qbActor,
    postScoreTryActor: play.postScoreTryActor
      ? { ...play.postScoreTryActor, headshotUrl: undefined }
      : play.postScoreTryActor,
    postScoreTryQbActor: play.postScoreTryQbActor
      ? { ...play.postScoreTryQbActor, headshotUrl: undefined }
      : play.postScoreTryQbActor,
  };
}

function parsePathPoint(path: string, mode: 'start' | 'end'): { x: number; y: number } | null {
  const coordPattern = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null = null;
  let first: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((match = coordPattern.exec(path)) !== null) {
    if (!first) first = match;
    last = match;
  }
  const target = mode === 'start' ? first : last;
  if (!target?.[1] || !target[2]) return null;
  const x = Number.parseFloat(target[1]);
  const y = Number.parseFloat(target[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function projectFieldPointToScreen(x: number, y: number): { x: number; y: number } {
  const relX = x - FIELD_PERSPECTIVE_ORIGIN_X;
  const relY = y - FIELD_PERSPECTIVE_ORIGIN_Y;
  const sinTilt = Math.sin(FIELD_TILT_RAD);
  const cosTilt = Math.cos(FIELD_TILT_RAD);
  const z = relY * sinTilt;
  const scale = FIELD_PERSPECTIVE_PX / (FIELD_PERSPECTIVE_PX - z);
  return {
    x: FIELD_PERSPECTIVE_ORIGIN_X + relX * scale,
    y: FIELD_PERSPECTIVE_ORIGIN_Y + relY * cosTilt * scale,
  };
}

function buildHeadshotScreenCompensation(x: number, y: number): string {
  const sampleRadius = 24;
  const left = projectFieldPointToScreen(x - sampleRadius, y);
  const right = projectFieldPointToScreen(x + sampleRadius, y);
  const top = projectFieldPointToScreen(x, y - sampleRadius);
  const bottom = projectFieldPointToScreen(x, y + sampleRadius);
  const projectedXRadius = Math.abs(right.x - left.x) / 2;
  const projectedYRadius = Math.abs(bottom.y - top.y) / 2;
  if (
    !Number.isFinite(projectedXRadius) ||
    !Number.isFinite(projectedYRadius) ||
    projectedYRadius < 0.001
  ) {
    return 'matrix(1 0 0 1 0 0)';
  }

  const scaleY = Math.max(0.8, Math.min(1.5, projectedXRadius / projectedYRadius));
  return `matrix(1 0 0 ${scaleY} 0 0)`;
}

function samePlayerName(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const leftKey = left.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rightKey = right.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey;
}

function normalizeHexColor(hexColor?: string): string | null {
  if (!hexColor) return null;
  const hex = hexColor.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

function relativeLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '').trim();
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getReadableTeamColor(palette?: TeamMarkerPalette): string | null {
  if (!palette) return null;
  const candidates = [normalizeHexColor(palette.color), normalizeHexColor(palette.altColor)].filter(
    Boolean
  ) as string[];
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => relativeLuminance(b) - relativeLuminance(a));
  for (const color of sorted) {
    if (relativeLuminance(color) >= 0.16) return color;
  }
  return sorted[0] ?? null;
}

function getTeamPalette(
  teamAbbr: string | undefined,
  teamColorsByAbbr?: Record<string, TeamMarkerPalette>
): TeamMarkerPalette | undefined {
  if (!teamAbbr || !teamColorsByAbbr) return undefined;
  const key = teamAbbr.trim().toUpperCase();
  return (
    teamColorsByAbbr[key] ??
    teamColorsByAbbr[teamAbbr] ??
    Object.entries(teamColorsByAbbr).find(([abbr]) => abbr.toUpperCase() === key)?.[1]
  );
}

function resolveTeamRingColor(
  teamAbbr: string | undefined,
  teamColorsByAbbr: Record<string, TeamMarkerPalette> | undefined,
  fallback: string
): string {
  const palette = getTeamPalette(teamAbbr, teamColorsByAbbr);
  return getReadableTeamColor(palette) ?? fallback;
}

function resolveDefenseTeam(
  offenseTeam: string | undefined,
  awayAbbr: string,
  homeAbbr?: string,
  teamColorsByAbbr?: Record<string, TeamMarkerPalette>
): string | undefined {
  const offense = offenseTeam?.trim().toUpperCase();
  const away = awayAbbr.trim().toUpperCase();
  const home = homeAbbr?.trim().toUpperCase();
  if (!offense) return undefined;
  if (home && offense === away) return home;
  if (home && offense === home) return away;
  const teamKeys = Object.keys(teamColorsByAbbr ?? {}).map((key) => key.toUpperCase());
  if (teamKeys.length === 2 && teamKeys.includes(offense)) {
    return teamKeys.find((key) => key !== offense);
  }
  return undefined;
}

function MovingHeadshotMarker({
  markerId,
  path,
  duration,
  begin,
  headshotUrl,
  fallbackRadius,
  fallbackFill,
  ringColor,
  avatarRadius = 6.2,
  opacity = 0.95,
  style,
  dataAnim,
  hiddenUntilBegin = false,
  hideFallbackUntilBegin = false,
  standupDelay,
  depthOffsetY = FIELD_HEADSHOT_FIELD_OFFSET_Y,
  sizeMultiplier = 1,
}: {
  markerId: string;
  path: string;
  duration: string;
  begin?: string;
  headshotUrl?: string;
  fallbackRadius: number;
  fallbackFill: string;
  ringColor?: string;
  avatarRadius?: number;
  opacity?: number;
  style?: CSSProperties;
  dataAnim?: string;
  hiddenUntilBegin?: boolean;
  hideFallbackUntilBegin?: boolean;
  standupDelay?: string;
  depthOffsetY?: number;
  sizeMultiplier?: number;
}) {
  const resolvedHeadshot = normalizeHeadshotUrl(headshotUrl);
  if (!resolvedHeadshot) {
    const hideFallback = hideFallbackUntilBegin && hiddenUntilBegin && Boolean(begin);
    return (
      <circle
        r={fallbackRadius}
        fill={fallbackFill}
        opacity={opacity}
        style={style}
        data-anim={dataAnim}
        visibility={hideFallback ? 'hidden' : undefined}
      >
        {hideFallback && begin && (
          <set attributeName="visibility" to="visible" begin={begin} fill="freeze" />
        )}
        <animateMotion
          begin={begin}
          dur={duration}
          fill="freeze"
          path={path}
          keyPoints="0;1"
          keyTimes="0;1"
          calcMode="linear"
        />
      </circle>
    );
  }

  const ring = ringColor ?? fallbackFill;
  const scaledAvatarRadius = avatarRadius * FIELD_HEADSHOT_SCALE * sizeMultiplier;
  const clipId = `marker-clip-${markerHash(`${markerId}:${path}:${duration}:${begin ?? '0'}`)}`;
  const imageSize = scaledAvatarRadius * 2;
  const ringStroke = Math.max(0.8, scaledAvatarRadius * 0.07);
  const shadowRx = scaledAvatarRadius * 0.66;
  const shadowRy = Math.max(2.5, scaledAvatarRadius * 0.2);
  const shadowSoftRx = shadowRx * 1.2;
  const shadowSoftRy = shadowRy * 1.5;
  const shadowY = scaledAvatarRadius * 0.92;
  const shadowSoftY = shadowY + shadowRy * 1.05;
  const standDelay = standupDelay ?? begin ?? '0s';
  const standStyle: CSSProperties = {
    willChange: 'transform, opacity',
    animation: `markerStandUp 0.3s ease-out ${standDelay} both`,
  };
  const pathEnd = parsePathPoint(path, 'end');
  const uprightTransform =
    pathEnd == null
      ? 'matrix(1 0 0 1 0 0)'
      : buildHeadshotScreenCompensation(pathEnd.x, pathEnd.y + depthOffsetY);

  return (
    <g
      opacity={opacity}
      style={style}
      data-anim={dataAnim}
      visibility={hiddenUntilBegin ? 'hidden' : undefined}
    >
      {hiddenUntilBegin && begin && (
        <set attributeName="visibility" to="visible" begin={begin} fill="freeze" />
      )}
      <defs>
        <clipPath id={clipId}>
          <circle cx={0} cy={0} r={scaledAvatarRadius - 0.7} />
        </clipPath>
      </defs>
      <g transform={`translate(0 ${depthOffsetY})`}>
        <ellipse
          cx={0}
          cy={shadowSoftY}
          rx={shadowSoftRx}
          ry={shadowSoftRy}
          fill="rgba(0,0,0,0.18)"
        />
        <ellipse cx={0} cy={shadowY} rx={shadowRx} ry={shadowRy} fill="rgba(0,0,0,0.36)" />
        <g transform={uprightTransform}>
          <g style={standStyle}>
            {/* Glow bloom behind ring */}
            <circle
              r={scaledAvatarRadius + ringStroke * 0.5}
              fill="none"
              stroke={ring}
              strokeOpacity={0.22}
              strokeWidth={ringStroke * 4}
            />
            <circle
              r={scaledAvatarRadius}
              fill="rgba(5,12,24,.94)"
              stroke={ring}
              strokeOpacity={0.9}
              strokeWidth={ringStroke}
            />
            <image
              href={resolvedHeadshot}
              x={-scaledAvatarRadius}
              y={-scaledAvatarRadius}
              width={imageSize}
              height={imageSize}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clipId})`}
            />
          </g>
        </g>
      </g>
      <animateMotion
        begin={begin}
        dur={duration}
        fill="freeze"
        path={path}
        keyPoints="0;1"
        keyTimes="0;1"
        calcMode="linear"
      />
    </g>
  );
}

function StaticHeadshotMarker({
  markerId,
  x,
  y,
  headshotUrl,
  playerName,
  fallbackRadius,
  fallbackFill,
  ringColor,
  avatarRadius = 5.8,
  opacity = 1,
  style,
  dataAnim,
  standupDelay,
  depthOffsetY = FIELD_HEADSHOT_FIELD_OFFSET_Y,
  sizeMultiplier = 1,
}: {
  markerId: string;
  x: number;
  y: number;
  headshotUrl?: string;
  playerName?: string;
  fallbackRadius: number;
  fallbackFill: string;
  ringColor?: string;
  avatarRadius?: number;
  opacity?: number;
  style?: CSSProperties;
  dataAnim?: string;
  standupDelay?: string;
  depthOffsetY?: number;
  sizeMultiplier?: number;
}) {
  const resolvedHeadshot = normalizeHeadshotUrl(headshotUrl);
  if (!resolvedHeadshot) {
    if (playerName) {
      // Initials avatar: render at field-surface level (no depth offset) to avoid
      // CSS/SVG transform composition issues that cause ovals under perspective.
      const initials = playerName
        .trim()
        .split(/\s+/)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .filter(Boolean)
        .slice(0, 2)
        .join('');
      const ring = ringColor ?? fallbackFill;
      const scaledAvatarRadius = avatarRadius * FIELD_HEADSHOT_SCALE * sizeMultiplier;
      const ringStroke = Math.max(0.8, scaledAvatarRadius * 0.07);
      // Use field-surface y (no depthOffsetY) to keep compensation simple & stable
      const uprightTransform = buildHeadshotScreenCompensation(x, y);
      return (
        <g transform={`translate(${x} ${y})`} opacity={opacity} style={style} data-anim={dataAnim}>
          <g transform={uprightTransform}>
            <circle
              r={scaledAvatarRadius + ringStroke * 0.5}
              fill="none"
              stroke={ring}
              strokeOpacity={0.22}
              strokeWidth={ringStroke * 4}
            />
            <circle
              r={scaledAvatarRadius}
              fill="rgba(5,12,24,.94)"
              stroke={ring}
              strokeOpacity={0.9}
              strokeWidth={ringStroke}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fill={ring}
              fontSize={scaledAvatarRadius * 0.72}
              fontFamily="'Barlow Condensed', sans-serif"
              fontWeight={700}
              letterSpacing=".04em"
            >
              {initials}
            </text>
          </g>
        </g>
      );
    }
    return (
      <circle
        cx={x}
        cy={y}
        r={fallbackRadius}
        fill={fallbackFill}
        opacity={opacity}
        style={style}
        data-anim={dataAnim}
      />
    );
  }

  const ring = ringColor ?? fallbackFill;
  const scaledAvatarRadius = avatarRadius * FIELD_HEADSHOT_SCALE * sizeMultiplier;
  const clipId = `marker-static-${markerHash(`${markerId}:${x.toFixed(1)}:${y.toFixed(1)}:${resolvedHeadshot}`)}`;
  const imageSize = scaledAvatarRadius * 2;
  const ringStroke = Math.max(0.8, scaledAvatarRadius * 0.07);
  const shadowRx = scaledAvatarRadius * 0.66;
  const shadowRy = Math.max(2.5, scaledAvatarRadius * 0.2);
  const shadowSoftRx = shadowRx * 1.2;
  const shadowSoftRy = shadowRy * 1.5;
  const shadowY = scaledAvatarRadius * 0.92;
  const shadowSoftY = shadowY + shadowRy * 1.05;
  const standStyle: CSSProperties = {
    willChange: 'transform, opacity',
    animation: `markerStandUp 0.3s ease-out ${standupDelay ?? '0s'} both`,
  };
  const uprightTransform = buildHeadshotScreenCompensation(x, y + depthOffsetY);

  return (
    <g
      transform={`translate(${x} ${y + depthOffsetY})`}
      opacity={opacity}
      style={style}
      data-anim={dataAnim}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={0} cy={0} r={scaledAvatarRadius - 0.7} />
        </clipPath>
      </defs>
      <ellipse
        cx={0}
        cy={shadowSoftY}
        rx={shadowSoftRx}
        ry={shadowSoftRy}
        fill="rgba(0,0,0,0.18)"
      />
      <ellipse cx={0} cy={shadowY} rx={shadowRx} ry={shadowRy} fill="rgba(0,0,0,0.36)" />
      <g transform={uprightTransform}>
        <g style={standStyle}>
          {/* Glow bloom behind ring */}
          <circle
            r={scaledAvatarRadius + ringStroke * 0.5}
            fill="none"
            stroke={ring}
            strokeOpacity={0.22}
            strokeWidth={ringStroke * 4}
          />
          <circle
            r={scaledAvatarRadius}
            fill="rgba(5,12,24,.94)"
            stroke={ring}
            strokeOpacity={0.9}
            strokeWidth={ringStroke}
          />
          <image
            href={resolvedHeadshot}
            x={-scaledAvatarRadius}
            y={-scaledAvatarRadius}
            width={imageSize}
            height={imageSize}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </g>
      </g>
    </g>
  );
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

export function PlayAnimation({
  play: rawPlay,
  awayAbbr,
  homeAbbr,
  teamColorsByAbbr,
  hideHeadshots = false,
  hidePenaltyCallout = false,
  hideFgTrail = false,
}: PlayAnimationProps) {
  const play = hideHeadshots ? stripPlayHeadshots(rawPlay) : rawPlay;
  const offenseTeam = play.offenseTeam?.trim().toUpperCase();
  const defenseTeam = resolveDefenseTeam(offenseTeam, awayAbbr, homeAbbr, teamColorsByAbbr);
  const offenseRingColor = resolveTeamRingColor(offenseTeam, teamColorsByAbbr, C.cyan);
  const defenseRingColor = resolveTeamRingColor(defenseTeam, teamColorsByAbbr, C.red);
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

  if (play.isSafety) {
    return <SafetyAnimation fromX={fromX} possIsAway={possIsAway} />;
  }

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
          offenseRingColor={offenseRingColor}
          hidePenaltyCallout={hidePenaltyCallout}
          hideFgTrail={hideFgTrail}
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
          offenseRingColor={offenseRingColor}
          hidePenaltyCallout={hidePenaltyCallout}
          hideFgTrail={hideFgTrail}
        />
      );
    case 'turnover':
      return (
        <TurnoverAnimation
          fromX={fromX}
          turnoverX={turnoverX}
          toX={toX}
          dirY={dirY}
          play={play}
          awayAbbr={awayAbbr}
          offenseRingColor={offenseRingColor}
          defenseRingColor={defenseRingColor}
        />
      );
    case 'kick':
      return (
        <KickAnimation
          fromX={fromX}
          toX={toX}
          play={play}
          awayAbbr={awayAbbr}
          offenseRingColor={offenseRingColor}
          defenseRingColor={defenseRingColor}
          hidePenaltyCallout={hidePenaltyCallout}
        />
      );
    case 'fieldgoal':
      return (
        <FieldGoalAnimation
          fromX={fromX}
          play={play}
          possIsAway={possIsAway}
          offenseRingColor={offenseRingColor}
          hidePenaltyCallout={hidePenaltyCallout}
          hideFgTrail={hideFgTrail}
        />
      );
    default:
      return null;
  }
}

function isTurnoverOnDowns(play: PlayAnimationData): boolean {
  if ((play.startDown ?? 0) !== 4) return false;
  if (play.type !== 'pass' && play.type !== 'rush') return false;
  if (play.isFirstDown || play.isTurnover || play.isTouchdown || play.isNoPlay) return false;
  if (/\b(two-point conversion|extra point)\b/i.test(play.description)) return false;
  return true;
}

function parseFieldSpotToX(
  sideRaw: string | undefined,
  yardRaw: string | undefined,
  awayAbbr: string
): number | null {
  const side = (sideRaw ?? '').trim().toUpperCase();
  const yard = Number.parseInt((yardRaw ?? '').trim(), 10);
  if (!side || Number.isNaN(yard)) return null;
  const clampedYard = Math.max(0, Math.min(50, yard));
  return fieldPctToSvgX(yardToFieldPct(clampedYard, side, awayAbbr));
}

function parseFumbleSpotsToX(
  description: string,
  awayAbbr: string
): {
  takeawayX: number | null;
  recoveryX: number | null;
} {
  const fumbleMatch = description.match(
    /\bfumbles?(?:\s*\([^)]*\))?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i
  );
  const recoveryMatch = description.match(/\brecovered by\s+.+?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i);
  return {
    takeawayX: parseFieldSpotToX(fumbleMatch?.[1], fumbleMatch?.[2], awayAbbr),
    recoveryX: parseFieldSpotToX(recoveryMatch?.[1], recoveryMatch?.[2], awayAbbr),
  };
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
  offenseRingColor,
  hidePenaltyCallout,
  hideFgTrail,
}: {
  fromX: number;
  toX: number;
  penaltyAdjustedX: number | null;
  dirY: number;
  play: PlayAnimationData;
  possIsAway: boolean;
  postScoreTry: PostScoreTryOverlayData | null;
  offenseRingColor: string;
  hidePenaltyCallout: boolean;
  hideFgTrail?: boolean;
}) {
  const isComplete = play.isComplete;
  const text = play.description.toLowerCase();
  const isSack = !isComplete && (text.includes('sack') || play.yardsGained < 0);
  const missLabel = isSack ? 'SACK' : 'INC';
  const passResultColor = isComplete && play.yardsGained >= 0 ? C.green : C.red;
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
  const isPenaltyOnlyNoPlay =
    play.isNoPlay &&
    hasPenalty &&
    !/\b(pass|incomplete|sacked|scramble|rush|up the|left|right|middle)\b/i.test(play.description);
  const penaltyDelay = isPenaltyOnlyNoPlay ? 0.16 : duration + 0.7;
  const penaltyAdjustDir =
    play.penaltyTeam && play.offenseTeam && play.penaltyTeam === play.offenseTeam
      ? -offenseDir
      : offenseDir;
  // No-play (offensive penalty, or DPI on incomplete): enforce from the LOS.
  // Play stands / tack-on (defensive personal foul after a complete pass): from catch point.
  const penaltyBaseX = play.isNoPlay ? fromX : targetX;
  const computedPenaltyAdjustedX = clampX(
    penaltyBaseX + penaltyAdjustDir * (play.penaltyYards ?? 0) * YARDS_TO_PX
  );
  const penaltyEndX = penaltyAdjustedX ?? computedPenaltyAdjustedX;
  if (isPenaltyOnlyNoPlay) {
    return (
      <g>
        <PenaltyAdjustmentOverlay
          fromX={penaltyBaseX}
          toX={penaltyEndX}
          y={FIELD_CENTER_Y}
          delay={penaltyDelay + 0.05}
        />
        {!hidePenaltyCallout && (
          <PenaltyCallout x={penaltyEndX} play={play} delay={penaltyDelay + 0.02} />
        )}
      </g>
    );
  }

  const postTryDelay = duration + 4.85;
  const hasPostTrySequence = Boolean(postScoreTry);
  const showTurnoverOnDowns = isTurnoverOnDowns(play) && !hasPostTrySequence;
  // On TD + XP/2PT plays we intentionally clear primary pass visuals before rendering try.
  const hidePrimaryAt = hasPostTrySequence
    ? Math.max(duration + 0.6, postTryDelay - 0.35)
    : undefined;
  const primaryFadeOutDelay =
    hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;
  const passLateralSign = targetX >= fromX ? 1 : -1;
  const cardSide: 'left' | 'right' = targetX >= fromX ? 'right' : 'left';
  const _qbCardSide: 'left' | 'right' = targetX >= fromX ? 'left' : 'right';
  const qbReleaseHeadshot = normalizeHeadshotUrl(play.qbActor?.headshotUrl);
  const sackTravelHeadshot = isSack ? qbReleaseHeadshot : undefined;
  const receiverEndHeadshot =
    isComplete &&
    !isSack &&
    play.actor?.name &&
    !samePlayerName(play.actor.name, play.qbActor?.name)
      ? normalizeHeadshotUrl(play.actor?.headshotUrl)
      : undefined;
  const qbReleaseStyle =
    hidePrimaryAt == null
      ? { opacity: 0, animation: 'fadeIn 0.14s ease 0s forwards' }
      : {
          opacity: 0,
          animation: `fadeIn 0.14s ease 0s forwards, fadeOut 0.2s ease ${Math.max(hidePrimaryAt - 0.08, 0.36)}s forwards`,
        };
  const receiverEndStyle =
    primaryFadeOutDelay == null
      ? { opacity: 0, animation: `fadeIn 0.22s ease ${duration + 0.04}s forwards` }
      : {
          opacity: 0,
          animation: `fadeIn 0.22s ease ${duration + 0.04}s forwards, fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards`,
        };
  const qbHeadshotX = clampX(fromX - passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X);
  const receiverHeadshotX = clampX(
    targetX + passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X
  );
  return (
    <g>
      {hasPostTrySequence && <PreTrySnapGuide x={fromX} hideAt={hidePrimaryAt} />}
      {play.isFirstDown && !hasPostTrySequence && <FirstDownMarker x={toX} />}
      {showTurnoverOnDowns && <TurnoverOnDownsMarker x={toX} />}
      {qbReleaseHeadshot && !isSack && (
        <StaticHeadshotMarker
          markerId="pass-qb-release"
          x={qbHeadshotX}
          y={FIELD_CENTER_Y}
          headshotUrl={qbReleaseHeadshot}
          fallbackRadius={3.4}
          fallbackFill={C.amber}
          ringColor={offenseRingColor}
          style={qbReleaseStyle}
          dataAnim="pass-qb-release-marker"
          depthOffsetY={FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
        />
      )}
      {receiverEndHeadshot && (
        <StaticHeadshotMarker
          markerId="pass-end-receiver"
          x={receiverHeadshotX}
          y={targetY}
          headshotUrl={receiverEndHeadshot}
          fallbackRadius={4.6}
          fallbackFill={C.cyan}
          ringColor={offenseRingColor}
          avatarRadius={6.4}
          style={receiverEndStyle}
          dataAnim="pass-end-headshot"
          depthOffsetY={FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
        />
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
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${duration}s`}
          fill="freeze"
        />
      </path>
      <MovingHeadshotMarker
        markerId="pass-main"
        path={pathD}
        duration={`${duration}s`}
        headshotUrl={sackTravelHeadshot}
        fallbackRadius={3.6}
        fallbackFill={trailColor}
        ringColor={offenseRingColor}
        avatarRadius={6.2}
        depthOffsetY={isSack ? FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y : undefined}
        sizeMultiplier={isSack ? FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER : 1}
        style={
          primaryFadeOutDelay == null
            ? undefined
            : { animation: `fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards` }
        }
        dataAnim="pass-main-marker"
      />

      {/* End flash */}
      <circle
        cx={targetX}
        cy={targetY}
        r={4}
        fill="none"
        stroke={passResultColor}
        strokeWidth={2}
        data-anim="pass-end-flash"
        style={{
          animation: `catchFlash 0.6s ease ${duration + 0.02}s forwards`,
          opacity: 0,
        }}
      />
      {isSack && !sackTravelHeadshot && (
        <circle
          cx={targetX}
          cy={targetY}
          r={4.4}
          fill={C.red}
          opacity={0}
          visibility="hidden"
          data-anim="pass-end-dot"
        >
          <set
            attributeName="visibility"
            to="visible"
            begin={`${duration + 0.04}s`}
            fill="freeze"
          />
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
      {isComplete && !receiverEndHeadshot && (
        <circle
          cx={targetX}
          cy={targetY}
          r={4.6}
          fill={C.cyan}
          opacity={0}
          visibility="hidden"
          data-anim="pass-end-dot"
        >
          <set
            attributeName="visibility"
            to="visible"
            begin={`${duration + 0.04}s`}
            fill="freeze"
          />
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
        fill={passResultColor}
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
            fromX={penaltyBaseX}
            toX={penaltyEndX}
            y={play.isNoPlay ? FIELD_CENTER_Y : targetY}
            delay={penaltyDelay + 0.05}
          />
          {!hidePenaltyCallout && (
            <PenaltyCallout x={penaltyEndX} play={play} delay={penaltyDelay + 0.02} />
          )}
        </>
      )}
      {postScoreTry && (
        <PostScoreAttemptOverlay
          data={postScoreTry}
          delay={postTryDelay}
          fallbackSide={cardSide}
          offenseRingColor={offenseRingColor}
          hideFgTrail={hideFgTrail}
        />
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
  offenseRingColor,
  hidePenaltyCallout,
  hideFgTrail,
}: {
  fromX: number;
  toX: number;
  penaltyAdjustedX: number | null;
  dirY: number;
  play: PlayAnimationData;
  possIsAway: boolean;
  postScoreTry: PostScoreTryOverlayData | null;
  offenseRingColor: string;
  hidePenaltyCallout: boolean;
  hideFgTrail?: boolean;
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
  // No-play (e.g. offensive holding): enforce from snap/LOS so arrow starts at
  // the original line of scrimmage. Tack-on (e.g. defensive personal foul after
  // the run): enforce from the run end spot.
  const penaltyBaseX = play.isNoPlay ? fromX : touchdownTargetX;
  const computedPenaltyAdjustedX = clampX(
    penaltyBaseX + penaltyAdjustDir * (play.penaltyYards ?? 0) * YARDS_TO_PX
  );
  const penaltyEndX = penaltyAdjustedX ?? computedPenaltyAdjustedX;
  const penaltyDelay = duration + 0.12;
  const postTryDelay = duration + 4.85;
  const hasPostTrySequence = Boolean(postScoreTry);
  const showTurnoverOnDowns = isTurnoverOnDowns(play) && !hasPostTrySequence;
  const hidePrimaryAt = hasPostTrySequence
    ? Math.max(duration + 0.6, postTryDelay - 0.35)
    : undefined;
  const primaryFadeOutDelay =
    hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;
  const hasRushHeadshot = Boolean(normalizeHeadshotUrl(play.actor?.headshotUrl));

  const bend = play.direction === 'left' ? -34 : play.direction === 'right' ? 34 : 12;
  const c1X = fromX + (touchdownTargetX - fromX) * 0.35;
  const c2X = fromX + (touchdownTargetX - fromX) * 0.72;
  const c1Y = FIELD_CENTER_Y + bend;
  const c2Y = dirY + bend * 0.35;
  const pathD = `M ${fromX},${FIELD_CENTER_Y} C ${c1X},${c1Y} ${c2X},${c2Y} ${touchdownTargetX},${dirY}`;
  const cardSide: 'left' | 'right' = touchdownTargetX >= fromX ? 'right' : 'left';
  const rushDistancePx = Math.abs(touchdownTargetX - fromX);
  const shortRushFactor = Math.max(
    0,
    Math.min(1, 1 - rushDistancePx / SHORT_RUSH_DEPTH_DISTANCE_PX)
  );
  const rushHeadshotDepthOffsetY =
    FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y -
    Math.round(shortRushFactor * SHORT_RUSH_MAX_EXTRA_DEPTH_Y);
  const rushYardsColor = play.yardsGained < 0 ? C.red : C.cyan;
  return (
    <g>
      {hasPostTrySequence && <PreTrySnapGuide x={fromX} hideAt={hidePrimaryAt} />}
      {play.isFirstDown && !hasPostTrySequence && <FirstDownMarker x={touchdownTargetX} />}
      {showTurnoverOnDowns && <TurnoverOnDownsMarker x={touchdownTargetX} />}

      {/* Moving runner marker */}
      {hasRushHeadshot && (
        <MovingHeadshotMarker
          markerId="rush-main"
          path={pathD}
          duration={`${duration}s`}
          headshotUrl={play.actor?.headshotUrl}
          fallbackRadius={4.2}
          fallbackFill={C.cyan}
          ringColor={offenseRingColor}
          avatarRadius={6.4}
          depthOffsetY={rushHeadshotDepthOffsetY}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          style={{
            filter: `drop-shadow(0 0 6px ${C.cyanGlow})`,
            ...(primaryFadeOutDelay == null
              ? {}
              : { animation: `fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards` }),
          }}
        />
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
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${duration}s`}
          fill="freeze"
        />
      </path>
      {!hasRushHeadshot && (
        <MovingHeadshotMarker
          markerId="rush-main"
          path={pathD}
          duration={`${duration}s`}
          headshotUrl={play.actor?.headshotUrl}
          fallbackRadius={4.2}
          fallbackFill={C.cyan}
          ringColor={offenseRingColor}
          avatarRadius={6.4}
          style={{
            filter: `drop-shadow(0 0 6px ${C.cyanGlow})`,
            ...(primaryFadeOutDelay == null
              ? {}
              : { animation: `fadeOut 0.2s ease ${primaryFadeOutDelay}s forwards` }),
          }}
        />
      )}

      {/* End marker glow */}
      {!hasRushHeadshot && (
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
      )}

      {/* Yards label */}
      <text
        x={touchdownTargetX}
        y={dirY - 12}
        textAnchor="middle"
        fill={rushYardsColor}
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
            fromX={penaltyBaseX}
            toX={penaltyEndX}
            y={play.isNoPlay ? FIELD_CENTER_Y : dirY}
            delay={penaltyDelay + 0.05}
          />
          {!hidePenaltyCallout && (
            <PenaltyCallout x={penaltyEndX} play={play} delay={penaltyDelay + 0.03} />
          )}
        </>
      )}
      {postScoreTry && (
        <PostScoreAttemptOverlay
          data={postScoreTry}
          delay={postTryDelay}
          fallbackSide={cardSide}
          offenseRingColor={offenseRingColor}
          hideFgTrail={hideFgTrail}
        />
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
        opacity={0}
        strokeDasharray="6 4"
        style={{ animation: `fadeIn 0.28s ease ${delay + 0.04}s forwards` }}
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
  fallbackSide: _fallbackSide,
  offenseRingColor,
  hideFgTrail = false,
}: {
  data: PostScoreTryOverlayData;
  delay: number;
  fallbackSide: 'left' | 'right';
  offenseRingColor: string;
  hideFgTrail?: boolean;
}) {
  const hideKickTrail = hideFgTrail && data.playType === 'kick';
  const travelRight = data.toX >= data.fromX;
  const { uprightX } = getFgEndpoints(travelRight);
  const endX = data.playType === 'kick' ? uprightX : data.toX;
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
  const endY = isPassLike
    ? directionY
    : data.playType === 'kick' && data.isGood
      ? FG_PORTAL_CENTER_Y
      : FIELD_CENTER_Y;
  const peakY = FIELD_CENTER_Y - (data.playType === 'kick' ? (data.isGood ? 200 : 110) : 72);
  const pathD = isRushLike
    ? `M ${data.fromX},${FIELD_CENTER_Y} C ${data.fromX + (endX - data.fromX) * 0.32},${directionY} ${data.fromX + (endX - data.fromX) * 0.7},${directionY * 0.7 + FIELD_CENTER_Y * 0.3} ${endX},${endY}`
    : `M ${data.fromX},${FIELD_CENTER_Y} Q ${(data.fromX + endX) / 2},${peakY} ${endX},${endY}`;
  const showTryLosLabel = data.kind !== 'extra_point';
  const losLabel = data.kind === 'two_point' ? '2PT TRY' : 'XP TRY';
  const resultLabel =
    data.kind === 'two_point'
      ? data.isGood
        ? '2PT GOOD'
        : '2PT NO GOOD'
      : data.isGood
        ? 'XP GOOD'
        : 'XP NO GOOD';
  const trailHeadshot =
    data.playType === 'rush' ? data.actor?.headshotUrl || data.qbActor?.headshotUrl : undefined;

  return (
    <g
      style={{
        opacity: 0,
        animation: `fadeIn 0.02s linear ${Math.max(delay - 0.02, 0)}s forwards`,
      }}
    >
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
      {showTryLosLabel && (
        <>
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
        </>
      )}

      {/* Arc trail + ball — suppressed for kicks when overlay handles it */}
      {!hideKickTrail && (
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
      )}
      {!hideKickTrail && (
        <MovingHeadshotMarker
          markerId={`post-try-${data.playType}`}
          path={pathD}
          duration={`${attemptDuration}s`}
          begin={`${delay + 0.08}s`}
          headshotUrl={trailHeadshot}
          fallbackRadius={3.8}
          fallbackFill={traceColor}
          ringColor={offenseRingColor}
          avatarRadius={6}
          depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          hiddenUntilBegin
        />
      )}
      {/* Kicker circle — suppressed for kicks when overlay renders it as a perfect circle */}
      {data.playType === 'kick' && data.actor?.name && !hideKickTrail && (
        <StaticHeadshotMarker
          markerId="post-score-kick-kicker"
          x={data.fromX}
          y={FIELD_CENTER_Y}
          headshotUrl={data.actor.headshotUrl}
          playerName={data.actor.name}
          fallbackRadius={3.8}
          fallbackFill={C.amber}
          ringColor={offenseRingColor}
          avatarRadius={6.3}
          depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          style={{ opacity: 0, animation: `fadeIn 0.16s ease ${delay}s forwards` }}
          dataAnim="post-score-kick-headshot"
        />
      )}

      {/* Result indicators — suppressed for kicks (overlay arc handles good/miss visually) */}
      {!hideKickTrail && !data.isGood && (
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
      {!hideKickTrail && (
        <circle
          cx={endX}
          cy={endY}
          r={4.8}
          fill={resultColor}
          opacity={0}
          style={{ animation: `fadeIn 0.2s ease ${delay + attemptDuration + 0.02}s forwards` }}
        />
      )}
      {!hideKickTrail && (
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
  awayAbbr,
  offenseRingColor,
  defenseRingColor,
}: {
  fromX: number;
  turnoverX: number;
  toX: number;
  dirY: number;
  play: PlayAnimationData;
  awayAbbr: string;
  offenseRingColor: string;
  defenseRingColor: string;
}) {
  const text = play.description.toLowerCase();
  const isInterception = text.includes('intercept');
  const isFumble = /\bfumble(?:s|d)?\b/i.test(text);
  const parsedFumbleSpots = isFumble ? parseFumbleSpotsToX(play.description, awayAbbr) : null;
  const resolvedTurnoverX = parsedFumbleSpots?.takeawayX ?? turnoverX;
  const resolvedToX = parsedFumbleSpots?.recoveryX ?? toX;
  const isFumbleRecoverySwap =
    isFumble &&
    !isInterception &&
    /\brecovered by\b/i.test(text) &&
    !/\bfor\s+\d+\s+yards?\b/i.test(text) &&
    !/\btouchdown\b/i.test(text);
  const hasReturn = isFumbleRecoverySwap
    ? Math.abs(resolvedToX - resolvedTurnoverX) > 0.5
    : Math.abs(resolvedToX - resolvedTurnoverX) > 2;
  const totalDuration = Math.max(ANIM_TIMING.turnover * 2, 1.65);
  const firstDuration = totalDuration * 0.52;
  const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
  const turnoverLabelDelay = firstDuration + 0.08;
  const returnStartDelay = firstDuration + 0.22;
  const _actorDelay = hasReturn
    ? returnStartDelay + returnDuration + 0.08
    : turnoverLabelDelay + 0.14;
  const turnoverY = isInterception ? dirY : FIELD_CENTER_Y;
  const firstTargetX = resolvedTurnoverX;
  const firstTargetY = isInterception ? turnoverY : FIELD_CENTER_Y;
  const firstPath = isInterception
    ? `M ${fromX},${FIELD_CENTER_Y} Q ${(fromX + firstTargetX) / 2},${Math.min(FIELD_CENTER_Y, turnoverY) - Math.max(36, Math.min(128, Math.abs(firstTargetX - fromX) * 0.32))} ${firstTargetX},${turnoverY}`
    : isFumbleRecoverySwap
      ? `M ${fromX},${FIELD_CENTER_Y} L ${firstTargetX},${firstTargetY}`
      : `M ${fromX},${FIELD_CENTER_Y} Q ${(fromX + firstTargetX) / 2},${FIELD_CENTER_Y - 20} ${firstTargetX},${firstTargetY}`;
  const returnStartX = resolvedTurnoverX;
  const returnEndX = resolvedToX;
  const returnStartY = turnoverY;
  const returnEndY = FIELD_CENTER_Y;
  const returnPath = isFumbleRecoverySwap
    ? `M ${returnStartX},${returnStartY} L ${returnEndX},${returnEndY}`
    : `M ${returnStartX},${returnStartY} Q ${(returnStartX + returnEndX) / 2},${FIELD_CENTER_Y + (returnEndX > returnStartX ? 36 : -36)} ${returnEndX},${returnEndY}`;
  const firstColor = C.cyan;
  const takeoverHeadshot = isInterception
    ? play.qbActor?.headshotUrl || play.actor?.headshotUrl
    : play.actor?.headshotUrl;

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
        strokeWidth={isFumbleRecoverySwap ? 2.8 : 2.1}
        opacity={isFumbleRecoverySwap ? 0.8 : 0.58}
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
      <MovingHeadshotMarker
        markerId="turnover-takeaway"
        path={firstPath}
        duration={`${firstDuration}s`}
        headshotUrl={takeoverHeadshot}
        fallbackRadius={3.8}
        fallbackFill={firstColor}
        ringColor={isInterception ? defenseRingColor : offenseRingColor}
        avatarRadius={6.2}
        depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
        sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
      />

      {/* Takeaway marker */}
      <circle
        cx={resolvedTurnoverX}
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
            strokeWidth={isFumbleRecoverySwap ? 2.8 : 2.3}
            opacity={0}
            strokeDasharray={isFumbleRecoverySwap ? undefined : '5 4'}
            strokeDashoffset="1000"
            style={{
              animation: [
                `fadeIn 0.08s linear ${returnStartDelay}s forwards`,
                `trailDraw ${returnDuration}s ease ${returnStartDelay}s forwards`,
              ].join(', '),
            }}
          />
          <MovingHeadshotMarker
            markerId="turnover-return"
            path={returnPath}
            duration={`${returnDuration}s`}
            begin={`${returnStartDelay}s`}
            headshotUrl={play.actor?.headshotUrl}
            fallbackRadius={4}
            fallbackFill={C.red}
            ringColor={defenseRingColor}
            avatarRadius={6.3}
            depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
            sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
            opacity={0}
            hiddenUntilBegin
            style={{
              filter: `drop-shadow(0 0 6px rgba(255,59,79,0.6))`,
              animation: `fadeIn 0.08s linear ${returnStartDelay}s forwards`,
            }}
          />
          <circle
            cx={returnEndX}
            cy={returnEndY}
            r={4.6}
            fill={C.red}
            opacity={0}
            style={{
              animation: `fadeIn 0.22s ease ${returnStartDelay + returnDuration}s forwards`,
            }}
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
            x={resolvedTurnoverX}
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
          x={resolvedTurnoverX}
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
    </g>
  );
}

// ── Kick / Return ─────────────────────────────────────────────

function parseKickDistanceYards(description: string): number | null {
  const match = description.match(/\b(?:punts?|kicks?)\s+(\d+)\s+yards?\b/i);
  if (!match?.[1]) return null;
  const yards = Number.parseInt(match[1], 10);
  return Number.isNaN(yards) ? null : yards;
}

/**
 * Handles kickoff and punt trajectories + optional return leg.
 */
function KickAnimation({
  fromX,
  toX,
  play,
  awayAbbr,
  offenseRingColor,
  defenseRingColor,
  hidePenaltyCallout,
}: {
  fromX: number;
  toX: number;
  play: PlayAnimationData;
  awayAbbr: string;
  offenseRingColor: string;
  defenseRingColor: string;
  hidePenaltyCallout: boolean;
}) {
  const totalDuration = ANIM_TIMING.kick * 0.74;
  const landingX =
    play.kickLandingSide && typeof play.kickLandingYardline === 'number'
      ? fieldPctToSvgX(yardToFieldPct(play.kickLandingYardline, play.kickLandingSide, awayAbbr))
      : toX;
  const _isPunt = /\bpunts?\b/i.test(play.description);
  const hasReturn = Math.abs(toX - landingX) > 2;
  const isTouchback = /touchback/i.test(play.description);
  const kickOutOfBounds = /\bout of bounds\b/i.test(play.description);
  const returnOutOfBounds = /\b(?:ran|pushed)\s+ob\b/i.test(play.description);
  const hasReturnActor = Boolean(play.actor?.name);
  const hasReturnRunner = hasReturn && hasReturnActor;
  const endzoneHalfwayX =
    landingX <= fromX ? (AWAY_EZ_LEFT + AWAY_EZ_RIGHT) / 2 : (HOME_EZ_LEFT + HOME_EZ_RIGHT) / 2;
  const landingVisualX = isTouchback && !hasReturnRunner ? endzoneHalfwayX : landingX;
  const showStaticReturnerAtLanding = !hasReturn && hasReturnActor;
  const kickDuration = hasReturn ? totalDuration * 0.62 : totalDuration;
  const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
  const kickMidX = (fromX + landingVisualX) / 2;
  const landingY = kickOutOfBounds && !hasReturnRunner ? FIELD_TOP - 8 : FIELD_CENTER_Y;
  const kickPeakY =
    kickOutOfBounds && !hasReturnRunner ? FIELD_CENTER_Y - 140 : FIELD_CENTER_Y - 120;
  const kickArcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${kickMidX},${kickPeakY} ${landingVisualX},${landingY}`;
  const returnEndY = returnOutOfBounds ? FIELD_TOP - 8 : FIELD_CENTER_Y;
  const returnCurveY = returnEndY + (toX > landingVisualX ? 34 : -34);
  const returnPath =
    isTouchback && !hasReturnRunner
      ? `M ${landingVisualX},${landingY} L ${toX},${FIELD_CENTER_Y}`
      : `M ${landingVisualX},${landingY} Q ${(landingVisualX + toX) / 2},${returnCurveY} ${toX},${returnEndY}`;
  const finishColor = hasReturnRunner ? C.amber : C.cyan;
  const finishY = hasReturn ? returnEndY : landingY;
  const kickerHeadshot = normalizeHeadshotUrl(play.qbActor?.headshotUrl);
  const returnerHeadshot = normalizeHeadshotUrl(play.actor?.headshotUrl);
  const puntDistanceYards =
    parseKickDistanceYards(play.description) ??
    Math.round(Math.abs(landingX - fromX) / YARDS_TO_PX);
  const _punterSummary = puntDistanceYards > 0 ? `${puntDistanceYards} Yard Punt` : 'Punt';
  const _punterStatsLine =
    (play.qbActor?.lines ?? []).find((line) => /\bpunts?\b/i.test(line)) ??
    (/\bpunts?\b/i.test(play.qbActor?.line ?? '') ? play.qbActor?.line : undefined) ??
    '1 Punt';
  const resultLabelY =
    kickOutOfBounds && !hasReturn ? Math.max(FIELD_TOP + 12, landingY + 14) : finishY + 18;
  const hasPenalty = Boolean((play.penaltyYards ?? 0) > 0 || play.penaltyType);

  return (
    <g>
      {hasPenalty && !hidePenaltyCallout && <PenaltyCallout x={fromX} play={play} delay={0.1} />}
      {kickerHeadshot && (
        <StaticHeadshotMarker
          markerId="kick-start-kicker"
          x={fromX}
          y={FIELD_CENTER_Y}
          headshotUrl={kickerHeadshot}
          fallbackRadius={3.6}
          fallbackFill={C.amber}
          ringColor={offenseRingColor}
          avatarRadius={6.3}
          depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          style={{ opacity: 0, animation: 'fadeIn 0.16s ease 0s forwards' }}
          dataAnim="kick-start-headshot"
        />
      )}
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

      <MovingHeadshotMarker
        markerId="kick-main"
        path={kickArcPath}
        duration={`${kickDuration}s`}
        headshotUrl={undefined}
        fallbackRadius={3.5}
        fallbackFill={C.cyan}
        ringColor={C.cyan}
        avatarRadius={5.9}
      />

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
            <MovingHeadshotMarker
              markerId="kick-return-runner"
              path={returnPath}
              duration={`${returnDuration}s`}
              begin={`${kickDuration}s`}
              headshotUrl={play.actor?.headshotUrl}
              fallbackRadius={4.2}
              fallbackFill={C.amber}
              ringColor={defenseRingColor}
              avatarRadius={6.4}
              depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
              sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
              opacity={0.96}
              hiddenUntilBegin
              hideFallbackUntilBegin
              dataAnim="kick-return-runner"
              style={{
                filter: `drop-shadow(0 0 6px ${C.amberGlow})`,
              }}
            />
          )}
        </>
      )}

      {showStaticReturnerAtLanding && (
        <StaticHeadshotMarker
          markerId="kick-return-static"
          x={landingVisualX}
          y={landingY}
          headshotUrl={returnerHeadshot}
          fallbackRadius={4.2}
          fallbackFill={C.amber}
          ringColor={defenseRingColor}
          avatarRadius={6.4}
          depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          dataAnim="kick-return-static-headshot"
          style={{
            opacity: 0,
            filter: `drop-shadow(0 0 6px ${C.amberGlow})`,
            animation: `fadeIn 0.24s ease ${kickDuration + 0.04}s forwards`,
          }}
          standupDelay={`${kickDuration + 0.04}s`}
        />
      )}

      {!showStaticReturnerAtLanding && (
        <circle
          cx={landingX}
          cy={landingY}
          r={hasReturn ? 3.2 : 5}
          fill={C.cyan}
          opacity={0}
          visibility="hidden"
          data-anim="kick-landing-dot"
        >
          <set
            attributeName="visibility"
            to="visible"
            begin={`${kickDuration + 0.04}s`}
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            begin={`${kickDuration + 0.04}s`}
            dur="0.25s"
            from="0"
            to="1"
            fill="freeze"
          />
        </circle>
      )}

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
  offenseRingColor,
  hidePenaltyCallout,
  hideFgTrail = false,
}: {
  fromX: number;
  play: PlayAnimationData;
  possIsAway: boolean;
  offenseRingColor: string;
  hidePenaltyCallout: boolean;
  hideFgTrail?: boolean;
}) {
  const { goalLineX, uprightX } = getFgEndpoints(possIsAway);
  const isMade = play.fgResult === 'made';
  const isShort = play.fgResult === 'short';
  const endX = isShort ? goalLineX : uprightX;
  const duration = ANIM_TIMING.fieldgoal;
  const durationFast = duration * 0.74;

  // Veer offset for wide kicks — must land outside the upright gate (±FG_UPRIGHT_Y_HALF)
  const wideMissOffset = FG_UPRIGHT_Y_HALF + 25;
  let endY = FIELD_CENTER_Y;
  if (isMade) endY = FG_PORTAL_CENTER_Y;
  else if (play.fgResult === 'wide_left') endY = FIELD_CENTER_Y - wideMissOffset;
  else if (play.fgResult === 'wide_right') endY = FIELD_CENTER_Y + wideMissOffset;

  const trailColor = isMade ? C.green : C.red;
  const _cardSide: 'left' | 'right' = possIsAway ? 'left' : 'right';
  const hasPenalty = Boolean((play.penaltyYards ?? 0) > 0 || play.penaltyType);

  return (
    <g>
      {hasPenalty && !hidePenaltyCallout && <PenaltyCallout x={fromX} play={play} delay={0.1} />}
      {/* Kicker circle rendered by overlay when hideFgTrail; fallback here for standalone use */}
      {!hideFgTrail && play.actor?.name && (
        <StaticHeadshotMarker
          markerId="fieldgoal-start-kicker"
          x={fromX}
          y={FIELD_CENTER_Y}
          headshotUrl={normalizeHeadshotUrl(play.actor.headshotUrl) || undefined}
          playerName={play.actor.name}
          fallbackRadius={3.8}
          fallbackFill={C.amber}
          ringColor={offenseRingColor}
          avatarRadius={6.3}
          depthOffsetY={FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y}
          sizeMultiplier={FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER}
          style={{ opacity: 0, animation: 'fadeIn 0.16s ease 0s forwards' }}
          dataAnim="fieldgoal-start-headshot"
        />
      )}
      {/* Arc trail + ball rendered by OverlayFgArc in FieldVisualization when hideFgTrail */}
      {!hideFgTrail &&
        (() => {
          const midX = (fromX + endX) / 2;
          // FG/XP should be nearly straight — barely any arc compared to a punt.
          const arcHeight = isMade ? 28 : 20;
          const arcPath = `M ${fromX},${FIELD_CENTER_Y} Q ${midX},${FIELD_CENTER_Y - arcHeight} ${endX},${endY}`;
          return (
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
          );
        })()}

      {/* Landing dot — only for misses; made FGs land in portal (overlay handles it) */}
      {!isMade && (
        <circle
          cx={endX}
          cy={endY}
          r={5}
          fill={trailColor}
          opacity={0}
          style={{ animation: `fadeIn 0.3s ease ${durationFast}s forwards` }}
        />
      )}
    </g>
  );
}

function PreTrySnapGuide({ x, hideAt }: { x: number; hideAt?: number }) {
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
        <circle
          cx={x}
          cy={FIELD_CENTER_Y}
          r="12"
          fill="none"
          stroke={C.amber}
          strokeWidth="1.4"
          opacity=".34"
        />
        <circle cx={x} cy={FIELD_CENTER_Y} r="7" fill={C.amber} filter="url(#gf)" opacity=".9" />
        <circle cx={x} cy={FIELD_CENTER_Y} r="2.4" fill="#fff" opacity=".82" />
      </g>
    </g>
  );
}

function PenaltyCallout({
  x,
  play,
  delay = 0,
}: {
  x: number;
  play: PlayAnimationData;
  delay?: number;
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
  const boxX = Math.max(FIELD_LEFT + 4, Math.min(FIELD_RIGHT - width - 4, x - width / 2));
  const boxY = FIELD_TOP - height - 2;
  const standupStyle: CSSProperties = {
    willChange: 'transform, opacity',
    animation: `labelErect 0.28s ease-out ${delay}s both`,
  };

  return (
    <g style={{ opacity: 0, animation: `fadeIn 0.16s ease ${delay}s forwards` }}>
      {/* Drop shadow ellipses anchored at field top edge */}
      <ellipse
        cx={x}
        cy={FIELD_TOP + 9}
        rx={Math.max(80, width * 0.31)}
        ry={8}
        fill="rgba(0,0,0,0.30)"
      />
      <ellipse
        cx={x}
        cy={FIELD_TOP + 12}
        rx={Math.max(96, width * 0.38)}
        ry={11}
        fill="rgba(0,0,0,0.16)"
      />
      <g style={standupStyle}>
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

function _buildNumericSwapPlan(previousLine: string, nextLine: string): NumericSwapPlan | null {
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

// ── Turnover on Downs Marker ───────────────────────────────────

function TurnoverOnDownsMarker({ x }: { x: number }) {
  const delay = ANIM_TIMING.firstDownDelay;

  return (
    <g>
      {/* Red pulsing line at the spot where possession changes */}
      <line
        x1={x}
        y1={FIELD_TOP}
        x2={x}
        y2={FIELD_BOTTOM}
        stroke={C.red}
        strokeWidth={3}
        opacity={0.6}
        style={{ animation: `firstDownPulse 1.2s ease ${delay}s infinite` }}
      />
    </g>
  );
}

// ── First Down Marker ─────────────────────────────────────────

function FirstDownMarker({ x }: { x: number }) {
  const badgeWidth = 136;
  const badgeHeight = 28;
  // Badge sits below the field (near/closer sideline) so it isn't covered by headshots
  const badgeY = FIELD_BOTTOM + 4;

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
        style={{ animation: `firstDownPulse 1.2s ease ${ANIM_TIMING.firstDownDelay}s infinite` }}
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

      {/* 1ST DOWN badge — near/bottom sideline, slides up from below */}
      <g
        style={{
          opacity: 0,
          animation: `slideUp 0.3s ease ${ANIM_TIMING.firstDownDelay + 0.3}s forwards`,
        }}
      >
        <rect
          x={x - badgeWidth / 2}
          y={badgeY}
          width={badgeWidth}
          height={badgeHeight}
          rx={2}
          fill={C.green}
          opacity={0.9}
        />
        <text
          x={x}
          y={badgeY + 19}
          textAnchor="middle"
          fill={C.bg}
          fontSize={16}
          fontFamily={F.display}
          fontWeight={800}
        >
          1ST DOWN
        </text>
      </g>
    </g>
  );
}

/** Safety: ball draws backward to the endzone goal line, pulsing red line + SAFETY badge. */
function SafetyAnimation({ fromX, possIsAway }: { fromX: number; possIsAway: boolean }) {
  // The goal line of the tackled team's own endzone
  const goalLineX = possIsAway ? AWAY_EZ_RIGHT : HOME_EZ_LEFT;
  const trailDur = 0.72;
  const lineFadeDelay = trailDur - 0.12;
  const badgeDelay = lineFadeDelay + 0.32;
  const pathD = `M ${fromX},${FIELD_CENTER_Y} L ${goalLineX},${FIELD_CENTER_Y}`;

  // Badge position: just inside the endzone, toward field center
  const badgeW = 80;
  const badgeH = 22;
  const badgeX = possIsAway ? goalLineX + 6 : goalLineX - badgeW - 6;
  const badgeY = FIELD_TOP - badgeH - 6;

  return (
    <g>
      {/* Red trail drawing backward from LOS to goal line */}
      <path
        d={pathD}
        fill="none"
        stroke={C.red}
        strokeWidth={2.5}
        strokeDasharray="1"
        pathLength={1}
        strokeDashoffset={1}
        opacity={0.82}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          dur={`${trailDur}s`}
          fill="freeze"
        />
      </path>
      {/* Dot at the tackle/safety spot */}
      <circle cx={goalLineX} cy={FIELD_CENTER_Y} r={5} fill={C.red} opacity={0}>
        <animate
          attributeName="opacity"
          from="0"
          to="1"
          begin={`${trailDur - 0.05}s`}
          dur="0.16s"
          fill="freeze"
        />
      </circle>
      {/* Pulsing vertical red safety line at the goal line */}
      <line
        x1={goalLineX}
        y1={FIELD_TOP}
        x2={goalLineX}
        y2={FIELD_BOTTOM}
        stroke={C.red}
        strokeWidth={2.5}
        strokeDasharray="8 5"
        opacity={0}
        style={{ animation: `fadeIn 0.22s ease ${lineFadeDelay}s forwards` }}
      >
        <animate
          attributeName="strokeOpacity"
          values="0.85;0.28;0.85"
          dur="1.1s"
          begin={`${lineFadeDelay + 0.24}s`}
          repeatCount="indefinite"
        />
      </line>
      {/* SAFETY badge */}
      <g style={{ opacity: 0, animation: `fadeIn 0.2s ease ${badgeDelay}s forwards` }}>
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeW}
          height={badgeH}
          rx={2}
          fill="rgba(5,10,20,.93)"
          stroke={C.red}
          strokeWidth={1.2}
          strokeOpacity={0.85}
        />
        <text
          x={badgeX + badgeW / 2}
          y={badgeY + badgeH / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={C.red}
          fontSize={10}
          fontFamily={F.mono}
          fontWeight={700}
          letterSpacing="0.12em"
        >
          SAFETY
        </text>
      </g>
    </g>
  );
}
