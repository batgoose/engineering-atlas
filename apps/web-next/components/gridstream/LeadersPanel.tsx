'use client';

/**
 * Personnel tab (team leaders).
 *
 * Expects already-derived leader strings in `leaders.{away,home}` and renders
 * them side-by-side with a stable three-category layout.
 */

import { useEffect, useMemo, useState } from 'react';
import type { HudTeam, LeaderSet } from '@atlas/sdk/gridstream/types';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

interface LeadersPanelProps {
  leaders: { away: LeaderSet; home: LeaderSet };
  away: HudTeam;
  home: HudTeam;
  season?: number;
  week?: number;
  gameId?: string;
}

type AdvancedPlayerData = {
  ngs_passing: Record<string, number> | null;
  ngs_rushing: Record<string, number> | null;
  ngs_receiving: Record<string, number> | null;
} | null;

type LeaderCategory = keyof LeaderSet;
const LEADER_CATEGORIES: LeaderCategory[] = ['passing', 'rushing', 'receiving'];

function toFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatSigned(value: number, decimals = 1): string {
  const rounded = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)}`;
}

function buildNgsLine(category: LeaderCategory, advanced: AdvancedPlayerData): string | null {
  if (!advanced) return null;
  if (category === 'passing') {
    const cpoe = toFinite(advanced.ngs_passing?.completion_percentage_above_expectation);
    const timeToThrow = toFinite(advanced.ngs_passing?.avg_time_to_throw);
    const parts: string[] = [];
    if (cpoe != null) parts.push(`CPOE ${formatSigned(cpoe)}%`);
    if (timeToThrow != null) parts.push(`TTT ${timeToThrow.toFixed(2)}s`);
    return parts.length > 0 ? `NGS ${parts.join(' · ')}` : null;
  }
  if (category === 'rushing') {
    const efficiency = toFinite(advanced.ngs_rushing?.efficiency);
    const timeToLos = toFinite(advanced.ngs_rushing?.avg_time_to_los);
    const parts: string[] = [];
    if (efficiency != null) parts.push(`EFF ${formatSigned(efficiency, 2)}`);
    if (timeToLos != null) parts.push(`TLOS ${timeToLos.toFixed(2)}s`);
    return parts.length > 0 ? `NGS ${parts.join(' · ')}` : null;
  }
  const separation = toFinite(advanced.ngs_receiving?.avg_separation);
  const yac = toFinite(advanced.ngs_receiving?.avg_yac_above_expectation);
  const parts: string[] = [];
  if (separation != null) parts.push(`SEP ${separation.toFixed(1)} yds`);
  if (yac != null) parts.push(`YAC+ ${formatSigned(yac)}`);
  return parts.length > 0 ? `NGS ${parts.join(' · ')}` : null;
}

function cacheKey(season: number, week: number, gameId: string, gsisId: string): string {
  return `${season}-${week}-${gameId}-${gsisId}`;
}

export function LeadersPanel({ leaders, away, home, season, week, gameId }: LeadersPanelProps) {
  const [advancedByKey, setAdvancedByKey] = useState<Record<string, AdvancedPlayerData>>({});

  const leaderRequests = useMemo(() => {
    const requests: Array<{ key: string; gsisId: string }> = [];
    if (!season || !week || !gameId) return requests;
    const collect = (set: LeaderSet) => {
      for (const cat of LEADER_CATEGORIES) {
        const gsisId = set[cat].gsisId?.trim();
        if (!gsisId) continue;
        const key = cacheKey(season, week, gameId, gsisId);
        requests.push({ key, gsisId });
      }
    };
    collect(leaders.away);
    collect(leaders.home);
    const deduped = new Map<string, { key: string; gsisId: string }>();
    for (const req of requests) {
      if (!deduped.has(req.key)) deduped.set(req.key, req);
    }
    return [...deduped.values()];
  }, [gameId, leaders.away, leaders.home, season, week]);

  useEffect(() => {
    if (!season || !week || !gameId) return;
    const pending = leaderRequests.filter((request) => !(request.key in advancedByKey));
    if (pending.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      pending.map(async (request) => {
        try {
          const params = new URLSearchParams({
            gsis_id: request.gsisId,
            season: String(season),
            week: String(week),
            game_id: String(gameId),
          });
          const res = await fetch(`${API_BASE}/players/advanced/?${params.toString()}`, {
            signal: ctrl.signal,
            cache: 'no-store',
          });
          if (!res.ok) return { key: request.key, value: null as AdvancedPlayerData };
          const data = (await res.json()) as AdvancedPlayerData;
          return { key: request.key, value: data };
        } catch {
          return { key: request.key, value: null as AdvancedPlayerData };
        }
      })
    ).then((rows) => {
      if (ctrl.signal.aborted) return;
      setAdvancedByKey((prev) => {
        const next = { ...prev };
        for (const row of rows) next[row.key] = row.value;
        return next;
      });
    });
    return () => ctrl.abort();
  }, [advancedByKey, gameId, leaderRequests, season, week]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {[
        { team: away, data: leaders.away },
        { team: home, data: leaders.home },
      ].map(({ team, data }, idx) => (
        <div
          key={team.abbr}
          style={{ padding: 20, borderRight: idx === 0 ? `1px solid rgba(0,229,255,.05)` : 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <TeamBadge team={team} size={26} hasPossession={false} />
            <span
              style={{
                fontFamily: F.body,
                fontWeight: 700,
                fontSize: 16,
                color: C.textBright,
                letterSpacing: '.04em',
              }}
            >
              {team.displayName}
            </span>
          </div>
          {LEADER_CATEGORIES.map((cat) => (
            <div
              key={cat}
              style={{ padding: '10px 0', borderBottom: `1px solid rgba(0,229,255,.04)` }}
            >
              <span className="hud-label" style={{ display: 'block', marginBottom: 6 }}>
                {cat.toUpperCase()}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <LeaderHeadshot
                  name={data[cat].name}
                  teamColor={team.color}
                  headshotUrl={data[cat].headshotUrl}
                />
                <div>
                  <div
                    style={{
                      fontFamily: F.body,
                      fontWeight: 600,
                      fontSize: 15,
                      color: C.textBright,
                    }}
                  >
                    {data[cat].name}
                  </div>
                  <div style={{ fontSize: 12, color: C.text, marginTop: 2 }}>{data[cat].line}</div>
                  {(() => {
                    const gsisId = data[cat].gsisId?.trim();
                    if (!gsisId || !season || !week || !gameId) return null;
                    const key = cacheKey(season, week, gameId, gsisId);
                    const ngsLine = buildNgsLine(cat, advancedByKey[key] ?? null);
                    if (!ngsLine) return null;
                    return (
                      <div
                        style={{
                          marginTop: 3,
                          fontFamily: F.mono,
                          fontSize: 10,
                          color: C.cyanDim,
                          letterSpacing: '.05em',
                        }}
                      >
                        {ngsLine}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LeaderHeadshot({
  name,
  teamColor,
  headshotUrl,
}: {
  name: string;
  teamColor: string;
  headshotUrl?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        flexShrink: 0,
        background: `linear-gradient(135deg, #${teamColor}40, #${teamColor}15)`,
        border: `1px solid ${C.panelBorder}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={headshotUrl}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <span
          style={{
            fontFamily: F.display,
            fontSize: 13,
            fontWeight: 700,
            color: C.textMuted,
            lineHeight: 1,
          }}
        >
          {initial}
        </span>
      )}
    </span>
  );
}
