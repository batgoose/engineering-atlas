import Link from 'next/link';

export type StandingApiItem = {
  season: number;
  team: {
    id: number;
    abbreviation: string;
    display_name: string;
  };
  conference: string;
  division: string;
  wins: number;
  losses: number;
  ties: number;
  div_rank: number;
};

function divLetter(division: string): string {
  const lower = division.toLowerCase();
  if (lower.includes('east')) return 'E';
  if (lower.includes('north')) return 'N';
  if (lower.includes('south')) return 'S';
  if (lower.includes('west')) return 'W';
  return '?';
}

function record(s: StandingApiItem) {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

export default function HubStandings({ standings }: { standings: StandingApiItem[] }) {
  const leaders = standings
    .filter((s) => s.div_rank === 1)
    .sort((a, b) => {
      // AFC before NFC, then E/N/S/W
      if (a.conference !== b.conference) return a.conference < b.conference ? -1 : 1;
      const order = ['E', 'N', 'S', 'W'];
      return order.indexOf(divLetter(a.division)) - order.indexOf(divLetter(b.division));
    });

  return (
    <div
      style={{
        background: 'rgba(10, 16, 32, 0.6)',
        border: '1px solid var(--gs-cyan-border)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--gs-cyan-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="hud-label" style={{ fontSize: '11px' }}>
          2025 Division Leaders
        </span>
        <Link
          href="/gridstream/teams"
          style={{
            color: 'var(--gs-cyan-dim)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
            textDecoration: 'none',
          }}
        >
          Full standings →
        </Link>
      </div>

      {leaders.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            color: 'var(--gs-text-dim)',
            fontSize: '13px',
            textAlign: 'center',
          }}
        >
          No standings data
        </div>
      ) : (
        <div>
          {leaders.map((s) => {
            const isAfc = s.conference === 'AFC';
            const confColor = isAfc ? 'var(--gs-cyan)' : 'var(--gs-amber)';
            return (
              <div
                key={s.team.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '44px 1fr auto',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '7px 14px',
                  borderBottom: '1px solid rgba(0,229,255,0.05)',
                }}
              >
                {/* Conference + division badge */}
                <span
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: '9px',
                    fontWeight: 700,
                    color: confColor,
                    letterSpacing: '0.04em',
                    opacity: 0.8,
                  }}
                >
                  {s.conference}·{divLetter(s.division)}
                </span>

                {/* Team abbreviation */}
                <span
                  style={{
                    fontFamily: 'var(--gs-font-body)',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--gs-text-bright)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {s.team.abbreviation}
                </span>

                {/* Record */}
                <span
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: '12px',
                    color: 'var(--gs-text)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {record(s)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
