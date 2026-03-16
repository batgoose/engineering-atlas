'use client';

export type TransactionItem = {
  id: number;
  player_id: number | null;
  player_name: string | null;
  player_position: string | null;
  transaction_type: string;
  date: string;
  from_team_abbr: string | null;
  to_team_abbr: string | null;
  current_team_abbr: string | null;
  description: string;
  contract_apy: number | null;
  contract_years: number | null;
};

const TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  signed:    { color: 'var(--gs-green)',    bg: 'rgba(0, 230, 118, 0.12)' },
  released:  { color: 'var(--gs-red)',      bg: 'rgba(255, 59, 79, 0.12)' },
  waived:    { color: 'var(--gs-red)',      bg: 'rgba(255, 59, 79, 0.08)' },
  traded:    { color: 'var(--gs-amber)',    bg: 'rgba(255, 182, 18, 0.12)' },
  claimed:   { color: 'var(--gs-cyan)',     bg: 'rgba(0, 229, 255, 0.12)' },
  ir:        { color: 'var(--gs-text-dim)', bg: 'rgba(90, 122, 144, 0.1)' },
  signed_ps: { color: 'var(--gs-green)',    bg: 'rgba(0, 230, 118, 0.07)' },
  promoted:  { color: 'var(--gs-cyan)',     bg: 'rgba(0, 229, 255, 0.07)' },
};

function getTypeStyle(type: string) {
  return TYPE_COLORS[type] ?? { color: 'var(--gs-text-dim)', bg: 'rgba(90,122,144,0.08)' };
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TickerItem({ tx }: { tx: TransactionItem }) {
  const { color, bg } = getTypeStyle(tx.transaction_type);
  const teams =
    tx.from_team_abbr && tx.to_team_abbr
      ? `${tx.from_team_abbr} → ${tx.to_team_abbr}`
      : tx.to_team_abbr ?? tx.from_team_abbr ?? '';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        whiteSpace: 'nowrap',
        padding: '0 4px',
      }}
    >
      <span
        style={{
          background: bg,
          color,
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.05em',
          padding: '2px 6px',
          borderRadius: '3px',
          textTransform: 'uppercase',
        }}
      >
        {tx.transaction_type.replace('_', ' ')}
      </span>
      {tx.player_position && (
        <span
          style={{
            color: 'var(--gs-text-dim)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
          }}
        >
          {tx.player_position}
        </span>
      )}
      <span
        style={{
          color: 'var(--gs-text-bright)',
          fontFamily: 'var(--gs-font-body)',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {tx.player_name ?? 'Unknown'}
      </span>
      {teams && (
        <span
          style={{
            color: 'var(--gs-text)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '11px',
          }}
        >
          {teams}
        </span>
      )}
      <span
        style={{
          color: 'var(--gs-text-dim)',
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '10px',
        }}
      >
        {formatDate(tx.date)}
      </span>
      <span style={{ color: 'var(--gs-cyan-dim)', margin: '0 10px', fontSize: '10px' }}>·</span>
    </span>
  );
}

export default function TransactionTicker({
  transactions,
}: {
  transactions: TransactionItem[];
}) {
  if (!transactions.length) return null;

  // Duplicate for seamless loop
  const items = [...transactions, ...transactions];

  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        background: 'rgba(7, 11, 20, 0.85)',
        borderTop: '1px solid var(--gs-cyan-border)',
        borderBottom: '1px solid var(--gs-cyan-border)',
        height: '36px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <style>{`
        @keyframes gs-marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .gs-ticker-track {
          display: flex;
          align-items: center;
          gap: 8px;
          width: max-content;
          animation: gs-marquee 90s linear infinite;
          will-change: transform;
        }
        .gs-ticker-track:hover {
          animation-play-state: paused;
        }
      `}</style>
      <div className="gs-ticker-track">
        {items.map((tx, i) => (
          <TickerItem key={`${tx.id}-${i}`} tx={tx} />
        ))}
      </div>
    </div>
  );
}
