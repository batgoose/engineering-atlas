import Link from 'next/link';

const TOP_PICKS = [
  { pick: 1, abbr: 'LV',  name: 'Las Vegas Raiders',    record: '3-14' },
  { pick: 2, abbr: 'NYJ', name: 'New York Jets',         record: '3-14' },
  { pick: 3, abbr: 'ARI', name: 'Arizona Cardinals',     record: '3-14' },
  { pick: 4, abbr: 'TEN', name: 'Tennessee Titans',      record: '3-14' },
  { pick: 5, abbr: 'NYG', name: 'New York Giants',       record: '4-13' },
  { pick: 6, abbr: 'CLE', name: 'Cleveland Browns',      record: '5-12' },
  { pick: 7, abbr: 'WAS', name: 'Washington Commanders', record: '5-12' },
  { pick: 8, abbr: 'NO',  name: 'New Orleans Saints',    record: '6-11' },
] as const;

function logoUrl(abbr: string) {
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
}

export default function HubDraftOrder({ season = 2026 }: { season?: number }) {
  return (
    <div
      style={{
        background: 'rgba(10, 16, 32, 0.6)',
        border: '1px solid var(--gs-cyan-border)',
        borderRadius: '4px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
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
          flexShrink: 0,
        }}
      >
        <span className="hud-label" style={{ fontSize: '11px' }}>
          {season} Draft Order
        </span>
        <Link
          href="/gridstream/draft"
          style={{ color: 'var(--gs-cyan-dim)', fontFamily: 'var(--gs-font-mono)', fontSize: '10px', textDecoration: 'none' }}
        >
          Full board →
        </Link>
      </div>

      {/* Pick rows — flex stretch to fill height */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {TOP_PICKS.map((pick) => (
          <Link
            key={pick.pick}
            href={`/gridstream/teams/${pick.abbr.toLowerCase()}`}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, textDecoration: 'none', color: 'inherit' }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 30px 1fr auto',
                alignItems: 'center',
                gap: '10px',
                padding: '0 14px',
                borderBottom: '1px solid rgba(0,229,255,0.05)',
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* Pick number */}
              <span
                style={{
                  fontFamily: 'var(--gs-font-mono)',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: pick.pick <= 3 ? 'var(--gs-amber)' : 'var(--gs-text-dim)',
                  textAlign: 'center',
                }}
              >
                {pick.pick}
              </span>

              {/* Team logo */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl(pick.abbr)}
                alt={pick.name}
                width={26}
                height={26}
                style={{ objectFit: 'contain', display: 'block' }}
              />

              {/* Team name */}
              <span
                style={{
                  fontFamily: 'var(--gs-font-body)',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--gs-text-bright)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {pick.name}
              </span>

              {/* 2025 record */}
              <span
                style={{
                  fontFamily: 'var(--gs-font-mono)',
                  fontSize: '11px',
                  color: 'var(--gs-text-dim)',
                  whiteSpace: 'nowrap',
                }}
              >
                {pick.record}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
