import Link from 'next/link';
import type { CSSProperties } from 'react';

const weeklyLeaders = [
  { rank: 1, player: 'Christian McCaffrey', team: 'SF', week: 'Wk 12', points: 38.7 },
  { rank: 2, player: 'Tyreek Hill', team: 'MIA', week: 'Wk 12', points: 35.2 },
  { rank: 3, player: 'CeeDee Lamb', team: 'DAL', week: 'Wk 12', points: 33.9 },
  { rank: 4, player: 'Josh Allen', team: 'BUF', week: 'Wk 12', points: 31.6 },
  { rank: 5, player: 'Amon-Ra St. Brown', team: 'DET', week: 'Wk 12', points: 30.1 },
];

const integrationRows = [
  { source: 'Yahoo Fantasy', status: 'Planned', detail: 'OAuth + roster sync + matchup ingest' },
  { source: 'ESPN Fantasy', status: 'Backlog', detail: 'League mapping + scoring profile import' },
  { source: 'Sleeper', status: 'Backlog', detail: 'Public league pull + player ownership trends' },
];

export default function GridstreamFantasyPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#050c18',
        color: '#d9ecf9',
        padding: '34px 20px 46px',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                color: '#00e5ff',
                fontSize: 13,
                letterSpacing: '.14em',
                fontFamily: "'Orbitron', monospace",
                fontWeight: 700,
              }}
            >
              GRIDSTREAM / FANTASY
            </div>
            <h1
              style={{
                margin: '10px 0 0',
                fontSize: 'clamp(24px, 3.3vw, 40px)',
                letterSpacing: '.03em',
              }}
            >
              Fantasy Command
            </h1>
          </div>
          <Link
            href="/gridstream"
            style={{
              color: '#63dfff',
              textDecoration: 'none',
              fontSize: 12,
              letterSpacing: '.08em',
            }}
          >
            ← BACK TO GRIDSTREAM HUB
          </Link>
        </div>

        <section
          style={{
            border: '1px solid rgba(0,229,255,.2)',
            background: 'rgba(0,18,38,.62)',
            padding: '14px 16px',
            color: '#85aac4',
            fontSize: 13,
          }}
        >
          Scaffolding in place for fantasy-first views: weekly leaderboards, scoring-mode toggles,
          waiver watchlists, and cross-league matchup cards.
        </section>

        <section
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          }}
        >
          <article
            style={{
              border: '1px solid rgba(0,229,255,.2)',
              background: 'rgba(0,18,38,.56)',
              overflowX: 'auto',
            }}
          >
            <div style={panelHeaderStyle}>WEEKLY TOP SCORES</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr>
                  {['RK', 'PLAYER', 'TEAM', 'WEEK', 'PPR PTS'].map((label) => (
                    <th key={label} style={thStyle}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyLeaders.map((row) => (
                  <tr key={`${row.rank}-${row.player}`}>
                    <td style={tdMono}>{row.rank}</td>
                    <td style={tdPrimary}>{row.player}</td>
                    <td style={tdMono}>{row.team}</td>
                    <td style={tdMono}>{row.week}</td>
                    <td style={tdMono}>{row.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article
            style={{ border: '1px solid rgba(0,229,255,.2)', background: 'rgba(0,18,38,.56)' }}
          >
            <div style={panelHeaderStyle}>INTEGRATION STATUS</div>
            <div style={{ display: 'grid', gap: 8, padding: '10px 12px' }}>
              {integrationRows.map((row) => (
                <div
                  key={row.source}
                  style={{
                    border: '1px solid rgba(0,229,255,.14)',
                    padding: '8px 10px',
                    background: 'rgba(0,14,30,.55)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#dff3ff', fontWeight: 700, fontSize: 13 }}>
                      {row.source}
                    </span>
                    <span
                      style={{
                        color: row.status === 'Planned' ? '#ffb612' : '#5f88a7',
                        border: `1px solid ${row.status === 'Planned' ? 'rgba(255,182,18,.35)' : 'rgba(95,136,167,.35)'}`,
                        fontSize: 10,
                        letterSpacing: '.08em',
                        padding: '2px 6px',
                      }}
                    >
                      {row.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#84a9c2', lineHeight: 1.3 }}>
                    {row.detail}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section
          style={{
            border: '1px solid rgba(0,229,255,.16)',
            background: 'rgba(0,14,30,.56)',
            padding: '12px 14px',
            fontSize: 13,
            color: '#89aac1',
          }}
        >
          Next build targets: league selector, roster starter recommendations, schedule-aware
          matchup planner, and rest-of-season trend widgets.
        </section>
      </div>
    </main>
  );
}

const panelHeaderStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.15)',
  color: '#78a3c1',
  fontSize: 11,
  letterSpacing: '.09em',
  fontFamily: "'Orbitron', monospace",
  fontWeight: 700,
};

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.15)',
  color: '#78a3c1',
  fontSize: 11,
  letterSpacing: '.09em',
  fontFamily: "'Orbitron', monospace",
  fontWeight: 700,
};

const tdPrimary: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.07)',
  color: '#e8f5ff',
  fontSize: 15,
};

const tdMono: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.07)',
  color: '#9fc3db',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  whiteSpace: 'nowrap',
};
