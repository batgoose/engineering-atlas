'use client';

/**
 * 3D field canvas + static overlays (LOS/first-down/drive-start/timeout banner).
 *
 * Animation sequencing lives in `PlayAnimation`; this component only decides
 * which persistent guides should render at the current replay frame.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  HudTeam,
  Situation,
  PlayAnimationData,
  WeatherState,
  DriveProgress,
  FgResult,
  PlayActorInfo,
} from '@atlas/sdk/gridstream/types';
import { yardToFieldPct } from '@atlas/sdk/gridstream/transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { ANIM_TIMING } from '@atlas/sdk/gridstream/animations';
import {
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FIELD_BOTTOM,
  FIELD_CENTER_Y,
  FG_UPRIGHT_Y_HALF,
  FG_PORTAL_CENTER_Y,
  FIELD_PERSPECTIVE,
  YARD_LINE_POSITIONS,
  fieldPctToSvgX,
  getFgEndpoints,
} from '@atlas/sdk/gridstream/field';
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
  onHeadshotClick?: (actor: PlayActorInfo) => void;
}

const FIELD_HEADSHOT_SCALE = 3;
const FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y = -48;
const FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y = -40;
const FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER = 2;
const FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X = 56;
const SHORT_RUSH_DEPTH_DISTANCE_PX = 110;
const SHORT_RUSH_MAX_EXTRA_DEPTH_Y = 8;
const YARDS_TO_PX = 7.36;

const FIELD_PERSPECTIVE_PX = Number.parseFloat(FIELD_PERSPECTIVE.perspective) || 800;
const FIELD_TILT_DEGREES =
  Number.parseFloat(FIELD_PERSPECTIVE.transform.match(/rotateX\(([-\d.]+)deg\)/)?.[1] ?? '') || 32;
const FIELD_TILT_RAD = (FIELD_TILT_DEGREES * Math.PI) / 180;
const FIELD_PERSPECTIVE_ORIGIN_X = 500;
const FIELD_PERSPECTIVE_ORIGIN_Y = 420;

function clampFieldX(value: number): number {
  return Math.max(50, Math.min(950, value));
}

function markerHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function normalizeHeadshotUrl(url?: string): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

function samePlayerName(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const leftKey = left.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rightKey = right.toLowerCase().replace(/[^a-z0-9]/g, '');
  return leftKey.length > 0 && leftKey === rightKey;
}

function projectFieldPointToScreen(x: number, y: number): { x: number; y: number } {
  // The inner div has transform-origin: "center bottom" = (500, 420).
  // The outer div has perspective: 800px with default perspective-origin: "50% 50%" = (500, 210).
  // We must project relative to the perspective-origin, not the transform-origin.
  const PERSPECTIVE_ORIGIN_Y = 210; // = H/2 = 420/2
  const relX = x - FIELD_PERSPECTIVE_ORIGIN_X;
  const relY_fromTransformOrigin = y - FIELD_PERSPECTIVE_ORIGIN_Y; // relative to bottom (420)
  const z = relY_fromTransformOrigin * Math.sin(FIELD_TILT_RAD);
  const scale = FIELD_PERSPECTIVE_PX / (FIELD_PERSPECTIVE_PX - z);
  // Y after rotation (in CSS pixel space, relative to outer div top)
  const rotatedY = FIELD_PERSPECTIVE_ORIGIN_Y + relY_fromTransformOrigin * Math.cos(FIELD_TILT_RAD);
  return {
    x: FIELD_PERSPECTIVE_ORIGIN_X + relX * scale,
    y: PERSPECTIVE_ORIGIN_Y + (rotatedY - PERSPECTIVE_ORIGIN_Y) * scale,
  };
}

function normalizeOverlayColor(color?: string): string | undefined {
  if (!color) return undefined;
  const hex = color.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return `#${hex}`;
}

function relativeLuminance(hexColor: string): number {
  const hex = hexColor.replace('#', '').trim();
  if (hex.length !== 6) return 0;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function resolveOverlayTeamColors(
  teamAbbr: string | undefined,
  teamColorsByAbbr: Record<string, { color?: string; altColor?: string }>,
  fallback: string
): { baseColor: string; glowColor: string } {
  if (!teamAbbr) {
    return { baseColor: fallback, glowColor: fallback };
  }
  const key = teamAbbr.trim().toUpperCase();
  const palette =
    teamColorsByAbbr[key] ??
    teamColorsByAbbr[teamAbbr] ??
    Object.entries(teamColorsByAbbr).find(([abbr]) => abbr.toUpperCase() === key)?.[1];
  const baseColor =
    normalizeOverlayColor(palette?.color) ?? normalizeOverlayColor(palette?.altColor) ?? fallback;
  const candidates = [
    normalizeOverlayColor(palette?.color),
    normalizeOverlayColor(palette?.altColor),
  ].filter(Boolean) as string[];
  if (candidates.length === 0) {
    return { baseColor, glowColor: baseColor };
  }
  const sorted = [...candidates].sort(
    (left, right) => relativeLuminance(right) - relativeLuminance(left)
  );
  const glowColor =
    sorted.find((color) => relativeLuminance(color) >= 0.16) ?? sorted[0] ?? baseColor;
  return { baseColor, glowColor };
}

interface OverlayHeadshotMarkerSpec {
  key: string;
  x: number;
  y: number;
  headshotUrl?: string;
  playerName?: string;
  baseColor: string;
  ringColor: string;
  depthOffsetY: number;
  avatarRadius: number;
  sizeMultiplier?: number;
  delay?: number;
  disappearAfter?: number;
  actorInfo?: PlayActorInfo;
}

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

function OverlayHeadshotMarker({
  marker,
  onClickActor,
}: {
  marker: OverlayHeadshotMarkerSpec;
  onClickActor?: (actor: PlayActorInfo) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const scaledAvatarRadius =
    marker.avatarRadius * FIELD_HEADSHOT_SCALE * (marker.sizeMultiplier ?? 1);
  const ringStroke = Math.max(0.85, scaledAvatarRadius * 0.038);
  const projected = projectFieldPointToScreen(marker.x, marker.y);
  const cx = projected.x;
  const cy = projected.y + marker.depthOffsetY;
  const visibilityAnimations = [`fadeIn 0.16s ease ${marker.delay ?? 0}s forwards`];
  if (marker.disappearAfter != null) {
    visibilityAnimations.push(`fadeOut 0.22s ease ${marker.disappearAfter}s forwards`);
  }
  const isClickable = Boolean(marker.actorInfo && onClickActor);

  // Name plate — small tab attached at the top of the circle, extends freely (no clip)
  const namePlateH = Math.max(10, scaledAvatarRadius * 0.3);
  const nameFontSize = Math.max(5.5, namePlateH * 0.72);
  const lastNameToken = marker.playerName
    ? (marker.playerName.trim().split(/\s+/).pop() ?? '').toUpperCase()
    : '';
  // Width: enough for text + padding, min = circle diameter
  const namePlateW = Math.max(
    scaledAvatarRadius * 2,
    lastNameToken.length * nameFontSize * 0.58 + namePlateH * 2
  );
  // Y: 75% of the plate above the circle top, 25% inside — "anchored" look
  const namePlateY = cy - scaledAvatarRadius - namePlateH * 0.75;
  const namePlateX = cx - namePlateW / 2;

  // Unique filter ID for the glow blur — used by both initials and image branches.
  const glowFilterId = `hshot-glow-${markerHash(marker.key)}`;

  // Hover scale: use fill-box so scale() pivots on the element's own geometric centre,
  // avoiding the SVG-coord vs CSS-px mismatch that the translate trick produces.
  const innerStyle: CSSProperties = isClickable
    ? {
        transform: hovered ? 'scale(1.09)' : 'scale(1)',
        transformBox: 'fill-box' as CSSProperties['transformBox'],
        transformOrigin: 'center',
        transition: 'transform 0.13s ease',
      }
    : {};

  // Initials fallback — no headshot URL but name provided. Rendered in overlay so it's a perfect circle.
  if (!marker.headshotUrl) {
    if (!marker.playerName) return null;
    const initials = marker.playerName
      .trim()
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .filter(Boolean)
      .slice(0, 2)
      .join('');
    return (
      <g
        style={{
          opacity: 0,
          animation: visibilityAnimations.join(', '),
          cursor: isClickable ? 'pointer' : 'default',
          pointerEvents: isClickable ? 'all' : 'none',
        }}
        onClick={isClickable ? () => onClickActor!(marker.actorInfo!) : undefined}
        onMouseEnter={isClickable ? () => setHovered(true) : undefined}
        onMouseLeave={isClickable ? () => setHovered(false) : undefined}
      >
        {/* Glow bloom — blurred fill circle that fades in on hover */}
        <defs>
          <filter id={glowFilterId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation={Math.max(3, scaledAvatarRadius * 0.3)}
            />
          </filter>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={scaledAvatarRadius * 1.1}
          fill={marker.ringColor}
          fillOpacity={hovered ? 0.6 : 0}
          filter={`url(#${glowFilterId})`}
          style={{ transition: 'fill-opacity 0.25s ease' }}
        />
        {/* Scale group — circle content */}
        <g style={innerStyle}>
          <circle
            cx={cx}
            cy={cy}
            r={scaledAvatarRadius + ringStroke * 2}
            fill="none"
            stroke={marker.ringColor}
            strokeOpacity={hovered ? 0.28 : 0.15}
            strokeWidth={ringStroke * 4}
          />
          <circle
            cx={cx}
            cy={cy}
            r={scaledAvatarRadius}
            fill="rgba(5,12,24,.94)"
            stroke={marker.ringColor}
            strokeOpacity={hovered ? 1.0 : 0.9}
            strokeWidth={hovered ? ringStroke * 1.3 : ringStroke}
            style={{
              filter: `drop-shadow(0 0 ${hovered ? 18 : 6}px ${marker.ringColor}${hovered ? 'ff' : '44'})`,
              transition: 'filter 0.25s ease',
            }}
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill={marker.ringColor}
            fontSize={scaledAvatarRadius * 0.72}
            fontFamily="'Barlow Condensed', sans-serif"
            fontWeight={700}
            letterSpacing=".04em"
          >
            {initials}
          </text>
        </g>
        {/* Name plate — static, no hover changes */}
        {lastNameToken && (
          <>
            <rect
              x={namePlateX}
              y={namePlateY}
              width={namePlateW}
              height={namePlateH}
              rx={2}
              fill="rgba(4,10,22,0.88)"
              stroke={marker.ringColor}
              strokeOpacity={0.45}
              strokeWidth={0.7}
            />
            <text
              x={cx}
              y={namePlateY + namePlateH * 0.54}
              textAnchor="middle"
              dominantBaseline="central"
              fill={C.textBright}
              fontSize={nameFontSize}
              fontFamily="'Barlow Condensed', sans-serif"
              fontWeight={700}
              letterSpacing=".07em"
            >
              {lastNameToken}
            </text>
          </>
        )}
      </g>
    );
  }

  const imageSize = scaledAvatarRadius * 2;
  const shadowRx = scaledAvatarRadius * 0.58;
  const shadowRy = Math.max(2.2, scaledAvatarRadius * 0.16);
  const shadowSoftRx = shadowRx * 1.24;
  const shadowSoftRy = shadowRy * 1.56;
  const clipId = `overlay-headshot-${markerHash(`${marker.key}:${marker.x.toFixed(1)}:${marker.y.toFixed(1)}`)}`;
  const glowId = `overlay-headshot-glow-${markerHash(`${marker.key}:${marker.ringColor}:${marker.baseColor}`)}`;
  const shadowY = cy + scaledAvatarRadius * 0.94;
  const shadowSoftY = shadowY + shadowRy * 0.9;
  return (
    <g
      style={{
        opacity: 0,
        animation: visibilityAnimations.join(', '),
        cursor: isClickable ? 'pointer' : 'default',
        pointerEvents: isClickable ? 'all' : 'none',
      }}
      onClick={isClickable ? () => onClickActor!(marker.actorInfo!) : undefined}
      onMouseEnter={isClickable ? () => setHovered(true) : undefined}
      onMouseLeave={isClickable ? () => setHovered(false) : undefined}
    >
      <defs>
        <radialGradient id={glowId} cx="35%" cy="35%" r="62%">
          <stop offset="0%" stopColor={marker.baseColor} stopOpacity="0.3" />
          <stop offset="48%" stopColor={marker.baseColor} stopOpacity="0.12" />
          <stop offset="78%" stopColor={marker.baseColor} stopOpacity="0.05" />
          <stop offset="100%" stopColor={marker.baseColor} stopOpacity="0" />
        </radialGradient>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={scaledAvatarRadius - 0.8} />
        </clipPath>
        <filter id={glowFilterId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(3, scaledAvatarRadius * 0.3)} />
        </filter>
      </defs>
      {/* Glow bloom — blurred fill circle that fades in on hover */}
      <circle
        cx={cx}
        cy={cy}
        r={scaledAvatarRadius * 1.1}
        fill={marker.ringColor}
        fillOpacity={hovered ? 0.6 : 0}
        filter={`url(#${glowFilterId})`}
        style={{ transition: 'fill-opacity 0.25s ease' }}
      />
      {/* Circle + image — no CSS scale so clipPath stays aligned */}
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={scaledAvatarRadius + ringStroke * 2.45}
          fill={`url(#${glowId})`}
        />
        <ellipse
          cx={cx}
          cy={shadowSoftY}
          rx={shadowSoftRx}
          ry={shadowSoftRy}
          fill="rgba(0,0,0,0.14)"
        />
        <ellipse cx={cx} cy={shadowY} rx={shadowRx} ry={shadowRy} fill="rgba(0,0,0,0.26)" />
        <circle
          cx={cx}
          cy={cy}
          r={scaledAvatarRadius + ringStroke * 0.34}
          fill="none"
          stroke={marker.ringColor}
          strokeOpacity={hovered ? 1.0 : 0.7}
          strokeWidth={hovered ? ringStroke * 1.3 : ringStroke * 0.92}
          style={{
            filter: `drop-shadow(0 0 ${hovered ? 18 : 8}px ${marker.ringColor}${hovered ? 'ff' : '55'}) drop-shadow(0 0 4px ${marker.ringColor}4d)`,
            transition: 'filter 0.25s ease',
          }}
        />
        <circle
          cx={cx}
          cy={cy}
          r={scaledAvatarRadius}
          fill="rgba(5,12,24,.92)"
          stroke={marker.ringColor}
          strokeOpacity={0.82}
          strokeWidth={ringStroke * 0.58}
        />
        <image
          href={marker.headshotUrl}
          x={cx - scaledAvatarRadius}
          y={cy - scaledAvatarRadius}
          width={imageSize}
          height={imageSize}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      </g>
      {/* Name plate — static, no hover changes */}
      {lastNameToken && (
        <>
          <rect
            x={namePlateX}
            y={namePlateY}
            width={namePlateW}
            height={namePlateH}
            rx={2}
            fill="rgba(4,10,22,0.88)"
            stroke={marker.ringColor}
            strokeOpacity={0.45}
            strokeWidth={0.7}
          />
          <text
            x={cx}
            y={namePlateY + namePlateH * 0.54}
            textAnchor="middle"
            dominantBaseline="central"
            fill={C.textBright}
            fontSize={nameFontSize}
            fontFamily="'Barlow Condensed', sans-serif"
            fontWeight={700}
            letterSpacing=".07em"
          >
            {lastNameToken}
          </text>
        </>
      )}
    </g>
  );
}

