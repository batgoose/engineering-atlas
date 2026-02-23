import Link from 'next/link';
import type { CSSProperties } from 'react';

const standingsRows = [
  { team: 'Kansas City Chiefs', record: '14-3', pf: 421, pa: 287, ppg: 24.8, dppg: 16.9 },
  { team: 'San Francisco 49ers', record: '13-4', pf: 471, pa: 298, ppg: 27.7, dppg: 17.5 },
  { team: 'Baltimore Ravens', record: '13-4', pf: 443, pa: 279, ppg: 26.1, dppg: 16.4 },
  { team: 'Detroit Lions', record: '12-5', pf: 461, pa: 395, ppg: 27.1, dppg: 23.2 },
  { team: 'Buffalo Bills', record: '11-6', pf: 451, pa: 311, ppg: 26.5, dppg: 18.3 },
];

const trendCards = [
  { label: 'Top Offense', value: '49ers · 7.1 yds/play', tone: '#00e5ff' },
  { label: 'Top Defense', value: 'Ravens · 4.7 yds/play allowed', tone: '#8fff45' },
  { label: 'Best Red Zone', value: 'Bills · 67% TD conversion', tone: '#ffb612' },
  { label: 'Best 3rd Down D', value: 'Chiefs · 33% allowed', tone: '#ff627e' },
];

export default function GridstreamTeamsPage() {
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
              GRIDSTREAM / TEAMS
            </div>
            <h1
              style={{
                margin: '10px 0 0',
                fontSize: 'clamp(24px, 3.3vw, 40px)',
                letterSpacing: '.03em',
              }}
            >
              Team Database
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
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
          }}
        >
          {trendCards.map((card) => (
            <article
              key={card.label}
              style={{
                border: '1px solid rgba(0,229,255,.2)',
                background: 'rgba(0,18,38,.62)',
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  color: '#6f9ab8',
                  fontSize: 11,
                  letterSpacing: '.09em',
                  fontFamily: "'Orbitron', monospace",
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  marginTop: 8,
                  color: card.tone,
                  fontSize: 16,
                  fontWeight: 700,
                  lineHeight: 1.25,
                }}
              >
                {card.value}
              </div>
            </article>
          ))}
        </section>

        <section
          style={{
            border: '1px solid rgba(0,229,255,.2)',
            background: 'rgba(0,18,38,.56)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                {['TEAM', 'RECORD', 'PF', 'PA', 'PPG', 'DPPG'].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '1px solid rgba(0,229,255,.15)',
                      color: '#78a3c1',
                      fontSize: 11,
                      letterSpacing: '.09em',
                      fontFamily: "'Orbitron', monospace",
                      fontWeight: 700,
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standingsRows.map((row) => (
                <tr key={row.team}>
                  <td style={cellPrimary}>{row.team}</td>
                  <td style={cellMono}>{row.record}</td>
                  <td style={cellMono}>{row.pf}</td>
                  <td style={cellMono}>{row.pa}</td>
                  <td style={cellMono}>{row.ppg.toFixed(1)}</td>
                  <td style={cellMono}>{row.dppg.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          Next build targets: franchise pages, yearly split explorer, EPA/efficiency trend lines,
          and roster continuity tracking.
        </section>
      </div>
    </main>
  );
}

const cellPrimary: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.07)',
  color: '#e8f5ff',
  fontSize: 15,
};

const cellMono: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(0,229,255,.07)',
  color: '#9fc3db',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 12,
  whiteSpace: 'nowrap',
};
