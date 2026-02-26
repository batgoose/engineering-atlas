'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { ApiGameListItem } from '@atlas/sdk/gridstream/api-transforms';
import {
  gameStatusDisplay,
  gameWinner,
  weekLabel,
  type ApiGameLeader,
} from '@atlas/sdk/gridstream/api-transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';

export interface GameCardInjurySummary {
  awayFlags: string[];
  homeFlags: string[];
  awayCount: number;
  homeCount: number;
}

interface GameCardProps {
  game: ApiGameListItem;
  logoOverrides?: Record<string, string>;
  showWeekTag?: boolean;
  density?: 'compact' | 'expanded';
  awaySeed?: number | null;
  homeSeed?: number | null;
  injurySummary?: GameCardInjurySummary;
  onClick: () => void;
}

const LEADER_ROWS = [
  { category: 'passing', label: 'PASSING LEADER' },
  { category: 'rushing', label: 'RUSHING LEADER' },
  { category: 'receiving', label: 'RECEIVING LEADER' },
] as const;

function teamLabel(team: ApiGameListItem['home_team_detail']): string {
  const short = (team.short_display_name || team.display_name || team.abbreviation || '').trim();
  if (!short) return team.abbreviation;
  if (short.length <= 13) return short;
  const parts = short.split(/\s+/);
  if (parts.length > 1) return parts[parts.length - 1] ?? short;
  return short;
}

function TeamLogo({
  team,
  logoUrl,
  fallbackLogoUrl,
  align,
  compact,
  isWinner,
  isLoser,
}: {
  team: ApiGameListItem['home_team_detail'];
  logoUrl: string;
  fallbackLogoUrl?: string;
  align: 'left' | 'right';
  compact: boolean;
  isWinner: boolean;
  isLoser: boolean;
}) {
  const [imgSrc, setImgSrc] = useState(logoUrl || fallbackLogoUrl || '');
  const [fallbackUsed, setFallbackUsed] = useState(false);

  useEffect(() => {
    setImgSrc(logoUrl || fallbackLogoUrl || '');
    setFallbackUsed(false);
  }, [logoUrl, fallbackLogoUrl]);

  const teamColor = `#${team.color_primary}`;
  return (
    <div
      style={{
        width: compact ? 'clamp(48px, 13vw, 68px)' : 'clamp(56px, 16vw, 84px)',
        display: 'flex',
        justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
      }}
    >
      {imgSrc ? (
        // External team logos come from API URLs; keep native img so we don't require domain allowlists.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={imgSrc}
          src={imgSrc}
          alt={team.abbreviation}
          width={76}
          height={76}
          onError={() => {
            if (!fallbackUsed && fallbackLogoUrl && imgSrc !== fallbackLogoUrl) {
              setImgSrc(fallbackLogoUrl);
              setFallbackUsed(true);
              return;
            }
            setImgSrc('');
          }}
          style={{
            width: compact ? 'clamp(44px, 12vw, 64px)' : 'clamp(52px, 14vw, 76px)',
            height: compact ? 'clamp(44px, 12vw, 64px)' : 'clamp(52px, 14vw, 76px)',
            objectFit: 'contain',
            display: 'block',
            filter: isWinner
              ? 'drop-shadow(0 0 8px rgba(0,229,255,0.3)) drop-shadow(0 0 12px rgba(255,182,18,0.22))'
              : isLoser
                ? 'grayscale(0.34) saturate(0.74) brightness(0.84)'
                : undefined,
            transform: isWinner ? 'scale(1.03)' : undefined,
            opacity: isLoser ? 0.78 : 1,
          }}
        />
      ) : (
        <div
          style={{
            width: compact ? 'clamp(44px, 12vw, 64px)' : 'clamp(52px, 14vw, 76px)',
            height: compact ? 'clamp(44px, 12vw, 64px)' : 'clamp(52px, 14vw, 76px)',
            borderRadius: '50%',
            background: teamColor,
            opacity: isLoser ? 0.22 : 0.35,
            boxShadow: isWinner
              ? '0 0 12px rgba(0,229,255,0.28), 0 0 20px rgba(255,182,18,0.2)'
              : undefined,
          }}
        />
      )}
    </div>
  );
}