function parseFieldSpotToPct(
  sideRaw: string | undefined,
  yardRaw: string | undefined,
  awayAbbr: string
): number | null {
  const side = (sideRaw ?? '').trim().toUpperCase();
  const yard = Number.parseInt((yardRaw ?? '').trim(), 10);
  if (!side || Number.isNaN(yard)) return null;
  return yardToFieldPct(Math.max(0, Math.min(50, yard)), side, awayAbbr);
}

function parseFumbleSpotsToPct(
  description: string,
  awayAbbr: string
): {
  takeawayPct: number | null;
  recoveryPct: number | null;
} {
  const fumbleMatch = description.match(
    /\bfumbles?(?:\s*\([^)]*\))?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i
  );
  const recoveryMatch = description.match(/\brecovered by\s+.+?\s+at\s+([A-Z]{2,3})\s+(\d{1,2})\b/i);
  return {
    takeawayPct: parseFieldSpotToPct(fumbleMatch?.[1], fumbleMatch?.[2], awayAbbr),
    recoveryPct: parseFieldSpotToPct(recoveryMatch?.[1], recoveryMatch?.[2], awayAbbr),
  };
}

function buildFieldHeadshotMarkers(
  play: PlayAnimationData,
  awayAbbr: string,
  homeAbbr: string | undefined,
  teamColorsByAbbr: Record<string, { color?: string; altColor?: string }>
): OverlayHeadshotMarkerSpec[] {
  const possIsAway = (play.offenseTeam ?? play.fromSide) === awayAbbr;
  const fromX = fieldPctToSvgX(yardToFieldPct(play.fromYardline, play.fromSide, awayAbbr));
  const toX = fieldPctToSvgX(yardToFieldPct(play.toYardline, play.toSide, awayAbbr));
  const lateralSign = play.direction === 'left' ? -1 : play.direction === 'right' ? 1 : 0;
  const dirY = FIELD_CENTER_Y + lateralSign * (possIsAway ? 60 : -60);
  const offenseTeam = play.offenseTeam?.trim().toUpperCase();
  const away = awayAbbr.trim().toUpperCase();
  const home = homeAbbr?.trim().toUpperCase();
  const defenseTeam =
    offenseTeam && home
      ? offenseTeam === away
        ? home
        : offenseTeam === home
          ? away
          : undefined
      : undefined;
  const offenseColors = resolveOverlayTeamColors(offenseTeam, teamColorsByAbbr, C.cyan);
  const defenseColors = resolveOverlayTeamColors(defenseTeam, teamColorsByAbbr, C.red);
  const markers: OverlayHeadshotMarkerSpec[] = [];

  const pushMarker = (
    key: string,
    x: number,
    y: number,
    headshotUrl: string | undefined | null,
    teamColors: { baseColor: string; glowColor: string },
    depthOffsetY: number,
    avatarRadius: number,
    sizeMultiplier = 1,
    delay = 0,
    disappearAfter?: number,
    playerName?: string,
    actorInfo?: PlayActorInfo
  ) => {
    const normalized = normalizeHeadshotUrl(headshotUrl ?? undefined);
    if (!normalized && !playerName) return;
    markers.push({
      key,
      x,
      y,
      headshotUrl: normalized,
      playerName: playerName || undefined,
      baseColor: teamColors.baseColor,
      ringColor: teamColors.glowColor,
      depthOffsetY,
      avatarRadius,
      sizeMultiplier,
      delay,
      disappearAfter,
      actorInfo: actorInfo ?? undefined,
    });
  };

  if (play.type === 'pass') {
    const text = play.description.toLowerCase();
    const isComplete = play.isComplete;
    const isSack = !isComplete && (text.includes('sack') || play.yardsGained < 0);
    const duration = Math.max(ANIM_TIMING.pass * 1.03, 1.24);
    const postTryDelay = duration + 4.85;
    const hasPostTrySequence = Boolean(buildPostScoreTryData(play, awayAbbr));
    const hidePrimaryAt = hasPostTrySequence
      ? Math.max(duration + 0.6, postTryDelay - 0.35)
      : undefined;
    const primaryFadeOutDelay =
      hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;
    const qbDisappearAt = hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, 0.36) : undefined;
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
      if (text.includes('short') || text.includes('screen') || text.includes('flat')) {
        return Math.min(6, Math.max(3, base * 0.45));
      }
      return Math.min(25, Math.max(8, base * 1.3));
    })();
    const incompleteX = (() => {
      const dir = play.direction === 'middle' ? 1 : play.direction === 'left' ? 0.95 : 1.05;
      const sign = possIsAway ? 1 : -1;
      return clampFieldX(fromX + sign * estimatedDepthYards * YARDS_TO_PX * dir);
    })();
    const touchdownInsetX =
      isComplete && play.isTouchdown ? clampFieldX(toX + offenseDir * 26) : toX;
    const targetX = isSack ? toX : isComplete ? touchdownInsetX : incompleteX;
    const targetY = isSack ? FIELD_CENTER_Y : dirY;
    const passLateralSign = targetX >= fromX ? 1 : -1;
    const qbHeadshotX = clampFieldX(fromX - passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X);
    const receiverHeadshotX = clampFieldX(
      targetX + passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X
    );
    if (!isSack && play.qbActor?.name) {
      pushMarker(
        'pass-qb',
        qbHeadshotX,
        FIELD_CENTER_Y,
        play.qbActor.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y,
        6.2,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        0,
        qbDisappearAt,
        play.qbActor.name,
        play.qbActor ?? undefined
      );
    }
    const showReceiver =
      isComplete &&
      !isSack &&
      play.actor?.name &&
      !samePlayerName(play.actor.name, play.qbActor?.name);
    if (showReceiver && play.actor?.name) {
      pushMarker(
        'pass-rec',
        receiverHeadshotX,
        targetY,
        play.actor.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y,
        6.4,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        duration + 0.04,
        primaryFadeOutDelay,
        play.actor.name,
        play.actor ?? undefined
      );
    }
    if (isSack && play.qbActor?.name) {
      pushMarker(
        'pass-sack',
        targetX,
        targetY,
        play.qbActor.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
        6.2,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        duration + 0.04,
        primaryFadeOutDelay,
        play.qbActor.name,
        play.qbActor ?? undefined
      );
    }
  } else if (play.type === 'rush') {
    const duration = ANIM_TIMING.rush * 1.08;
    const touchdownTargetX = play.isTouchdown
      ? Math.max(50, Math.min(950, toX + (possIsAway ? 26 : -26)))
      : toX;
    const rushDistancePx = Math.abs(touchdownTargetX - fromX);
    const shortRushFactor = Math.max(
      0,
      Math.min(1, 1 - rushDistancePx / SHORT_RUSH_DEPTH_DISTANCE_PX)
    );
    const rushHeadshotDepthOffsetY =
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y -
      Math.round(shortRushFactor * SHORT_RUSH_MAX_EXTRA_DEPTH_Y);
    const postTryDelay = duration + 4.85;
    const hasPostTrySequence = Boolean(buildPostScoreTryData(play, awayAbbr));
    const hidePrimaryAt = hasPostTrySequence
      ? Math.max(duration + 0.6, postTryDelay - 0.35)
      : undefined;
    const primaryFadeOutDelay =
      hidePrimaryAt != null ? Math.max(hidePrimaryAt - 0.08, duration + 0.35) : undefined;
    pushMarker(
      'rush-main',
      touchdownTargetX,
      dirY,
      play.actor?.headshotUrl,
      offenseColors,
      rushHeadshotDepthOffsetY,
      6.4,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      Math.max(0.08, duration * 0.72),
      primaryFadeOutDelay,
      play.actor?.name,
      play.actor ?? undefined
    );
  } else if (play.type === 'kick') {
    const landingX =
      play.kickLandingSide && typeof play.kickLandingYardline === 'number'
        ? fieldPctToSvgX(yardToFieldPct(play.kickLandingYardline, play.kickLandingSide, awayAbbr))
        : toX;
    const hasReturn = Math.abs(toX - landingX) > 2;
    const hasReturnActor = Boolean(play.actor?.name);
    const totalDuration = ANIM_TIMING.kick * 0.74;
    const kickDuration = hasReturn ? totalDuration * 0.62 : totalDuration;
    const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
    const returnOutOfBounds = /\b(?:ran|pushed)\s+ob\b/i.test(play.description);
    const finishY = hasReturn
      ? returnOutOfBounds
        ? FIELD_TOP - 8
        : FIELD_CENTER_Y
      : FIELD_CENTER_Y;
    pushMarker(
      'kick-kicker',
      fromX,
      FIELD_CENTER_Y,
      play.qbActor?.headshotUrl,
      offenseColors,
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
      6.3,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      0,
      undefined,
      play.qbActor?.name,
      play.qbActor ?? undefined
    );
    const returnerDelay =
      hasReturn && hasReturnActor ? kickDuration + returnDuration + 0.04 : kickDuration + 0.04;
    pushMarker(
      'kick-returner',
      hasReturn && hasReturnActor ? toX : landingX,
      hasReturn && hasReturnActor ? finishY : FIELD_CENTER_Y,
      play.actor?.headshotUrl,
      defenseColors,
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
      6.4,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      returnerDelay,
      undefined,
      play.actor?.name,
      play.actor ?? undefined
    );
  } else if (play.type === 'fieldgoal') {
    // Place kicker slightly behind the snap (upfield), so the circle is behind the arc start.
    const kickerXOffset = 20;
    const kickerX = possIsAway ? fromX - kickerXOffset : fromX + kickerXOffset;
    pushMarker(
      'fg-kicker',
      kickerX,
      FIELD_CENTER_Y,
      play.actor?.headshotUrl,
      offenseColors,
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
      6.3,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      0,
      undefined,
      play.actor?.name,
      play.actor ?? undefined
    );
  } else if (play.type === 'turnover') {
    const turnoverPctRaw =
      play.turnoverSpotSide && typeof play.turnoverSpotYardline === 'number'
        ? yardToFieldPct(play.turnoverSpotYardline, play.turnoverSpotSide, awayAbbr)
        : yardToFieldPct(play.toYardline, play.toSide, awayAbbr);
    const parsedFumbleSpots = /\bfumble(?:s|d)?\b/i.test(play.description)
      ? parseFumbleSpotsToPct(play.description, awayAbbr)
      : null;
    const turnoverPct = parsedFumbleSpots?.takeawayPct ?? turnoverPctRaw;
    const finalPct =
      parsedFumbleSpots?.recoveryPct ?? yardToFieldPct(play.toYardline, play.toSide, awayAbbr);
    const turnoverX = fieldPctToSvgX(turnoverPct);
    const finalX = fieldPctToSvgX(finalPct);
    const text = play.description.toLowerCase();
    const isInterception = text.includes('intercept');
    const isFumbleRecoverySwap =
      /\bfumble(?:s|d)?\b/i.test(text) &&
      !isInterception &&
      /\brecovered by\b/i.test(text) &&
      !/\bfor\s+\d+\s+yards?\b/i.test(text) &&
      !/\btouchdown\b/i.test(text);
    const hasReturn = isFumbleRecoverySwap
      ? Math.abs(finalX - turnoverX) > 0.5
      : Math.abs(finalX - turnoverX) > 2;
    const totalDuration = Math.max(ANIM_TIMING.turnover * 2, 1.65);
    const firstDuration = totalDuration * 0.52;
    const returnDuration = hasReturn ? totalDuration * 0.58 : 0;
    const returnStartDelay = firstDuration + 0.22;
    const turnoverDelay = hasReturn ? returnStartDelay + returnDuration : firstDuration + 0.08;
    const takeoverHeadshot = isInterception
      ? play.qbActor?.headshotUrl || play.actor?.headshotUrl
      : play.actor?.headshotUrl;
    const takeoverName = isInterception ? play.qbActor?.name || play.actor?.name : play.actor?.name;
    const takeoverActorInfo = isInterception
      ? (play.qbActor ?? play.actor ?? undefined)
      : (play.actor ?? undefined);
    pushMarker(
      'turnover',
      hasReturn ? finalX : turnoverX,
      FIELD_CENTER_Y,
      takeoverHeadshot,
      defenseColors,
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
      6.3,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      turnoverDelay,
      undefined,
      takeoverName,
      takeoverActorInfo
    );
  }

  // postScoreTry kick: add kicker in overlay screen space
  // (the in-field kick trail/kicker is suppressed by hideFgTrail in PostScoreAttemptOverlay)
  if (
    play.postScoreTryKind &&
    play.postScoreTryPlayType === 'kick' &&
    play.postScoreTryFromSide &&
    typeof play.postScoreTryFromYardline === 'number'
  ) {
    const tryFromX = fieldPctToSvgX(
      yardToFieldPct(play.postScoreTryFromYardline, play.postScoreTryFromSide, awayAbbr)
    );
    // Kicker stands slightly upfield of the snap position
    const tryKickerX = possIsAway ? tryFromX - 20 : tryFromX + 20;
    const postTryDelay =
      play.type === 'pass'
        ? Math.max(ANIM_TIMING.pass * 1.03, 1.24) + 4.85
        : ANIM_TIMING.rush * 1.08 + 4.85;
    pushMarker(
      'post-try-kicker',
      tryKickerX,
      FIELD_CENTER_Y,
      play.postScoreTryActor?.headshotUrl,
      offenseColors,
      FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
      6.3,
      FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
      postTryDelay,
      undefined,
      play.postScoreTryActor?.name,
      play.postScoreTryActor ?? undefined
    );
  }

  // postScoreTry pass/rush: add QB + actor headshots.
  // The animated trail already shows moving headshots during the attempt; these
  // static circles persist after the animation settles so the players stay visible.
  if (
    play.postScoreTryKind &&
    (play.postScoreTryPlayType === 'pass' || play.postScoreTryPlayType === 'rush') &&
    play.postScoreTryFromSide &&
    typeof play.postScoreTryFromYardline === 'number' &&
    play.postScoreTryToSide &&
    typeof play.postScoreTryToYardline === 'number'
  ) {
    const tryFromX = fieldPctToSvgX(
      yardToFieldPct(play.postScoreTryFromYardline, play.postScoreTryFromSide, awayAbbr)
    );
    const tryToX = fieldPctToSvgX(
      yardToFieldPct(play.postScoreTryToYardline, play.postScoreTryToSide, awayAbbr)
    );
    const passLateralSign = possIsAway ? 1 : -1;
    const postTryDelay =
      play.type === 'pass'
        ? Math.max(ANIM_TIMING.pass * 1.03, 1.24) + 4.85
        : ANIM_TIMING.rush * 1.08 + 4.85;
    const attemptDuration =
      play.postScoreTryPlayType === 'rush' ? ANIM_TIMING.rush * 0.72 : ANIM_TIMING.pass;

    if (play.postScoreTryPlayType === 'pass') {
      // QB at snap (lateral offset mirrors the main-play QB convention)
      pushMarker(
        'post-try-qb',
        clampFieldX(tryFromX - passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X),
        FIELD_CENTER_Y,
        play.postScoreTryQbActor?.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y,
        6.2,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        postTryDelay + 0.08,
        undefined,
        play.postScoreTryQbActor?.name,
        play.postScoreTryQbActor ?? undefined
      );
      // Receiver at catch spot (lateral offset mirrors main-play receiver convention)
      pushMarker(
        'post-try-actor',
        clampFieldX(tryToX + passLateralSign * FIELD_HEADSHOT_PASS_LATERAL_OFFSET_X),
        FIELD_CENTER_Y,
        play.postScoreTryActor?.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_PASS_DEPTH_OFFSET_Y,
        6.4,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        postTryDelay + attemptDuration + 0.08,
        undefined,
        play.postScoreTryActor?.name,
        play.postScoreTryActor ?? undefined
      );
    } else {
      // Rush: rusher at end spot
      pushMarker(
        'post-try-actor',
        tryToX,
        FIELD_CENTER_Y,
        play.postScoreTryActor?.headshotUrl,
        offenseColors,
        FIELD_HEADSHOT_ACTION_DEPTH_OFFSET_Y,
        6.4,
        FIELD_HEADSHOT_PASS_SIZE_MULTIPLIER,
        postTryDelay + attemptDuration + 0.08,
        undefined,
        play.postScoreTryActor?.name,
        play.postScoreTryActor ?? undefined
      );
    }
  }

  return markers;
}

