import Link from 'next/link';
import type { TransactionItem } from './TransactionTicker';

const TYPE_COLORS: Record<string, string> = {
  signed: 'var(--gs-green)',
  released: 'var(--gs-red)',
  waived: 'var(--gs-red)',
  traded: 'var(--gs-amber)',
  claimed: 'var(--gs-cyan)',
  ir: 'var(--gs-text-dim)',
  signed_ps: 'var(--gs-green)',
  promoted: 'var(--gs-cyan)',
};

const POS_COLORS: Record<string, string> = {
  QB: '#60a5fa',
  RB: '#34d399',
  WR: '#a78bfa',
  TE: '#fbbf24',
  OL: '#94a3b8',
  DL: '#f87171',
  LB: '#fb923c',
  DB: '#38bdf8',
  K: '#e879f9',
  P: '#e879f9',
};

function posColor(pos: string | null) {
  if (!pos) return 'var(--gs-text-dim)';
  const group =
    pos.startsWith('O') && pos.length > 1
      ? 'OL'
      : pos.startsWith('D') && pos.length > 1
        ? 'DL'
        : pos;
  return POS_COLORS[group] ?? 'var(--gs-text-dim)';
}

function formatContract(apy: number | null, years: number | null): string | null {
  if (!apy && !years) return null;
  const parts: string[] = [];
  if (years) parts.push(`${years}yr`);
  if (apy) parts.push(`$${(apy / 1_000_000).toFixed(1)}m`);
  return parts.join(' · ');
}

function typeLabel(t: string) {
  return t.replace('_', ' ').toUpperCase();
}

export default function HubRecentMoves({ transactions }: { transactions: TransactionItem[] }) {
  const rows = transactions.slice(0, 6);

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
          Recent Roster Moves
        </span>
        <Link
          href="/gridstream/free-agents"
          style={{
            color: 'var(--gs-cyan-dim)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
            textDecoration: 'none',
          }}
        >
          View all →
        </Link>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            color: 'var(--gs-text-dim)',
            fontSize: '13px',
            textAlign: 'center',
            flex: 1,
          }}
        >
          No recent moves
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {rows.map((tx) => {
            const contract = formatContract(tx.contract_apy, tx.contract_years);
            const typeColor = TYPE_COLORS[tx.transaction_type] ?? 'var(--gs-text-dim)';
            // current_team_abbr is authoritative for destination.
            // The "came from" team is whichever stored team differs from the destination.
            const dest = tx.current_team_abbr ?? tx.to_team_abbr;
            const storedOther = tx.from_team_abbr !== dest ? tx.from_team_abbr : tx.to_team_abbr;
            const prev = storedOther !== dest ? storedOther : null;

            const row = (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '30px 1fr auto',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '0 14px',
                  borderBottom: '1px solid rgba(0,229,255,0.05)',
                  flex: 1,
                  minHeight: 0,
                }}
              >
                {/* New team logo */}
                {dest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://a.espncdn.com/i/teamlogos/nfl/500/${dest.toLowerCase()}.png`}
                    alt={dest}
                    width={26}
                    height={26}
                    style={{ objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: 26, height: 26 }} />
                )}

                {/* Player name + position badge inline */}
                <div style={{ minWidth: 0, padding: '9px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                    <span
                      style={{
                        color: 'var(--gs-text-bright)',
                        fontFamily: 'var(--gs-font-body)',
                        fontSize: '13px',
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.3,
                        flex: '0 1 auto',
                        minWidth: 0,
                      }}
                    >
                      {tx.player_name ?? 'Unknown'}
                    </span>
                    <span
                      style={{
                        background: `${posColor(tx.player_position)}1a`,
                        color: posColor(tx.player_position),
                        fontFamily: 'var(--gs-font-mono)',
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '1px 3px',
                        borderRadius: '3px',
                        letterSpacing: '0.02em',
                        flexShrink: 0,
                      }}
                    >
                      {tx.player_position ?? '—'}
                    </span>
                  </div>

                  {/* Transaction type + team movement */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}
                  >
                    <span
                      style={{
                        color: typeColor,
                        fontFamily: 'var(--gs-font-mono)',
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {typeLabel(tx.transaction_type)}
                    </span>
                    {(prev || dest) && (
                      <span
                        style={{
                          color: 'var(--gs-text-dim)',
                          fontFamily: 'var(--gs-font-mono)',
                          fontSize: '9px',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {prev && dest ? `${prev} → ${dest}` : dest ? `→ ${dest}` : prev}
                      </span>
                    )}
                  </div>
                </div>

                {/* Contract — right column */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {contract ? (
                    <div
                      style={{
                        color: 'var(--gs-amber)',
                        fontFamily: 'var(--gs-font-mono)',
                        fontSize: '11px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        lineHeight: 1.3,
                      }}
                    >
                      {contract}
                    </div>
                  ) : (
                    <span
                      style={{
                        color: 'rgba(90,122,144,0.35)',
                        fontFamily: 'var(--gs-font-mono)',
                        fontSize: '10px',
                      }}
                    >
                      —
                    </span>
                  )}
                </div>
              </div>
            );

            return tx.player_id ? (
              <Link
                key={tx.id}
                href={`/gridstream/players/${tx.player_id}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  textDecoration: 'none',
                  color: 'inherit',
                  flex: 1,
                }}
              >
                {row}
              </Link>
            ) : (
              <div key={tx.id} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {row}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
