'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import PlayerQuickViewDrawer from '@/components/gridstream/PlayerQuickViewDrawer';
import type { TransactionItem } from '@/components/gridstream/TransactionTicker';

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api').replace(/\/$/, '').replace(/\/api(\/gridstream)?$/, '') + '/api/gridstream'
    : 'http://localhost:8000/api/gridstream';

const TX_TYPES = [
  { key: '', label: 'All' },
  { key: 'signed', label: 'Signed' },
  { key: 'traded', label: 'Traded' },
  { key: 'released', label: 'Released' },
  { key: 'waived', label: 'Waived' },
  { key: 'claimed', label: 'Claimed' },
  { key: 'ir', label: 'IR' },
  { key: 'signed_ps', label: 'Prac. Squad' },
  { key: 'promoted', label: 'Promoted' },
] as const;

const POSITIONS = [
  { key: '', label: 'All' },
  { key: 'QB', label: 'QB' },
  { key: 'RB', label: 'RB' },
  { key: 'WR', label: 'WR' },
  { key: 'TE', label: 'TE' },
  { key: 'OL', label: 'OL' },
  { key: 'DL', label: 'DL' },
  { key: 'LB', label: 'LB' },
  { key: 'DB', label: 'DB' },
  { key: 'K', label: 'K/P' },
] as const;

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
  QB: '#60a5fa', RB: '#34d399', WR: '#a78bfa', TE: '#fbbf24',
  OL: '#94a3b8', DL: '#f87171', LB: '#fb923c', DB: '#38bdf8',
  K: '#e879f9', P: '#e879f9',
};

const PAGE_SIZE = 50;

function posGroup(pos: string | null): string {
  if (!pos) return '';
  if ((pos.startsWith('O') || pos === 'T' || pos === 'G' || pos === 'C' || pos === 'LS') && pos !== 'OLB') return 'OL';
  if (pos.startsWith('D') && pos.length > 1 && pos !== 'DB') return 'DL';
  if (pos === 'CB' || pos === 'SS' || pos === 'FS' || pos === 'S') return 'DB';
  if (pos === 'ILB' || pos === 'OLB' || pos === 'MLB') return 'LB';
  if (pos === 'P') return 'K';
  return pos;
}

function posColor(pos: string | null): string {
  const g = posGroup(pos);
  return POS_COLORS[g] ?? POS_COLORS[pos ?? ''] ?? 'var(--gs-text-dim)';
}