function FieldHeadshotOverlay({
  markers,
  onClickActor,
}: {
  markers: OverlayHeadshotMarkerSpec[];
  onClickActor?: (actor: PlayActorInfo) => void;
}) {
  return (
    <g>
      {markers.map((marker) => (
        <OverlayHeadshotMarker key={marker.key} marker={marker} onClickActor={onClickActor} />
      ))}
    </g>
  );
}

// Portal geometry constants — must stay in sync with the portal rendering IIFE below
const PORTAL_LIFT = 30; // overlay SVG units the portal base is raised off the field surface
const PORTAL_3D_H = 216; // portal height in overlay SVG units

/** FG arc rendered in overlay screen space so the ball visually rises into the air. */
function OverlayFgArc({
  play,
  awayAbbr,
  delay = 0,
}: {
  play: PlayAnimationData;
  awayAbbr: string;
  /** Animation start delay in seconds (used for postScoreTry sequencing). */
  delay?: number;
}) {
  const possIsAway = (play.offenseTeam ?? play.fromSide) === awayAbbr;
  const fromSvgX = fieldPctToSvgX(yardToFieldPct(play.fromYardline, play.fromSide, awayAbbr));
  const { goalLineX, uprightX } = getFgEndpoints(possIsAway);
  const isMade = play.fgResult === 'made';
  const isShort = play.fgResult === 'short';
  const endSvgX = isShort ? goalLineX : uprightX;
  const wideMissOffset = FG_UPRIGHT_Y_HALF + 25;
  // Away kicker faces the home goal (right), so left=lower Y, right=higher Y.
  // Home kicker faces the away goal (left), so left=higher Y, right=lower Y.
  const wideMissSign = possIsAway ? -1 : 1;

  const start = projectFieldPointToScreen(fromSvgX, FIELD_CENTER_Y);

  // For a made FG, target the near-face centre of the portal in overlay screen-space.
  // The portal near-face base is at field Y = FG_PORTAL_CENTER_Y + FG_UPRIGHT_Y_HALF = 215,
  // then lifted by PORTAL_LIFT, with top at bNear_y − PORTAL_3D_H × scaleAt(nearFieldY).
  let end: { x: number; y: number };
  // Portal face geometry in overlay SVG space (used for entrance animation rings).
  let portalFaceHalfH = 0;
  let portalFaceHalfW = 0;
  let portalFaceAngleDeg = 0;
  let portalCornerPts = '';
  if (isMade) {
    const nearFieldY = FG_PORTAL_CENTER_Y + FG_UPRIGHT_Y_HALF; // 215
    const farFieldY = FG_PORTAL_CENTER_Y - FG_UPRIGHT_Y_HALF; // 105
    const bNearBase = projectFieldPointToScreen(uprightX, nearFieldY);
    const bFarBase = projectFieldPointToScreen(uprightX, farFieldY);
    const bNear_y = bNearBase.y - PORTAL_LIFT;
    const bFar_y = bFarBase.y - PORTAL_LIFT;
    const relY = nearFieldY - FIELD_PERSPECTIVE_ORIGIN_Y;
    const z = relY * Math.sin(FIELD_TILT_RAD);
    const sc = FIELD_PERSPECTIVE_PX / (FIELD_PERSPECTIVE_PX - z);
    const tNear_y = bNear_y - PORTAL_3D_H * sc;
    // Far top (same calc as portals.map in main render)
    const relYFar = farFieldY - FIELD_PERSPECTIVE_ORIGIN_Y;
    const zFar = relYFar * Math.sin(FIELD_TILT_RAD);
    const scFar = FIELD_PERSPECTIVE_PX / (FIELD_PERSPECTIVE_PX - zFar);
    const tFar_y = bFar_y - PORTAL_3D_H * scFar;
    // Aim for the centroid of the portal quad so the arc appears to enter
    // the middle of the portal, not stop at the near edge
    end = {
      x: (bNearBase.x + bFarBase.x) / 2,
      y: (bNear_y + tNear_y + bFar_y + tFar_y) / 4,
    };
    // Near face height (half-span)
    portalFaceHalfH = (bNear_y - tNear_y) / 2;
    // All four corners for clip polygon (matches portals.map winding order)
    portalCornerPts = [
      `${bFarBase.x.toFixed(1)},${bFar_y.toFixed(1)}`,
      `${bNearBase.x.toFixed(1)},${bNear_y.toFixed(1)}`,
      `${bNearBase.x.toFixed(1)},${tNear_y.toFixed(1)}`,
      `${bFarBase.x.toFixed(1)},${tFar_y.toFixed(1)}`,
    ].join(' ');
    // Portal face width vector (near→far base), used to orient rings into the portal plane
    const faceVecX = bFarBase.x - bNearBase.x;
    const faceVecY = bFar_y - bNear_y;
    portalFaceHalfW = Math.sqrt(faceVecX * faceVecX + faceVecY * faceVecY) / 2;
    portalFaceAngleDeg = (Math.atan2(faceVecY, faceVecX) * 180) / Math.PI;
  } else {
    let endSvgY = FIELD_CENTER_Y;
    if (play.fgResult === 'wide_left') endSvgY = FIELD_CENTER_Y + wideMissSign * wideMissOffset;
    else if (play.fgResult === 'wide_right')
      endSvgY = FIELD_CENTER_Y - wideMissSign * wideMissOffset;
    end = projectFieldPointToScreen(endSvgX, endSvgY);
  }
  // Control point: mid-X, just barely above the straight-line midpoint.
  // FG/XP should look like a tight laser-straight kick — not a looping punt arc.
  const controlX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const controlY = midY - 40; // ~20px visual peak above the straight-line midpoint
  const arcPath = `M ${start.x.toFixed(1)},${start.y.toFixed(1)} Q ${controlX.toFixed(1)},${controlY.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;

  const trailColor = isMade ? C.green : C.red;
  const duration = ANIM_TIMING.fieldgoal;
  const durationFast = duration * 0.74;
  // Ball reaches the portal face at ~94% through the arc animation
  const impactBegin = delay + durationFast * 0.94;

  return (
    <g
      style={
        delay > 0
          ? { opacity: 0, animation: `fadeIn 0.02s linear ${delay - 0.01}s forwards` }
          : undefined
      }
    >
      {/* Animated trail — fades out at portal impact for made FGs */}
      <path
        d={arcPath}
        fill="none"
        stroke={trailColor}
        strokeWidth={2.5}
        opacity={0.7}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1}
      >
        <animate
          attributeName="stroke-dashoffset"
          from="1"
          to="0"
          begin={`${delay}s`}
          dur={`${durationFast}s`}
          fill="freeze"
        />
      </path>
      {/* Ball travelling along arc — stays visible until it hits the portal face */}
      <circle r={5} fill={C.amber} opacity={0}>
        <animateMotion begin={`${delay}s`} dur={`${durationFast}s`} fill="freeze" path={arcPath} />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes={`0;0.04;${isMade ? '0.94' : '0.92'};1`}
          begin={`${delay}s`}
          dur={`${durationFast}s`}
          fill="freeze"
        />
      </circle>
      {/* Portal entrance effects — clipped to portal polygon, oriented into portal face plane */}
      {isMade && (
        <>
          <defs>
            {/* Clip to the portal quad so all effects stay within the gate */}
            <clipPath id={possIsAway ? 'pent-clip-a' : 'pent-clip-h'}>
              <polygon points={portalCornerPts} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${possIsAway ? 'pent-clip-a' : 'pent-clip-h'})`}>
            {/* Rotate into the portal face's local plane — same orientation as the portal
                rectangle, so effects "face" the field center rather than the SVG plane */}
            <g
              transform={`translate(${end.x.toFixed(1)},${end.y.toFixed(1)}) rotate(${portalFaceAngleDeg.toFixed(1)})`}
            >
              {/* Bright impact flash covering the portal face */}
              <ellipse
                cx={0}
                cy={0}
                rx={portalFaceHalfW * 2.5}
                ry={portalFaceHalfH * 0.9}
                fill="#c8f8ff"
                fillOpacity={0}
              >
                <animate
                  attributeName="fill-opacity"
                  values="0;0.92;0"
                  keyTimes="0;0.12;1"
                  begin={`${impactBegin.toFixed(3)}s`}
                  dur="0.55s"
                  fill="freeze"
                />
              </ellipse>
              {/* Three expanding rings in the portal face plane, staggered */}
              {[0, 1, 2].map((k) => (
                <ellipse
                  key={k}
                  cx={0}
                  cy={0}
                  fill="none"
                  stroke={k === 0 ? '#ffffff' : '#00d4ff'}
                  strokeWidth={2.2 - k * 0.55}
                >
                  <animate
                    attributeName="rx"
                    values={`2;${portalFaceHalfW * (1.8 + k * 0.9)}`}
                    begin={`${(impactBegin + k * 0.11).toFixed(3)}s`}
                    dur={`${0.62 - k * 0.04}s`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="ry"
                    values={`2;${portalFaceHalfH * (0.7 + k * 0.25)}`}
                    begin={`${(impactBegin + k * 0.11).toFixed(3)}s`}
                    dur={`${0.62 - k * 0.04}s`}
                    fill="freeze"
                  />
                  <animate
                    attributeName="stroke-opacity"
                    values="0.95;0"
                    begin={`${(impactBegin + k * 0.11).toFixed(3)}s`}
                    dur={`${0.62 - k * 0.04}s`}
                    fill="freeze"
                  />
                </ellipse>
              ))}
            </g>
          </g>
        </>
      )}
    </g>
  );
}

