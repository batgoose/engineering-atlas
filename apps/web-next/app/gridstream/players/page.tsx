import Link from 'next/link';
import type { CSSProperties } from 'react';

const playerRows = [
  {
    player: 'Josh Allen',
    team: 'BUF',
    pos: 'QB',
    gp: 17,
    passYds: 4306,
    rushYds: 531,
    recYds: 0,
    fp: 372.9,
  },
  {
    player: "Ja'Marr Chase",
    team: 'CIN',
    pos: 'WR',
    gp: 17,
    passYds: 0,
    rushYds: 42,
    recYds: 1589,
    fp: 318.4,
  },
  {
    player: 'Christian McCaffrey',
    team: 'SF',
    pos: 'RB',
    gp: 16,
    passYds: 0,
    rushYds: 1459,
    recYds: 564,
    fp: 356.6,
  },
  {
    player: 'Tyreek Hill',
    team: 'MIA',
    pos: 'WR',
    gp: 17,
    passYds: 0,
    rushYds: 14,
    recYds: 1717,
    fp: 335.2,
  },
  {
    player: 'CeeDee Lamb',
    team: 'DAL',
    pos: 'WR',
    gp: 17,
    passYds: 0,
    rushYds: 113,
    recYds: 1749,
    fp: 352.7,
  },
];

export default function GridstreamPlayersPage() {
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
              GRIDSTREAM / PLAYERS
            </div>
            <h1
              style={{
                margin: '10px 0 0',
                fontSize: 'clamp(24px, 3.3vw, 40px)',
                letterSpacing: '.03em',
              }}
            >
              Player Database
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
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, color: '#75a1bf', letterSpacing: '.08em' }}>
            Scaffolded view for season-to-season player tracking. Week splits, career rollups, and
            matchup filters will plug into this table.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button style={chipStyle}>2025 SEASON</button>
            <button style={chipStyle}>ALL WEEKS</button>
            <button style={chipStyle}>ALL POSITIONS</button>
            <button style={chipStyle}>MIN GAMES: 8</button>
          </div>
        </section>

        <section
          style={{
            border: '1px solid rgba(0,229,255,.2)',
            background: 'rgba(0,18,38,.56)',
            overflowX: 'auto',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
            <thead>
              <tr>
                {[
                  'PLAYER',
                  'TEAM',
                  'POS',
                  'GP',
                  'PASS YDS',
                  'RUSH YDS',
                  'REC YDS',
                  'FANTASY PTS',
                ].map((label) => (
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
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {playerRows.map((row) => (
                <tr key={row.player}>
                  <td style={cellPrimary}>{row.player}</td>
                  <td style={cellMono}>{row.team}</td>
                  <td style={cellMono}>{row.pos}</td>
                  <td style={cellMono}>{row.gp}</td>
                  <td style={cellMono}>{row.passYds.toLocaleString()}</td>
                  <td style={cellMono}>{row.rushYds.toLocaleString()}</td>
                  <td style={cellMono}>{row.recYds.toLocaleString()}</td>
                  <td style={cellMono}>{row.fp.toFixed(1)}</td>
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
          Next build targets: per-player profile route, weekly trend sparkline, injury/status chips,
          and headshot history by team-season.
        </section>
      </div>
    </main>
  );
}

const chipStyle: CSSProperties = {
  border: '1px solid rgba(0,229,255,.24)',
  background: 'rgba(0,229,255,.08)',
  color: '#d6f6ff',
  fontFamily: "'Orbitron', monospace",
  fontSize: 11,
  letterSpacing: '.08em',
  padding: '7px 10px',
  cursor: 'default',
};

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