function TeamMeta({
  name,
  record,
  seed,
  align,
  isDimmed,
  hasPossession,
  compact,
}: {
  name: string;
  record: string;
  seed?: number | null;
  align: 'left' | 'right';
  isDimmed: boolean;
  hasPossession: boolean;
  compact: boolean;
}) {
  return (
    <div
      style={{
        minWidth: 0,
        textAlign: align,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: align === 'left' ? 'flex-start' : 'flex-end',
          gap: 6,
        }}
      >
        {hasPossession && align === 'right' && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: C.amber,
              boxShadow: `0 0 8px ${C.amber}`,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontFamily: F.display,
            fontSize: compact ? 'clamp(11px, 1.6vw, 14px)' : 'clamp(12px, 1.9vw, 16px)',
            fontWeight: 700,
            letterSpacing: '0.03em',
            color: isDimmed ? C.textDim : C.textBright,
            lineHeight: 1.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
          title={name}
        >
          {name}
        </span>
        {hasPossession && align === 'left' && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: C.amber,
              boxShadow: `0 0 8px ${C.amber}`,
              flexShrink: 0,
            }}
          />
        )}
      </div>
      <div
        style={{
          marginTop: 3,
          minWidth: 0,
          textAlign: align,
          fontFamily: F.mono,
          fontSize: compact ? 10 : 11,
          color: C.textMuted,
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {seed != null && seed > 0 ? `#${seed} · ` : ''}
        {record || '—'}
      </div>
    </div>
  );
}

function formatOddsNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatMoneyline(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function spreadLabel(game: ApiGameListItem): string | null {
  if (game.spread == null) return null;
  if (game.spread === 0) return 'PK';
  const favoredTeam =
    game.spread < 0 ? game.home_team_detail.abbreviation : game.away_team_detail.abbreviation;
  return `${favoredTeam} -${formatOddsNumber(Math.abs(game.spread))}`;
}

type CardBadgeTone = 'amber' | 'cyan' | 'green';

interface CardBadge {
  label: string;
  tone: CardBadgeTone;
}

function badgeToneStyle(tone: CardBadgeTone): CSSProperties {
  if (tone === 'amber') {
    return {
      color: C.amber,
      border: '1px solid rgba(255,177,0,0.35)',
      background: 'rgba(255,177,0,0.08)',
      textShadow: '0 0 8px rgba(255,177,0,0.35)',
    };
  }
  if (tone === 'green') {
    return {
      color: C.green,
      border: '1px solid rgba(0,230,118,0.35)',
      background: 'rgba(0,230,118,0.1)',
      textShadow: '0 0 8px rgba(0,230,118,0.35)',
    };
  }
  return {
    color: C.cyan,
    border: '1px solid rgba(0,229,255,0.28)',
    background: 'rgba(0,229,255,0.08)',
    textShadow: `0 0 8px ${C.cyan}44`,
  };
}

function restBadgesByTeam(game: ApiGameListItem): { away: CardBadge[]; home: CardBadge[] } {
  const away: CardBadge[] = [];
  const home: CardBadge[] = [];
  const awayRest = game.away_rest;
  const homeRest = game.home_rest;
  if (awayRest != null && awayRest <= 6) {
    away.push({
      label: `SHORT WK ${game.away_team_detail.abbreviation} ${awayRest}D`,
      tone: 'amber',
    });
  }
  if (homeRest != null && homeRest <= 6) {
    home.push({
      label: `SHORT WK ${game.home_team_detail.abbreviation} ${homeRest}D`,
      tone: 'amber',
    });
  }
  if (awayRest != null && homeRest != null && awayRest !== homeRest) {
    const awayHasAdv = awayRest > homeRest;
    const advTeam = awayHasAdv
      ? game.away_team_detail.abbreviation
      : game.home_team_detail.abbreviation;
    const diff = Math.abs(awayRest - homeRest);
    (awayHasAdv ? away : home).push({ label: `REST ADV ${advTeam} +${diff}D`, tone: 'green' });
  }
  return { away: away.slice(0, 2), home: home.slice(0, 2) };
}

function ScoreCell({
  score,
  isWinner,
  isScheduled,
  compact,
}: {
  score: number;
  isWinner: boolean;
  isScheduled: boolean;
  compact: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: F.display,
        fontSize: isWinner
          ? compact
            ? 'clamp(22px, 3.1vw, 30px)'
            : 'clamp(24px, 3.8vw, 38px)'
          : compact
            ? 'clamp(20px, 2.8vw, 28px)'
            : 'clamp(22px, 3.4vw, 34px)',
        fontWeight: 800,
        letterSpacing: '-0.02em',
        color: isWinner ? C.textBright : C.text,
        lineHeight: 1,
        minWidth: compact ? 32 : 38,
        textAlign: 'center',
        ...(isWinner && !isScheduled && { textShadow: '0 0 16px rgba(224,240,255,0.18)' }),
      }}
    >
      {isScheduled ? '—' : score}
    </div>
  );
}