function buildPostScoreTryData(
  play: PlayAnimationData,
  awayAbbr: string
): PostScoreTryOverlayData | null {
  return play.postScoreTryKind &&
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
}

function OverlayFieldNotice({ notice }: { notice: string }) {
  const noticeText = notice.trim().toUpperCase();
  if (!noticeText) return null;
  const noticeLength = noticeText.length;
  const width = Math.max(520, Math.min(680, 330 + noticeLength * 16));
  const x = 500 - width / 2;
  const fontSize = noticeLength >= 18 ? 30 : 34;
  const letterSpacing = noticeLength >= 18 ? '.09em' : '.12em';
  const textY = noticeLength >= 18 ? 111 : 112;
  const projectedTop = projectFieldPointToScreen(500, FIELD_TOP + 28).y;
  const y = Math.max(54, Math.min(220, projectedTop - 40));

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={84}
        rx={3}
        fill="rgba(7,11,20,.9)"
        stroke={C.amber}
        strokeOpacity={0.45}
        strokeWidth={0.8}
        style={{ filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.5))' }}
      />
      <text
        x={500}
        y={y + (textY - 58)}
        textAnchor="middle"
        fill={C.amber}
        fontSize={fontSize}
        fontFamily={F.display}
        fontWeight={700}
        letterSpacing={letterSpacing}
      >
        {noticeText}
      </text>
    </g>
  );
}