function formatContract(apy: number | null, years: number | null): string | null {
  if (!apy && !years) return null;
  const parts: string[] = [];
  if (years) parts.push(`${years}yr`);
  if (apy) parts.push(`$${(apy / 1_000_000).toFixed(1)}m`);
  return parts.join(' · ');
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function typeLabel(t: string) {
  return t.replace('_', ' ').toUpperCase();
}

export default function FreeAgentsPage() {
  const [txType, setTxType] = useState('');
  const [position, setPosition] = useState('');
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (type: string, pos: string, pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ordering: '-date', limit: String(PAGE_SIZE) });
      if (type) params.set('transaction_type', type);
      if (pos) params.set('position', pos);
      if (pg > 1) params.set('page', String(pg));
      const res = await fetch(`${API_BASE}/transactions/?${params}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      setTransactions(data.results ?? []);
      setTotal(data.count ?? 0);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions(txType, position, page);
  }, [txType, position, page, fetchTransactions]);

  const handleTypeChange = (t: string) => { setTxType(t); setPage(1); };
  const handlePosChange = (p: string) => { setPosition(p); setPage(1); };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gs-bg)', color: 'var(--gs-text)', paddingBottom: '48px' }}>
      {/* Player drawer */}
      <PlayerQuickViewDrawer
        apiBase={API_BASE}
        playerId={openPlayerId}
        open={openPlayerId !== null}
        onClose={() => setOpenPlayerId(null)}
      />

      {/* Page header */}
      <div style={{ borderBottom: '1px solid var(--gs-cyan-border)', padding: '20px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px' }}>
          <Link
            href="/gridstream"
            style={{
              fontFamily: 'var(--gs-font-display)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: 'var(--gs-cyan-dim)',
              textDecoration: 'none',
              textTransform: 'uppercase',
            }}
          >
            ← Gridstream
          </Link>
          <span
            style={{
              fontFamily: 'var(--gs-font-display)',
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: 'var(--gs-text-bright)',
              textTransform: 'uppercase',
            }}
          >
            Free Agent Tracker
          </span>
          {!loading && (
            <span style={{ fontFamily: 'var(--gs-font-mono)', fontSize: '11px', color: 'var(--gs-text-muted)' }}>
              {total.toLocaleString()} transactions
            </span>
          )}
        </div>

        {/* Type filter tabs */}
        <nav style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
          {TX_TYPES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handleTypeChange(key)}
              style={{
                fontFamily: 'var(--gs-font-display)',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '0 16px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                background: 'none',
                border: 'none',
                borderBottom: txType === key ? '2px solid var(--gs-cyan)' : '2px solid transparent',
                color: txType === key ? 'var(--gs-cyan)' : 'rgba(180,220,235,0.65)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Position filter */}
      <div
        style={{
          padding: '10px 32px',
          borderBottom: '1px solid rgba(0,229,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontFamily: 'var(--gs-font-mono)', fontSize: '9px', color: 'var(--gs-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: '4px' }}>
          Position:
        </span>
        {POSITIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handlePosChange(key)}
            style={{
              fontFamily: 'var(--gs-font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              padding: '3px 9px',
              borderRadius: '3px',
              background: position === key ? 'rgba(0,229,255,0.12)' : 'transparent',
              border: `1px solid ${position === key ? 'var(--gs-cyan-border)' : 'rgba(0,229,255,0.1)'}`,
              color: position === key ? 'var(--gs-cyan)' : 'var(--gs-text-dim)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Transaction list */}
      <div style={{ padding: '0 32px' }}>
        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--gs-font-mono)', fontSize: '12px', color: 'var(--gs-text-muted)' }}>
            Loading...
          </div>
        ) : transactions.length === 0 ? (
          <div style={{ padding: '64px 0', textAlign: 'center', fontFamily: 'var(--gs-font-mono)', fontSize: '13px', color: 'var(--gs-text-dim)' }}>
            No transactions found
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr 110px 130px 110px 70px',
                gap: '12px',
                padding: '10px 0 8px',
                borderBottom: '1px solid rgba(0,229,255,0.12)',
              }}
            >
              {['', 'Player', 'Type', 'Movement', 'Contract', 'Date'].map((h) => (
                <span
                  key={h}
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--gs-text-muted)',
                    textAlign: h === 'Date' ? 'right' : 'left',
                  }}
                >
                  {h}
                </span>
              ))}
            </div>

            {transactions.map((tx) => {
              const dest = tx.current_team_abbr ?? tx.to_team_abbr;
              const storedOther = tx.from_team_abbr !== dest ? tx.from_team_abbr : tx.to_team_abbr;
              const prev = storedOther !== dest ? storedOther : null;
              const contract = formatContract(tx.contract_apy, tx.contract_years);
              const typeColor = TYPE_COLORS[tx.transaction_type] ?? 'var(--gs-text-dim)';
              const pc = posColor(tx.player_position);

              return (
                <div
                  key={tx.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => tx.player_id && setOpenPlayerId(String(tx.player_id))}
                  onKeyDown={(e) => e.key === 'Enter' && tx.player_id && setOpenPlayerId(String(tx.player_id))}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px 1fr 110px 130px 110px 70px',
                    alignItems: 'center',
                    gap: '12px',
                    height: '52px',
                    borderBottom: '1px solid rgba(0,229,255,0.05)',
                    cursor: tx.player_id ? 'pointer' : 'default',
                  }}
                >
                  {/* Team logo */}
                  {dest ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`https://a.espncdn.com/i/teamlogos/nfl/500/${dest.toLowerCase()}.png`}
                      alt={dest}
                      width={28}
                      height={28}
                      style={{ objectFit: 'contain', display: 'block' }}
                    />
                  ) : (
                    <div style={{ width: 28, height: 28 }} />
                  )}

                  {/* Player */}
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
                        flex: '0 1 auto',
                        minWidth: 0,
                      }}
                    >
                      {tx.player_name ?? 'Unknown'}
                    </span>
                    {tx.player_position && (
                      <span
                        style={{
                          background: `${pc}1a`,
                          color: pc,
                          fontFamily: 'var(--gs-font-mono)',
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '1px 4px',
                          borderRadius: '3px',
                          flexShrink: 0,
                        }}
                      >
                        {tx.player_position}
                      </span>
                    )}
                  </div>

                  {/* Type */}
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

                  {/* Movement */}
                  <span
                    style={{
                      color: 'var(--gs-text-dim)',
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: '10px',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {prev && dest ? `${prev} → ${dest}` : dest ? `→ ${dest}` : prev ?? '—'}
                  </span>

                  {/* Contract */}
                  <span
                    style={{
                      color: contract ? 'var(--gs-amber)' : 'rgba(90,122,144,0.3)',
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: contract ? '11px' : '10px',
                      fontWeight: contract ? 600 : 400,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {contract ?? '—'}
                  </span>

                  {/* Date */}
                  <span
                    style={{
                      color: 'var(--gs-text-muted)',
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: '10px',
                      textAlign: 'right',
                    }}
                  >
                    {formatDate(tx.date)}
                  </span>
                </div>
              );
            })}
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', paddingTop: '32px' }}>
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              style={{
                fontFamily: 'var(--gs-font-display)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '8px 16px',
                border: '1px solid var(--gs-cyan-border)',
                background: 'none',
                color: page <= 1 ? 'var(--gs-text-muted)' : 'var(--gs-cyan-dim)',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Prev
            </button>
            <span style={{ fontFamily: 'var(--gs-font-mono)', fontSize: '11px', color: 'var(--gs-text-dim)' }}>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{
                fontFamily: 'var(--gs-font-display)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                padding: '8px 16px',
                border: '1px solid var(--gs-cyan-border)',
                background: 'none',
                color: page >= totalPages ? 'var(--gs-text-muted)' : 'var(--gs-cyan-dim)',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