function leaderForTeamCategory(
  leaders: ApiGameLeader[],
  teamAbbr: string,
  category: string
): ApiGameLeader | undefined {
  return leaders.find((leader) => leader.team_abbr === teamAbbr && leader.category === category);
}

function leaderValueLines(value?: string): string[] {
  const lines = (value ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 2) : ['—'];
}

function formatCardDateLabel(gameDate: string, gameTime: string | null): string {
  const [yearRaw, monthRaw, dayRaw] = gameDate.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return gameDate;

  const timeParts = (gameTime ?? '').split(':');
  const hour = Number.parseInt(timeParts[0] ?? '', 10);
  const minute = Number.parseInt(timeParts[1] ?? '', 10);
  const second = Number.parseInt(timeParts[2] ?? '0', 10);

  if (Number.isFinite(hour) && Number.isFinite(minute)) {
    const utcDate = new Date(
      Date.UTC(year, month - 1, day, hour, minute, Number.isFinite(second) ? second : 0)
    );
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(utcDate);

    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';

    const dayName = part('weekday').toUpperCase();
    const monthName = part('month');
    const dayOfMonth = part('day');
    const yearText = part('year');
    const hourText = part('hour');
    const minuteText = part('minute');
    const ampm = part('dayPeriod').toUpperCase();

    return `${dayName} • ${monthName} ${dayOfMonth}, ${yearText} • ${hourText}:${minuteText} ${ampm} ET`;
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const dayName = dayNames[d.getUTCDay()] ?? '';
  const monthName = monthNames[month - 1] ?? '';
  return `${dayName} • ${monthName} ${day}, ${year}`;
}

export function GameCard({
  game,
  logoOverrides,
  showWeekTag = false,
  density = 'expanded',
  awaySeed = null,
  homeSeed = null,
  injurySummary,
  onClick,
}: GameCardProps) {
  const compact = density === 'compact';
  const statusInfo = gameStatusDisplay(game.status, game.quarter, game.clock);
  const winner = gameWinner(game.home_score, game.away_score, game.status);
  const isScheduled = statusInfo.variant === 'scheduled';
  const leaders = game.leaders ?? [];

  const showOT = !!(game.home_score_ot || game.away_score_ot);
  const awayScores = [
    game.away_score_q1,
    game.away_score_q2,
    game.away_score_q3,
    game.away_score_q4,
  ];
  const homeScores = [
    game.home_score_q1,
    game.home_score_q2,
    game.home_score_q3,
    game.home_score_q4,
  ];
  if (showOT) {
    awayScores.push(game.away_score_ot ?? 0);
    homeScores.push(game.home_score_ot ?? 0);
  }
  const qLabels = ['Q1', 'Q2', 'Q3', 'Q4', ...(showOT ? ['OT'] : [])];

  const statusColor =
    statusInfo.variant === 'live'
      ? C.cyan
      : statusInfo.variant === 'final'
        ? C.textDim
        : C.textMuted;

  const colCount = qLabels.length;
  const gridCols = `64px repeat(${colCount}, 1fr)`;

  const awayLabel = teamLabel(game.away_team_detail);
  const homeLabel = teamLabel(game.home_team_detail);
  const weekTagText = weekLabel(game.week).toUpperCase();
  const awayTeamAbbr = game.away_team_detail.abbreviation;
  const homeTeamAbbr = game.home_team_detail.abbreviation;
  const awayFallbackLogoUrl = game.away_team_detail.logo_url ?? '';
  const homeFallbackLogoUrl = game.home_team_detail.logo_url ?? '';
  const awayLogoUrl = logoOverrides?.[awayTeamAbbr] ?? awayFallbackLogoUrl;
  const homeLogoUrl = logoOverrides?.[homeTeamAbbr] ?? homeFallbackLogoUrl;
  const gameDateTimeLabel = formatCardDateLabel(game.game_date, game.game_time);
  const spread = spreadLabel(game);
  const total = game.total != null ? formatOddsNumber(game.total) : null;
  const homeMoneyline = game.home_moneyline != null ? formatMoneyline(game.home_moneyline) : null;
  const awayMoneyline = game.away_moneyline != null ? formatMoneyline(game.away_moneyline) : null;
  const hasOdds = Boolean(spread || total || homeMoneyline || awayMoneyline);
  const restBadges = restBadgesByTeam(game);
  const leaderRows = LEADER_ROWS.map((row) => {
    const awayLeader = leaderForTeamCategory(leaders, awayTeamAbbr, row.category);
    const homeLeader = leaderForTeamCategory(leaders, homeTeamAbbr, row.category);
    return { ...row, awayLeader, homeLeader };
  }).filter((row) => row.awayLeader || row.homeLeader);

  const awayWinner = winner === 'away';
  const homeWinner = winner === 'home';
  const awayLoser = winner === 'home';
  const homeLoser = winner === 'away';

  return (
    <div
      className="hud-panel game-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{ borderWidth: 1.2 }}
    >
      {/* Header: status · date/time · broadcast/weather */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          alignItems: 'center',
          padding: '10px 16px 9px',
          borderBottom: `1px solid rgba(0,229,255,0.08)`,
          minHeight: 38,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 4, justifyItems: 'start', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontFamily: F.display,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: statusColor,
                ...(statusInfo.variant === 'live' && { textShadow: `0 0 10px ${C.cyan}88` }),
              }}
            >
              {statusInfo.variant === 'live' && (
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: C.cyan,
                    boxShadow: `0 0 6px ${C.cyan}`,
                    marginRight: 6,
                    verticalAlign: 'middle',
                    marginBottom: 1,
                  }}
                />
              )}
              {statusInfo.text}
            </span>
            {showWeekTag && (
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: C.cyan,
                  border: `1px solid rgba(0,229,255,0.28)`,
                  background: 'rgba(0,229,255,0.08)',
                  padding: '4px 7px',
                  borderRadius: 4,
                  textShadow: `0 0 8px ${C.cyan}44`,
                }}
              >
                {weekTagText}
              </span>
            )}
            {game.is_division_game && (
              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  padding: '4px 7px',
                  borderRadius: 4,
                  ...badgeToneStyle('cyan'),
                }}
              >
                DIVISION
              </span>
            )}
          </div>
          {restBadges.away.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {restBadges.away.map((badge, idx) => (
                <span
                  key={`away-${badge.label}-${idx}`}
                  style={{
                    fontFamily: F.display,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    padding: '4px 7px',
                    borderRadius: 4,
                    ...badgeToneStyle(badge.tone),
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            justifySelf: 'center',
            minWidth: 0,
            maxWidth: '100%',
            textAlign: 'center',
            display: 'grid',
            gap: 2,
          }}
        >
          {game.game_note && (
            <span
              style={{
                fontFamily: F.display,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                color: C.amber,
                textShadow: '0 0 8px rgba(255,177,0,0.26)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'inline-block',
                maxWidth: '100%',
              }}
              title={game.game_note}
            >
              {game.game_note}
            </span>
          )}
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: C.textDim,
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'inline-block',
              maxWidth: '100%',
            }}
            title={gameDateTimeLabel}
          >
            {gameDateTimeLabel}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gap: 4,
            justifySelf: 'end',
            justifyItems: 'end',
            minWidth: 0,
          }}
        >
          {(game.weather_temp != null || !!game.broadcast_network) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {game.weather_temp != null && (
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted }}>
                  {game.weather_temp}°{game.weather_condition ? ` ${game.weather_condition}` : ''}
                </span>
              )}
              {game.broadcast_network && (
                <span
                  style={{
                    fontFamily: F.display,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    color: C.textMuted,
                  }}
                >
                  {game.broadcast_network}
                </span>
              )}
            </div>
          )}
          {restBadges.home.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {restBadges.home.map((badge, idx) => (
                <span
                  key={`home-${badge.label}-${idx}`}
                  style={{
                    fontFamily: F.display,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    padding: '4px 7px',
                    borderRadius: 4,
                    ...badgeToneStyle(badge.tone),
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Matchup line: two-row identity layout for long team names */}
      <div style={{ padding: compact ? '10px 12px 10px' : '14px 16px 12px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${compact ? 'clamp(48px,13vw,68px)' : 'clamp(56px,16vw,84px)'} minmax(0,1fr) auto auto minmax(0,1fr) ${compact ? 'clamp(48px,13vw,68px)' : 'clamp(56px,16vw,84px)'}`,
            alignItems: 'center',
            columnGap: compact ? 8 : 12,
            rowGap: compact ? 3 : 6,
          }}
        >
          <div style={{ gridColumn: 1, gridRow: '1 / span 2', alignSelf: 'center' }}>
            <TeamLogo
              team={game.away_team_detail}
              logoUrl={awayLogoUrl}
              fallbackLogoUrl={awayFallbackLogoUrl}
              align="left"
              compact={compact}
              isWinner={awayWinner}
              isLoser={awayLoser}
            />
          </div>
          <div style={{ gridColumn: '2 / 3', gridRow: 1, minWidth: 0, alignSelf: 'start' }}>
            <TeamMeta
              name={awayLabel}
              record={game.away_record}
              seed={awaySeed}
              align="left"
              isDimmed={winner === 'home'}
              hasPossession={game.possession_team === game.away_team}
              compact={compact}
            />
          </div>
          <div style={{ gridColumn: 3, gridRow: 2, justifySelf: 'center', alignSelf: 'end' }}>
            <ScoreCell
              score={game.away_score}
              isWinner={awayWinner}
              isScheduled={isScheduled}
              compact={compact}
            />
          </div>
          <div style={{ gridColumn: 4, gridRow: 2, justifySelf: 'center', alignSelf: 'end' }}>
            <ScoreCell
              score={game.home_score}
              isWinner={homeWinner}
              isScheduled={isScheduled}
              compact={compact}
            />
          </div>
          <div
            style={{
              gridColumn: '3 / 5',
              gridRow: 1,
              justifySelf: 'center',
              alignSelf: 'center',
              fontFamily: F.display,
              fontSize: compact ? 10 : 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: C.textMuted,
            }}
          >
            AT
          </div>
          <div style={{ gridColumn: '5 / 6', gridRow: 1, minWidth: 0, alignSelf: 'start' }}>
            <TeamMeta
              name={homeLabel}
              record={game.home_record}
              seed={homeSeed}
              align="right"
              isDimmed={winner === 'away'}
              hasPossession={game.possession_team === game.home_team}
              compact={compact}
            />
          </div>
          <div style={{ gridColumn: 6, gridRow: '1 / span 2', alignSelf: 'center' }}>
            <TeamLogo
              team={game.home_team_detail}
              logoUrl={homeLogoUrl}
              fallbackLogoUrl={homeFallbackLogoUrl}
              align="right"
              compact={compact}
              isWinner={homeWinner}
              isLoser={homeLoser}
            />
          </div>
        </div>
      </div>

      {/* Quarter score breakdown */}
      {!isScheduled && !compact && (
        <div className="quarter-scores" style={{ gridTemplateColumns: gridCols }}>
          <span style={{ color: C.textMuted, fontSize: 10 }} />
          {qLabels.map((q) => (
            <span
              key={q}
              style={{
                color: C.textMuted,
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: '0.06em',
              }}
            >
              {q}
            </span>
          ))}

          <span
            style={{
              color: C.textDim,
              fontWeight: 700,
              fontSize: 11,
              textAlign: 'left',
              paddingLeft: 0,
            }}
          >
            {game.away_team_detail.abbreviation}
          </span>
          {awayScores.map((s, i) => (
            <span key={i} style={{ color: C.text, fontSize: 12 }}>
              {s}
            </span>
          ))}

          <span
            style={{
              color: C.textDim,
              fontWeight: 700,
              fontSize: 11,
              textAlign: 'left',
              paddingLeft: 0,
            }}
          >
            {game.home_team_detail.abbreviation}
          </span>
          {homeScores.map((s, i) => (
            <span key={i} style={{ color: C.text, fontSize: 12 }}>
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Odds + matchup context */}
      {(hasOdds || injurySummary || game.venue_name) && (
        <div
          style={{
            padding: compact ? '7px 12px 8px' : '8px 16px 10px',
            display: 'grid',
            gap: 8,
            borderTop: `1px solid rgba(0,229,255,0.06)`,
          }}
        >
          {game.venue_name && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <span
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  color: C.green,
                  letterSpacing: '0.05em',
                  textShadow: '0 0 6px rgba(0,230,118,0.2)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
                title={game.venue_name}
              >
                {game.venue_name}
              </span>
            </div>
          )}
          {hasOdds && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: compact ? 10 : 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {spread && (
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted }}>
                  SPREAD {spread}
                </span>
              )}
              {total && (
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted }}>
                  O/U {total}
                </span>
              )}
              {awayMoneyline && homeMoneyline && (
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.textMuted }}>
                  ML {game.away_team_detail.abbreviation} {awayMoneyline} ·{' '}
                  {game.home_team_detail.abbreviation} {homeMoneyline}
                </span>
              )}
            </div>
          )}
          {injurySummary && (injurySummary.awayCount > 0 || injurySummary.homeCount > 0) && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: compact ? 8 : 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: F.display,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: C.amber,
                  }}
                >
                  {game.away_team_detail.abbreviation} INJURY FLAGS
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: F.mono,
                    fontSize: 10,
                    color: C.textDim,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={
                    injurySummary.awayFlags.length > 0
                      ? injurySummary.awayFlags.join(' · ')
                      : `${injurySummary.awayCount} flagged`
                  }
                >
                  {injurySummary.awayFlags.length > 0
                    ? injurySummary.awayFlags.join(' · ')
                    : `${injurySummary.awayCount} flagged`}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: F.display,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    color: C.amber,
                    textAlign: 'right',
                  }}
                >
                  {game.home_team_detail.abbreviation} INJURY FLAGS
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: F.mono,
                    fontSize: 10,
                    color: C.textDim,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={
                    injurySummary.homeFlags.length > 0
                      ? injurySummary.homeFlags.join(' · ')
                      : `${injurySummary.homeCount} flagged`
                  }
                >
                  {injurySummary.homeFlags.length > 0
                    ? injurySummary.homeFlags.join(' · ')
                    : `${injurySummary.homeCount} flagged`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leaders */}
      {!compact && leaderRows.length > 0 && (
        <div style={{ paddingBottom: 6 }}>
          {leaderRows.map((row) => (
            <div
              key={row.category}
              className="leader-item"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) 126px minmax(0,1fr)',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: F.body,
                    fontSize: 13,
                    color: C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {row.awayLeader?.athlete_name ?? '—'}
                </div>
                {leaderValueLines(row.awayLeader?.display_value).map((line, idx) => (
                  <div
                    key={`${row.category}-away-${idx}`}
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: C.textDim,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: idx === 0 ? 0 : 2,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>

              <span
                style={{
                  fontFamily: F.display,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: C.textMuted,
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}
              >
                {row.label}
              </span>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: F.body,
                    fontSize: 13,
                    color: C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'right',
                  }}
                >
                  {row.homeLeader?.athlete_name ?? '—'}
                </div>
                {leaderValueLines(row.homeLeader?.display_value).map((line, idx) => (
                  <div
                    key={`${row.category}-home-${idx}`}
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: C.textDim,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textAlign: 'right',
                      marginTop: idx === 0 ? 0 : 2,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