export function FieldVisualization({
  away,
  home,
  situation,
  lastPlay,
  animationKey,
  weather: _weather,
  venue,
  currentDrive,
  isFinal,
  fieldNotice,
  showPlayStartSpot = false,
  onHeadshotClick,
}: FieldVisualizationProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Hidden during the transmission sweep; revealed after 650ms so headshots/ball
  // don't appear until the scan completes.
  const [showOverlays, setShowOverlays] = useState(false);

  useEffect(() => {
    const svg = svgRef.current;
    setShowOverlays(false);
    const id = setTimeout(() => {
      setShowOverlays(true);
      // Reset SMIL timelines (field guides like firstDownPulse) so they restart
      // in sync with the play animations.
      if (!svg) return;
      try {
        if (
          typeof (svg as SVGSVGElement & { unpauseAnimations?: () => void }).unpauseAnimations ===
          'function'
        ) {
          (svg as SVGSVGElement & { unpauseAnimations: () => void }).unpauseAnimations();
        }
        if (
          typeof (svg as SVGSVGElement & { setCurrentTime?: (seconds: number) => void })
            .setCurrentTime === 'function'
        ) {
          (svg as SVGSVGElement & { setCurrentTime: (seconds: number) => void }).setCurrentTime(0);
        }
      } catch {
        // Ignore unsupported SVG animation APIs in non-browser/test environments.
      }
    }, 650);
    return () => clearTimeout(id);
  }, [animationKey]);

  const hasReplaySpot = showPlayStartSpot && Boolean(lastPlay);
  const isOfficialTimeoutNotice = /^official timeout$/i.test((fieldNotice ?? '').trim());
  const hasSituation = !isFinal && (situation.yardLine > 0 || hasReplaySpot);
  const suppressSituationGuides = Boolean(lastPlay?.isTouchdown && lastPlay?.postScoreTryKind);
  const situationPct = hasSituation
    ? yardToFieldPct(situation.yardLine, situation.side, away.abbr)
    : 50;
  const replaySpotPct =
    showPlayStartSpot && lastPlay
      ? yardToFieldPct(lastPlay.fromYardline, lastPlay.fromSide, away.abbr)
      : situationPct;
  const fallbackDrivePct = currentDrive
    ? yardToFieldPct(currentDrive.startYardLine, currentDrive.startSide, away.abbr)
    : 50;
  const guideSpotPct = hasSituation ? replaySpotPct : fallbackDrivePct;
  const losX = fieldPctToSvgX(guideSpotPct);
  const replayPossessionTeam =
    showPlayStartSpot && lastPlay?.offenseTeam
      ? lastPlay.offenseTeam
      : situation.possessionTeam || currentDrive?.team || '';
  const replayPossIsAway = replayPossessionTeam === away.abbr;
  const replayDistanceRaw = showPlayStartSpot
    ? Math.max(0, lastPlay?.startDistance ?? situation.distance)
    : situation.distance;
  const replayDistance =
    replayDistanceRaw > 0 ? replayDistanceRaw : isOfficialTimeoutNotice ? 10 : 0;
  const firstDownPct = Math.max(
    0,
    Math.min(100, guideSpotPct + (replayPossIsAway ? replayDistance : -replayDistance))
  );
  const fdX = fieldPctToSvgX(firstDownPct);
  const possTeam = replayPossIsAway ? away : home;

  const driveStartPct = currentDrive
    ? yardToFieldPct(currentDrive.startYardLine, currentDrive.startSide, away.abbr)
    : situationPct;
  const driveStartX = fieldPctToSvgX(driveStartPct);

  const markerSide = showPlayStartSpot && lastPlay?.fromSide ? lastPlay.fromSide : situation.side;
  const markerYardLine = showPlayStartSpot && lastPlay ? lastPlay.fromYardline : situation.yardLine;
  // Timeout before kickoff should not show inherited drive/situation guides.
  const isPreKickoffOfficialTimeout =
    isOfficialTimeoutNotice &&
    (situation.down <= 0 || situation.distance <= 0 || !situation.side || situation.yardLine <= 0);
  const showGuidesDuringTimeout =
    isOfficialTimeoutNotice &&
    !isPreKickoffOfficialTimeout &&
    Boolean(currentDrive) &&
    (currentDrive?.plays ?? 0) > 0;
  const showSituationGuides =
    !isPreKickoffOfficialTimeout &&
    (hasSituation || showGuidesDuringTimeout) &&
    !suppressSituationGuides;
  const markerDisplaySide = markerSide || currentDrive?.startSide || situation.side;
  const markerDisplayYard =
    markerYardLine > 0 ? markerYardLine : (currentDrive?.startYardLine ?? situation.yardLine);
  const teamColorsByAbbr = {
    [away.abbr]: { color: away.color, altColor: away.altColor },
    [home.abbr]: { color: home.color, altColor: home.altColor },
  };
  const overlayHeadshotMarkers = lastPlay
    ? buildFieldHeadshotMarkers(lastPlay, away.abbr, home.abbr, teamColorsByAbbr)
    : [];
  // Penalty info is now rendered in the SituationBar area (LiveGameView),
  // not as an SVG overlay popup.

  // Synthetic play object for the postScoreTry XP kick overlay arc (screen-space).
  // fgResult is inferred from isGood + direction; missing direction defaults to center miss.
  const postTryFgResult: FgResult | undefined = lastPlay?.postScoreTryIsGood
    ? 'made'
    : lastPlay?.postScoreTryDirection === 'left'
      ? 'wide_left'
      : lastPlay?.postScoreTryDirection === 'right'
        ? 'wide_right'
        : undefined;
  const postTryKickArcDelay =
    lastPlay?.postScoreTryPlayType === 'kick'
      ? lastPlay.type === 'pass'
        ? Math.max(ANIM_TIMING.pass * 1.03, 1.24) + 4.85
        : ANIM_TIMING.rush * 1.08 + 4.85
      : 0;
  const postTryKickArcPlay =
    lastPlay &&
    lastPlay.postScoreTryKind &&
    lastPlay.postScoreTryPlayType === 'kick' &&
    lastPlay.postScoreTryFromSide &&
    typeof lastPlay.postScoreTryFromYardline === 'number'
      ? {
          ...lastPlay,
          fromYardline: lastPlay.postScoreTryFromYardline,
          fromSide: lastPlay.postScoreTryFromSide,
          fgResult: postTryFgResult,
        }
      : null;

  return (
    <div style={{ position: 'relative', perspective: FIELD_PERSPECTIVE.perspective }}>
      <div
        style={{
          transform: FIELD_PERSPECTIVE.transform,
          transformOrigin: FIELD_PERSPECTIVE.transformOrigin,
          position: 'relative',
          zIndex: 0,
        }}
      >
        <svg
          key={animationKey}
          ref={svgRef}
          viewBox="0 0 1000 420"
          style={{ width: '100%', display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="fGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.cyan} stopOpacity=".22" />
              <stop offset="50%" stopColor={C.cyan} stopOpacity=".05" />
              <stop offset="100%" stopColor={C.cyan} stopOpacity=".16" />
            </linearGradient>
            {/* Horizontal scanlines — holographic projection grid */}
            <pattern id="hScan" patternUnits="userSpaceOnUse" width="1000" height="5">
              <line
                x1="0"
                y1="4.5"
                x2="1000"
                y2="4.5"
                stroke="#00e5ff"
                strokeWidth="0.3"
                opacity="0.08"
              />
            </pattern>
            <radialGradient id="ballG" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={C.amber} stopOpacity=".6" />
              <stop offset="60%" stopColor={C.amber} stopOpacity=".1" />
              <stop offset="100%" stopColor={C.amber} stopOpacity="0" />
            </radialGradient>
            <filter id="gf">
              <feGaussianBlur stdDeviation="2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern
              id="ezPatA"
              patternUnits="userSpaceOnUse"
              width="12"
              height="12"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="12"
                stroke={`#${away.altColor}`}
                strokeWidth="3"
                opacity=".12"
              />
            </pattern>
            <pattern
              id="ezPatH"
              patternUnits="userSpaceOnUse"
              width="12"
              height="12"
              patternTransform="rotate(-45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="12"
                stroke={`#${home.color}`}
                strokeWidth="3"
                opacity=".12"
              />
            </pattern>
          </defs>

          {/* Horizon zone — the y=0..FIELD_TOP strip is perspective-compressed into a thin
              glowing band at the far edge of the tilted field. Dark fill + edge glow only;
              grid lines compress to invisibility and were removed. */}
          <rect x="50" y="0" width="900" height={FIELD_TOP} fill="#020b18" />
          <rect x="50" y="0" width="900" height={FIELD_TOP} fill={C.cyan} opacity="0.06" />
          <line
            x1="50"
            y1={FIELD_TOP}
            x2="950"
            y2={FIELD_TOP}
            stroke={C.cyan}
            strokeWidth="2"
            opacity="0.55"
          />

          {/* Field body */}
          {/* Semi-transparent base lets the star field bleed through — holographic projection effect */}
          <rect
            x="50"
            y={FIELD_TOP}
            width="900"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="#060d1e"
            opacity="0.55"
          />
          <rect
            x="50"
            y={FIELD_TOP}
            width="900"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="url(#fGrad)"
            stroke={C.cyanDim}
            strokeWidth="1.5"
            opacity=".8"
            filter="url(#gf)"
          />
          {/* Holographic scanlines overlay */}
          <rect
            x="50"
            y={FIELD_TOP}
            width="900"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="url(#hScan)"
            opacity="1"
          />

          {/* Away endzone */}
          <rect
            x="50"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill={`#${away.color}`}
            opacity=".28"
          />
          <rect
            x="50"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="url(#ezPatA)"
          />
          <rect
            x="50"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            stroke={C.cyanDim}
            strokeWidth=".5"
            fill="none"
          />
          <text
            x="91"
            y={FIELD_CENTER_Y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={`#${away.altColor}`}
            opacity=".55"
            fontSize="36"
            fontFamily="'Barlow Condensed'"
            fontWeight="800"
            letterSpacing="16"
            transform={`rotate(-90 91 ${FIELD_CENTER_Y})`}
            style={{ filter: `drop-shadow(0 0 5px #${away.color})` }}
          >
            {away.endzoneName}
          </text>

          {/* Home endzone */}
          <rect
            x="868"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill={`#${home.color}`}
            opacity=".28"
          />
          <rect
            x="868"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="url(#ezPatH)"
          />
          <rect
            x="868"
            y={FIELD_TOP}
            width="82"
            height={FIELD_BOTTOM - FIELD_TOP}
            stroke={C.cyanDim}
            strokeWidth=".5"
            fill="none"
          />
          <text
            x="909"
            y={FIELD_CENTER_Y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={`#${home.altColor}`}
            opacity=".55"
            fontSize="36"
            fontFamily="'Barlow Condensed'"
            fontWeight="800"
            letterSpacing="12"
            textLength="320"
            lengthAdjust="spacingAndGlyphs"
            transform={`rotate(90 909 ${FIELD_CENTER_Y})`}
            style={{ filter: `drop-shadow(0 0 5px #${home.color})` }}
          >
            {home.endzoneName}
          </text>

          {/* Goal line glows */}
          <line
            x1={FIELD_LEFT}
            y1={FIELD_TOP}
            x2={FIELD_LEFT}
            y2={FIELD_BOTTOM}
            stroke={`#${away.altColor}`}
            strokeWidth="2"
            opacity=".2"
            style={{ filter: `drop-shadow(0 0 4px #${away.altColor}40)` }}
          />
          <line
            x1={FIELD_RIGHT}
            y1={FIELD_TOP}
            x2={FIELD_RIGHT}
            y2={FIELD_BOTTOM}
            stroke={`#${home.altColor || home.color}`}
            strokeWidth="2"
            opacity=".2"
            style={{ filter: `drop-shadow(0 0 4px #${home.color}40)` }}
          />

          {/* Guide layer: render before play overlays so guide lines stay behind action */}
          <g data-layer="field-guides">
            {/* Drive start marker — sci-fi waypoint beacon on near (bottom) sideline */}
            {!isPreKickoffOfficialTimeout &&
              (hasSituation || showGuidesDuringTimeout) &&
              currentDrive &&
              (() => {
                // Use cyan (not team color) — yellow/amber is reserved for first-down/penalty
                const beaconColor = C.cyan;
                const cx = driveStartX;
                // Diamond centre sits just below the field in the gutter strip
                const cy = FIELD_BOTTOM + 14;
                const r = 5;
                const d = `M ${cx},${cy - r} L ${cx + r},${cy} L ${cx},${cy + r} L ${cx - r},${cy} Z`;
                // Thin connector line from field edge up to diamond tip
                const connTop = FIELD_BOTTOM + 1;
                return (
                  <g>
                    {/* Outer scan ring — pulses outward and fades */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r="5"
                      fill="none"
                      stroke={beaconColor}
                      strokeWidth="0.8"
                      opacity="0"
                    >
                      <animate
                        attributeName="r"
                        values="5;18"
                        dur="2.2s"
                        repeatCount="indefinite"
                        calcMode="ease-out"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.55;0"
                        dur="2.2s"
                        repeatCount="indefinite"
                        calcMode="ease-out"
                      />
                    </circle>
                    {/* Mid scan ring — offset phase */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r="5"
                      fill="none"
                      stroke={beaconColor}
                      strokeWidth="0.5"
                      opacity="0"
                    >
                      <animate
                        attributeName="r"
                        values="5;13"
                        dur="2.2s"
                        begin="1.1s"
                        repeatCount="indefinite"
                        calcMode="ease-out"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.4;0"
                        dur="2.2s"
                        begin="1.1s"
                        repeatCount="indefinite"
                        calcMode="ease-out"
                      />
                    </circle>
                    {/* Soft glow halo */}
                    <circle cx={cx} cy={cy} r={r + 5} fill={beaconColor} opacity=".07" />
                    {/* Diamond waypoint body */}
                    <path d={d} fill={beaconColor} opacity=".9" />
                    {/* Inner highlight */}
                    <path
                      d={`M ${cx},${cy - r + 1.5} L ${cx + r - 1.5},${cy} L ${cx},${cy - 1}`}
                      fill="rgba(255,255,255,.2)"
                    />
                    {/* Connector from diamond top tip to field edge */}
                    <line
                      x1={cx}
                      y1={cy - r}
                      x2={cx}
                      y2={connTop}
                      stroke={beaconColor}
                      strokeWidth="1"
                      opacity=".45"
                      strokeDasharray="2 2"
                    />
                    {/* Label to the right */}
                    <text
                      x={cx + r + 5}
                      y={cy + 2.5}
                      textAnchor="start"
                      fill={beaconColor}
                      fontSize="7"
                      fontFamily={F.display}
                      fontWeight="700"
                      letterSpacing=".1em"
                      opacity=".75"
                    >
                      DRIVE STARTED
                    </text>
                  </g>
                );
              })()}

            {/* LOS + First down */}
            {showSituationGuides && (
              <>
                <line
                  x1={losX}
                  y1={FIELD_TOP}
                  x2={losX}
                  y2={FIELD_BOTTOM}
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                  opacity=".45"
                />
                {replayDistance > 0 && (
                  <>
                    {/* First-down line */}
                    <line
                      x1={fdX}
                      y1={FIELD_TOP}
                      x2={fdX}
                      y2={FIELD_BOTTOM}
                      stroke={C.amber}
                      strokeWidth="2"
                      strokeDasharray="8 5"
                      opacity=".45"
                    />
                    {/* NFL-style first-down marker on the FAR (top) sideline */}
                    {(() => {
                      // Disc sits just above the field (in the header strip)
                      const discR = 7;
                      const discCy = FIELD_TOP - discR - 1; // y ≈ 22
                      // Pole extends upward from the disc toward y=0
                      const poleW = 5;
                      const poleX = fdX - poleW / 2;
                      const poleBotY = discCy - discR; // y ≈ 15
                      const poleTopY = 2;
                      const poleH = poleBotY - poleTopY; // ≈ 13
                      return (
                        <g>
                          {/* Ambient glow */}
                          <circle cx={fdX} cy={discCy} r={discR + 5} fill={C.amber} opacity=".1" />
                          {/* Pole extends up from disc */}
                          <rect
                            x={poleX}
                            y={poleTopY}
                            width={poleW}
                            height={poleH}
                            fill={C.amber}
                            opacity=".92"
                            rx="1"
                          />
                          {/* Alternating dark stripes */}
                          <rect
                            x={poleX}
                            y={poleTopY + 2}
                            width={poleW}
                            height={2.5}
                            fill="rgba(0,0,0,.45)"
                          />
                          <rect
                            x={poleX}
                            y={poleTopY + 7}
                            width={poleW}
                            height={2.5}
                            fill="rgba(0,0,0,.45)"
                          />
                          {/* Disc — round pad at bottom of pole, touching the sideline */}
                          <circle cx={fdX} cy={discCy} r={discR} fill={C.amber} opacity=".95" />
                          <circle
                            cx={fdX}
                            cy={discCy}
                            r={discR}
                            fill="none"
                            stroke="rgba(0,0,0,.35)"
                            strokeWidth="1"
                          />
                        </g>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* Ball marker — full v11 treatment */}
            {showSituationGuides &&
              (() => {
                const bx = losX,
                  by = FIELD_CENTER_Y;
                return (
                  <g>
                    <circle cx={bx} cy={by} r="28" fill="url(#ballG)" />
                    <circle
                      cx={bx}
                      cy={by}
                      r="12"
                      fill="none"
                      stroke={`#${possTeam.altColor || possTeam.color}`}
                      strokeWidth="1.5"
                      opacity=".3"
                    />
                    <circle cx={bx} cy={by} r="7" fill={C.amber} filter="url(#gf)" opacity=".9">
                      <animate
                        attributeName="r"
                        values="6;8;6"
                        dur="2.5s"
                        repeatCount="indefinite"
                      />
                    </circle>
                    <circle cx={bx} cy={by} r="2.5" fill="#fff" opacity=".8" />
                    {/* Position label pinned to top */}
                    <line
                      x1={bx}
                      y1="30"
                      x2={bx}
                      y2="52"
                      stroke={C.amber}
                      strokeWidth="1"
                      opacity=".3"
                      strokeDasharray="2 2"
                    />
                    <rect
                      x={bx - 34}
                      y="32"
                      width="68"
                      height="18"
                      rx="2"
                      fill="rgba(7,11,20,.88)"
                      stroke={C.amberBorder}
                      strokeWidth="1"
                    />
                    <text
                      x={bx}
                      y="44"
                      textAnchor="middle"
                      fill={C.amber}
                      fontSize="9"
                      fontFamily="'Orbitron'"
                      fontWeight="700"
                    >
                      {markerDisplaySide} {markerDisplayYard}
                    </text>
                  </g>
                );
              })()}
          </g>

          {/* Yard lines */}
          {YARD_LINE_POSITIONS.map(({ yard, displayNumber, x }) => (
            <g key={yard}>
              <line
                x1={x}
                y1={FIELD_TOP}
                x2={x}
                y2={FIELD_BOTTOM}
                stroke={C.cyan}
                strokeWidth=".7"
                opacity=".25"
                style={{ filter: 'drop-shadow(0 0 2px rgba(0,229,255,0.5))' }}
              />
              <text
                x={x}
                y="24"
                textAnchor="middle"
                fill={C.cyanDim}
                fontSize="11"
                fontFamily="'Share Tech Mono'"
                opacity=".5"
              >
                {displayNumber}
              </text>
              <text
                x={x}
                y="406"
                textAnchor="middle"
                fill={C.cyanDim}
                fontSize="11"
                fontFamily="'Share Tech Mono'"
                opacity=".5"
              >
                {displayNumber}
              </text>
            </g>
          ))}
          {[5, 15, 25, 35, 45, 55, 65, 75, 85, 95].map((yd) => (
            <line
              key={yd}
              x1={fieldPctToSvgX(yd)}
              y1={FIELD_TOP}
              x2={fieldPctToSvgX(yd)}
              y2={FIELD_BOTTOM}
              stroke={C.cyan}
              strokeWidth=".3"
              opacity=".12"
            />
          ))}

          {/* Hash marks */}
          {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((yd) => {
            const x = fieldPctToSvgX(yd);
            return (
              <g key={`h${yd}`}>
                <line
                  x1={x - 4}
                  y1={155}
                  x2={x + 4}
                  y2={155}
                  stroke={C.cyan}
                  strokeWidth=".5"
                  opacity=".1"
                />
                <line
                  x1={x - 4}
                  y1={265}
                  x2={x + 4}
                  y2={265}
                  stroke={C.cyan}
                  strokeWidth=".5"
                  opacity=".1"
                />
              </g>
            );
          })}

          {/* Stadium label sits in background layer so play overlays can pass in front */}
          <text
            x="500"
            y="14"
            textAnchor="middle"
            fill={C.textDim}
            fontSize="9"
            fontFamily="'Share Tech Mono'"
            letterSpacing="4"
          >
            {venue.toUpperCase()}
          </text>

          {/* Footer captions — rendered before play animation so overlays paint on top */}
          <text x="55" y="416" fill={C.textDim} fontSize="9" fontFamily="'Share Tech Mono'">
            ◂ {away.abbr} END ZONE
          </text>
          <text
            x="945"
            y="416"
            textAnchor="end"
            fill={C.textDim}
            fontSize="9"
            fontFamily="'Share Tech Mono'"
          >
            {home.abbr} END ZONE ▸
          </text>

          {/* Play animation — gated by showOverlays so it starts after the sweep */}
          {lastPlay && showOverlays && (
            <PlayAnimation
              key={animationKey}
              play={lastPlay}
              awayAbbr={away.abbr}
              homeAbbr={home.abbr}
              teamColorsByAbbr={teamColorsByAbbr}
              hideHeadshots
              hidePenaltyCallout
              hideFgTrail
            />
          )}
        </svg>
      </div>
      {/* Transmission sweep — a separate perspective-matched SVG keyed per play so its SMIL
          restarts cleanly and is not affected by setCurrentTime() on the main field SVG. */}
      <div
        key={`sweep-${animationKey}`}
        style={{
          transform: FIELD_PERSPECTIVE.transform,
          transformOrigin: FIELD_PERSPECTIVE.transformOrigin,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          pointerEvents: 'none',
          zIndex: 2,
        }}
      >
        <svg
          viewBox="0 0 1000 420"
          style={{ width: '100%', display: 'block', overflow: 'hidden' }}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
              <stop offset="40%" stopColor="#00e5ff" stopOpacity="0.5" />
              <stop offset="60%" stopColor="#00e5ff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="sweepVGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
              <stop offset="40%" stopColor="#00e5ff" stopOpacity="0.18" />
              <stop offset="60%" stopColor="#00e5ff" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Horizontal sweep (left → right) */}
          <rect
            x="50"
            y={FIELD_TOP}
            width="70"
            height={FIELD_BOTTOM - FIELD_TOP}
            fill="url(#sweepGrad)"
            opacity="0"
          >
            <animate attributeName="x" from="50" to="950" dur="0.65s" fill="freeze" />
            <animate
              attributeName="opacity"
              values="0;0.9;0.6;0"
              keyTimes="0;0.05;0.8;1"
              dur="0.65s"
              fill="freeze"
            />
          </rect>
          {/* Vertical sweep (top → bottom) — replaces the old CSS .play-sweep div */}
          <rect x="50" y={FIELD_TOP} width="900" height="60" fill="url(#sweepVGrad)" opacity="0">
            <animate
              attributeName="y"
              from={FIELD_TOP}
              to={FIELD_BOTTOM - 60}
              dur="0.65s"
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              values="0;0.8;0.5;0"
              keyTimes="0;0.05;0.8;1"
              dur="0.65s"
              fill="freeze"
            />
          </rect>
        </svg>
      </div>
      {/* FG uprights — one floating portal per endzone. Perspective-correct quadrilateral in
          screen/overlay space. Portals sit deep in each endzone, float via SMIL translate
          (so the clipPath coordinate space stays in sync), and show a rotating vortex
          interior clipped to the portal shape. */}
      {(() => {
        // PORTAL_3D_H and PORTAL_LIFT are module-level constants (defined above OverlayFgArc)
        // Portals near back wall of each endzone (away=55, home=945)
        const PORTAL_VISUAL_X = [55, 945] as const;
        // Shift portal Y-centre toward far sideline (further from viewer / field center).
        // Must stay in sync with FG_PORTAL_CENTER_Y in packages/sdk/src/gridstream/field.ts.
        const PORTAL_CENTER_Y = FIELD_CENTER_Y - 50; // = 160
        const PORTAL_Y_HALF = FG_UPRIGHT_Y_HALF; // keep gate-width consistent
        const GLOW =
          'drop-shadow(0 0 10px rgba(0,229,255,1)) drop-shadow(0 0 28px rgba(0,229,255,0.75)) drop-shadow(0 0 60px rgba(0,229,255,0.4))';

        function scaleAt(fieldY: number) {
          const relY = fieldY - FIELD_PERSPECTIVE_ORIGIN_Y;
          const z = relY * Math.sin(FIELD_TILT_RAD);
          return FIELD_PERSPECTIVE_PX / (FIELD_PERSPECTIVE_PX - z);
        }

        const portals = PORTAL_VISUAL_X.map((visualX, i) => {
          const farY = PORTAL_CENTER_Y - PORTAL_Y_HALF;
          const nearY = PORTAL_CENTER_Y + PORTAL_Y_HALF;
          // Project base points to screen, then lift off the field surface
          const bFarBase = projectFieldPointToScreen(visualX, farY);
          const bNearBase = projectFieldPointToScreen(visualX, nearY);
          const bFar = { x: bFarBase.x, y: bFarBase.y - PORTAL_LIFT };
          const bNear = { x: bNearBase.x, y: bNearBase.y - PORTAL_LIFT };
          const tFar = { x: bFar.x, y: bFar.y - PORTAL_3D_H * scaleAt(farY) };
          const tNear = { x: bNear.x, y: bNear.y - PORTAL_3D_H * scaleAt(nearY) };
          const cx = (bFar.x + bNear.x + tFar.x + tNear.x) / 4;
          const cy = (bFar.y + bNear.y + tFar.y + tNear.y) / 4;
          // Vortex ellipse axes: ~50% of portal bottom-edge width and near-side height
          const bWidth = Math.sqrt((bNear.x - bFar.x) ** 2 + (bNear.y - bFar.y) ** 2);
          const bHeight = bNear.y - tNear.y;
          const vRX = bWidth * 0.5;
          const vRY = bHeight * 0.5;
          const floatDur = i === 0 ? '4.4s' : '3.8s';
          return { bFar, bNear, tFar, tNear, cx, cy, vRX, vRY, floatDur };
        });

        return (
          <svg
            viewBox="0 0 1000 420"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
              overflow: 'visible',
              pointerEvents: 'none',
              zIndex: 1,
            }}
            aria-hidden="true"
          >
            {portals.map(({ bFar, bNear, tFar, tNear, cx, cy, vRX, vRY, floatDur }, i) => {
              const pts = `${bFar.x.toFixed(1)},${bFar.y.toFixed(1)} ${bNear.x.toFixed(1)},${bNear.y.toFixed(1)} ${tNear.x.toFixed(1)},${tNear.y.toFixed(1)} ${tFar.x.toFixed(1)},${tFar.y.toFixed(1)}`;
              const tx = cx.toFixed(1);
              const ty = cy.toFixed(1);
              const clipId = `pclip-${i}`;
              const gradId = `pgrad-${i}`;
              const vfxId = `pvfx-${i}`;
              const glowFId = `pglow-${i}`;
              // Displacement scale: enough to warp the gradient edge organically
              const dispScale = Math.round(vRY * 0.32);
              // Float via SMIL so the clipPath coordinate space moves with the group
              const floatBegin = i === 0 ? '0s' : '-1.9s';
              return (
                <g key={i} style={{ filter: GLOW }}>
                  {/* SMIL float — translates the whole group (and its defs) up/down */}
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values="0,0; 0,-10; 0,0"
                    keyTimes="0;0.5;1"
                    calcMode="spline"
                    keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                    dur={floatDur}
                    begin={floatBegin}
                    repeatCount="indefinite"
                  />
                  {/* All defs inside floating group so coordinate spaces stay in sync */}
                  <defs>
                    <clipPath id={clipId}>
                      <polygon points={pts} />
                    </clipPath>
                    {/* Radial gradient: deep void center → electric cyan rim */}
                    <radialGradient id={gradId} cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#000510" />
                      <stop offset="22%" stopColor="#000f28" />
                      <stop offset="52%" stopColor="#002568" />
                      <stop offset="78%" stopColor="#004db5" />
                      <stop offset="100%" stopColor="#00c8ff" stopOpacity="0.88" />
                    </radialGradient>
                    {/* Vortex filter: fractal noise displaces the gradient fill → organic swirl */}
                    <filter
                      id={vfxId}
                      x="-70%"
                      y="-70%"
                      width="240%"
                      height="240%"
                      colorInterpolationFilters="sRGB"
                    >
                      <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.055 0.032"
                        numOctaves={4}
                        seed={9}
                        result="noise"
                      >
                        <animate
                          attributeName="baseFrequency"
                          values="0.055 0.032; 0.072 0.042; 0.055 0.032"
                          dur="7s"
                          repeatCount="indefinite"
                        />
                      </feTurbulence>
                      <feDisplacementMap
                        in="SourceGraphic"
                        in2="noise"
                        scale={dispScale}
                        xChannelSelector="R"
                        yChannelSelector="G"
                      />
                    </filter>
                    {/* Soft glow blur for event-horizon ring and core */}
                    <filter id={glowFId} x="-80%" y="-80%" width="260%" height="260%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation={Math.max(2, vRY * 0.09)} />
                    </filter>
                  </defs>

                  {/* Deep void base */}
                  <polygon points={pts} fill="#000510" fillOpacity="0.98" />

                  {/* All portal interior — clipped to portal polygon */}
                  <g clipPath={`url(#${clipId})`}>
                    {/* Slowly rotating turbulent vortex — fractal noise warps the
                        radial gradient into organic fluid swirls as it spins */}
                    <g transform={`translate(${tx},${ty})`}>
                      <g>
                        <animateTransform
                          attributeName="transform"
                          type="rotate"
                          from="0"
                          to="360"
                          dur="25s"
                          repeatCount="indefinite"
                        />
                        <ellipse
                          rx={vRX * 1.25}
                          ry={vRY * 1.25}
                          fill={`url(#${gradId})`}
                          filter={`url(#${vfxId})`}
                        />
                      </g>
                    </g>

                    {/* Second counter-rotating layer at smaller scale — adds depth */}
                    <g transform={`translate(${tx},${ty})`}>
                      <g>
                        <animateTransform
                          attributeName="transform"
                          type="rotate"
                          from="360"
                          to="0"
                          dur="40s"
                          repeatCount="indefinite"
                        />
                        <ellipse
                          rx={vRX * 0.72}
                          ry={vRY * 0.72}
                          fill={`url(#${gradId})`}
                          fillOpacity="0.55"
                          filter={`url(#${vfxId})`}
                        />
                      </g>
                    </g>

                    {/* Event-horizon: blurred outer glow */}
                    <ellipse
                      cx={cx}
                      cy={cy}
                      rx={vRX * 0.88}
                      ry={vRY * 0.88}
                      fill="none"
                      stroke="#00ccff"
                      strokeWidth={Math.max(2.5, vRX * 0.26)}
                      strokeOpacity="0.58"
                      filter={`url(#${glowFId})`}
                    />
                    {/* Core: two layers of soft blurred glow — no hard edges,
                        matches the same cyan/blue energy as the event horizon */}
                    {/* Outer bloom — larger, mid-blue, slow breathe */}
                    <ellipse cx={cx} cy={cy} fill="#0066cc" filter={`url(#${glowFId})`}>
                      <animate
                        attributeName="rx"
                        values={`${vRX * 0.2};${vRX * 0.28};${vRX * 0.2}`}
                        dur="3.4s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                      <animate
                        attributeName="ry"
                        values={`${vRY * 0.2};${vRY * 0.28};${vRY * 0.2}`}
                        dur="3.4s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                      <animate
                        attributeName="fillOpacity"
                        values="0.5;0.88;0.5"
                        dur="3.4s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                    </ellipse>
                    {/* Inner bright spot — smaller, cyan, offset phase */}
                    <ellipse cx={cx} cy={cy} fill="#22ddff" filter={`url(#${glowFId})`}>
                      <animate
                        attributeName="rx"
                        values={`${vRX * 0.09};${vRX * 0.13};${vRX * 0.09}`}
                        dur="3.4s"
                        begin="-0.6s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                      <animate
                        attributeName="ry"
                        values={`${vRY * 0.09};${vRY * 0.13};${vRY * 0.09}`}
                        dur="3.4s"
                        begin="-0.6s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                      <animate
                        attributeName="fillOpacity"
                        values="0.7;1.0;0.7"
                        dur="3.4s"
                        begin="-0.6s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                      />
                    </ellipse>
                  </g>

                  {/* Portal frame — outside clip, always fully visible */}
                  <polygon
                    points={pts}
                    fill="none"
                    stroke="#00e5ff"
                    strokeWidth="3"
                    strokeOpacity="0.95"
                  />
                  <polygon
                    points={pts}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1"
                    strokeOpacity="0.45"
                  />
                </g>
              );
            })}
          </svg>
        );
      })()}
      {/* fieldNotice (timeout banners) renders immediately; play overlays wait for sweep */}
      {((showOverlays && lastPlay) || fieldNotice) && (
        <svg
          key={`field-overlay-${animationKey}`}
          viewBox="0 0 1000 420"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 1,
          }}
          aria-hidden="true"
        >
          {lastPlay && showOverlays && lastPlay.type === 'fieldgoal' && (
            <OverlayFgArc play={lastPlay} awayAbbr={away.abbr} />
          )}
          {postTryKickArcPlay && showOverlays && (
            <OverlayFgArc
              play={postTryKickArcPlay}
              awayAbbr={away.abbr}
              delay={postTryKickArcDelay}
            />
          )}
          {lastPlay && showOverlays && (
            <FieldHeadshotOverlay markers={overlayHeadshotMarkers} onClickActor={onHeadshotClick} />
          )}
          {fieldNotice && <OverlayFieldNotice notice={fieldNotice} />}
        </svg>
      )}
    </div>
  );
}
