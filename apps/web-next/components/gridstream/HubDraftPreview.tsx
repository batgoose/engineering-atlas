import Link from 'next/link';

export type DraftEntryItem = {
  nameSlug: string;
  name: string;
  position: string | null;
  school: string | null;
  avgRank: number;
  buzzRank: number | null;
  prospect?: {
    draftProjection?: string | null;
    allScoutsOverallRank?: number | null;
    collegeLogoUrl?: string | null;
  } | null;
};

const POS_COLORS: Record<string, string> = {
  QB:  '#60a5fa',
  RB:  '#34d399',
  WR:  '#a78bfa',
  TE:  '#fbbf24',
  OT:  '#94a3b8',
  OG:  '#94a3b8',
  OC:  '#94a3b8',
  DE:  '#f87171',
  DT:  '#f87171',
  LB:  '#fb923c',
  CB:  '#38bdf8',
  S:   '#38bdf8',
  FS:  '#38bdf8',
  SS:  '#38bdf8',
  EDGE:'#f87171',
  K:   '#e879f9',
  P:   '#e879f9',
};

function posColor(pos: string | null) {
  return POS_COLORS[pos ?? ''] ?? 'var(--gs-text-dim)';
}

function formatAvgRank(avg: number): string {
  return `#${avg.toFixed(1)}`;
}

export default function HubDraftPreview({
  entries,
  season,
}: {
  entries: DraftEntryItem[];
  season: number;
}) {
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
        }}
      >
        <span className="hud-label" style={{ fontSize: '11px' }}>
          {season} Draft Board
        </span>
        <Link
          href="/gridstream/draft"
          style={{
            color: 'var(--gs-cyan-dim)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
            textDecoration: 'none',
          }}
        >
          Full board →
        </Link>
      </div>

      {entries.length === 0 ? (
        <div style={{ padding: '24px 16px', color: 'var(--gs-text-dim)', fontSize: '13px', textAlign: 'center' }}>
          No draft data
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          {entries.map((entry, idx) => {
            const logoUrl = entry.prospect?.collegeLogoUrl;
            return (
              <Link
                key={entry.nameSlug}
                href="/gridstream/draft"
                style={{ display: 'flex', flexDirection: 'column', flex: 1, textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 26px 1fr auto',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0 14px',
                    borderBottom: '1px solid rgba(0,229,255,0.05)',
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  {/* Rank */}
                  <span
                    style={{
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: idx < 3 ? 'var(--gs-amber)' : 'var(--gs-text-dim)',
                      textAlign: 'right',
                    }}
                  >
                    {idx + 1}
                  </span>

                  {/* College logo */}
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={entry.school ?? ''}
                        width={24}
                        height={24}
                        style={{ objectFit: 'contain', display: 'block' }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--gs-font-mono)',
                          fontSize: '8px',
                          fontWeight: 700,
                          color: 'var(--gs-text-muted)',
                          letterSpacing: '0.03em',
                          textAlign: 'center',
                          lineHeight: 1,
                        }}
                      >
                        {entry.school?.slice(0, 3).toUpperCase() ?? '—'}
                      </span>
                    )}
                  </div>

                  {/* Name + position badge (pos to the right of name) */}
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                      {entry.name}
                    </span>
                    <span
                      style={{
                        background: `${posColor(entry.position)}22`,
                        color: posColor(entry.position),
                        fontFamily: 'var(--gs-font-mono)',
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '1px 4px',
                        borderRadius: '2px',
                        flexShrink: 0,
                        letterSpacing: '0.02em',
                      }}
                    >
                      {entry.position ?? '—'}
                    </span>
                  </div>

                  {/* Avg consensus rank */}
                  <span
                    style={{
                      color: 'var(--gs-text-muted)',
                      fontFamily: 'var(--gs-font-mono)',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatAvgRank(entry.avgRank)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
