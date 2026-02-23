'use client';

/**
 * Personnel tab (team leaders).
 *
 * Expects already-derived leader strings in `leaders.{away,home}` and renders
 * them side-by-side with a stable three-category layout.
 */

import type { HudTeam, LeaderSet } from '@atlas/sdk/gridstream/types';
import { gridstreamColors as C, gridstreamFonts as F } from '@atlas/sdk/gridstream/theme';
import { TeamBadge } from './ScoreBug';

interface LeadersPanelProps {
  leaders: { away: LeaderSet; home: LeaderSet };
  away: HudTeam;
  home: HudTeam;
}

export function LeadersPanel({ leaders, away, home }: LeadersPanelProps) {
  const cats: (keyof LeaderSet)[] = ['passing', 'rushing', 'receiving'];

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
          {cats.map((cat) => (
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
