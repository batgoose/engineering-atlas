'use client';

/**
 * Route: /gridstream/draft
 *
 * 2026 NFL Draft big board — multi-source prospect rankings merged into one
 * sortable table.  Clicking any prospect opens the ProspectQuickViewDrawer.
 */

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DRAFT_POSITION_GROUPS,
  fetchGridstreamDraftBigBoard,
  type GridstreamBigBoardEntry,
  type GridstreamBigBoardResponse,
  type GridstreamBigBoardSource,
  type GridstreamDraftProspectData,
  resolveGridstreamApiBase,
} from '@atlas/sdk/gridstream';
import PlayerQuickViewDrawer, {
  ProspectQuickViewTrigger,
} from '@/components/gridstream/PlayerQuickViewDrawer';
import type { DraftProspectQuickView } from '@/components/gridstream/PlayerQuickViewDrawer';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);
const DRAFT_SEASON = 2026;

const C = {
  bgDeep: '#050c18',
  surface: 'rgba(0,12,28,.95)',
  surfaceRaised: 'rgba(0,18,40,.90)',
  textPrimary: '#f0f8ff',
  textSecondary: '#9fc3db',
  textMuted: '#6f9ab8',
  accent: '#00e5ff',
  accentDim: 'rgba(0,229,255,.12)',
  border: 'rgba(0,229,255,.13)',
  borderDim: 'rgba(0,229,255,.07)',
  hoverRow: 'rgba(0,229,255,.05)',
  sortActive: 'rgba(0,229,255,.18)',
  gold: '#f5c842',
} as const;

// Column widths
const COL_RANK = 52;
const COL_AVG = 56;
const COL_NAME = 190;
const COL_POS = 56;
const COL_SCHOOL = 130;
const COL_SOURCE = 64;

type SortKey = 'avg' | 'buzz' | string; // string = source key

const remoteImageLoader = ({ src }: { src: string }) => src;

// Cast SDK type to drawer's expected type (structurally identical)
function toDrawerProspect(
  data: GridstreamDraftProspectData | null | undefined
): DraftProspectQuickView | null {
  return (data as DraftProspectQuickView | null) ?? null;
}

// ---------------------------------------------------------------------------
// Rank cell
// ---------------------------------------------------------------------------
function RankBadge({ rank, highlight }: { rank: number | null | undefined; highlight?: boolean }) {
  if (rank == null) return <span style={{ color: C.textMuted, fontSize: 12 }}>—</span>;
  return (
    <span
      style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: highlight ? 700 : 400,
        color: highlight ? C.accent : C.textSecondary,
        fontSize: highlight ? 14 : 13,
      }}
    >
      {rank}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sort header button
// ---------------------------------------------------------------------------
function SortHeaderButton({
  label,
  sublabel,
  active,
  onClick,
  style,
  title,
}: {
  label: string;
  sublabel?: string;
  active: boolean;
  onClick: () => void;
  style?: CSSProperties;
  title?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: active ? C.sortActive : hovered ? C.accentDim : 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: '4px 6px',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        transition: 'background 0.12s',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: active ? 700 : 500,
          color: active ? C.accent : C.textSecondary,
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {sublabel && (
        <span style={{ fontSize: 9, color: C.textMuted, lineHeight: 1.1, whiteSpace: 'nowrap' }}>
          {sublabel}
        </span>
      )}
      {active && <span style={{ fontSize: 8, color: C.accent, lineHeight: 1 }}>▼</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Position filter pill
// ---------------------------------------------------------------------------
function PosPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '3px 10px',
        borderRadius: 20,
        border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accentDim : hovered ? 'rgba(255,255,255,.04)' : 'transparent',
        color: active ? C.accent : C.textSecondary,
        fontSize: 12,
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        transition: 'all 0.1s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Source updated badge
// ---------------------------------------------------------------------------
function SourceList({ sources }: { sources: GridstreamBigBoardSource[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginBottom: 16 }}>
      {sources.map((s) => (
        <div
          key={s.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 4,
            border: `1px solid ${C.borderDim}`,
            background: 'rgba(0,229,255,.04)',
          }}
        >
          <span style={{ fontSize: 11, color: C.textSecondary, fontWeight: 600 }}>
            {s.analyst || s.label}
          </span>
          {s.outlet && s.analyst && (
            <span style={{ fontSize: 10, color: C.textMuted }}>{s.outlet}</span>
          )}
          {s.updated && (
            <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 2 }}>{s.updated}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function DraftBigBoardPage() {
  const [board, setBoard] = useState<GridstreamBigBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('avg');
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [openProspect, setOpenProspect] = useState<DraftProspectQuickView | null>(null);

  // Fetch
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchGridstreamDraftBigBoard(API_BASE, DRAFT_SEASON, ctrl.signal)
      .then((data) => {
        setBoard(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, []);

  // Sorted + filtered entries
  const entries = useMemo(() => {
    if (!board) return [];
    let list = board.entries;

    // Position filter
    if (posFilter) {
      const group = DRAFT_POSITION_GROUPS.find((g) => g.key === posFilter);
      if (group) {
        list = list.filter((e) =>
          group.positions.some((p) => p.toUpperCase() === (e.position || '').toUpperCase())
        );
      }
    }

    // Sort
    if (sortKey === 'avg') {
      return [...list].sort((a, b) => (a.avgRank ?? 9999) - (b.avgRank ?? 9999));
    }
    if (sortKey === 'buzz') {
      return [...list].sort((a, b) => (a.buzzRank ?? 9999) - (b.buzzRank ?? 9999));
    }
    // Source column sort
    return [...list].sort((a, b) => (a.rankings[sortKey] ?? 9999) - (b.rankings[sortKey] ?? 9999));
  }, [board, posFilter, sortKey]);

  // Which sources have any data
  const sources = board?.sources ?? [];

  // Active sort column shorthand label
  const activeSortLabel =
    sortKey === 'avg'
      ? 'Avg'
      : sortKey === 'buzz'
        ? 'Buzz'
        : sources.find((s) => s.key === sortKey)?.analyst ||
          sources.find((s) => s.key === sortKey)?.label ||
          sortKey;

  return (
    <>
      {/* Section header */}
      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          marginBottom: 6,
          color: C.textPrimary,
        }}
      >
        Big Board
      </h2>
      <p style={{ color: C.textSecondary, fontSize: 14, maxWidth: 600, marginBottom: 20 }}>
        Combined prospect rankings across {sources.length} scouting sources. Sort by any scout's
        board or by the composite average rank.
      </p>

      {/* Source list */}
      {sources.length > 0 && <SourceList sources={sources} />}

      {/* Position filter */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 20,
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: C.textMuted,
            marginRight: 4,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Filter:
        </span>
        <PosPill label="All" active={posFilter === null} onClick={() => setPosFilter(null)} />
        {DRAFT_POSITION_GROUPS.map((g) => (
          <PosPill
            key={g.key}
            label={g.label}
            active={posFilter === g.key}
            onClick={() => setPosFilter(posFilter === g.key ? null : g.key)}
          />
        ))}
      </div>

      {/* Sorting indicator */}
      {sortKey !== 'avg' && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: C.accent,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Sorted by: {activeSortLabel}</span>
          <button
            type="button"
            onClick={() => setSortKey('avg')}
            style={{
              background: 'none',
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              color: C.textMuted,
              fontSize: 11,
              cursor: 'pointer',
              padding: '1px 6px',
            }}
          >
            Reset to avg
          </button>
        </div>
      )}

      {/* States */}
      {loading && (
        <div style={{ padding: '80px 0', textAlign: 'center', color: C.textMuted }}>
          Loading big board…
        </div>
      )}
      {error && (
        <div
          style={{
            padding: '40px 20px',
            background: 'rgba(255,50,50,.08)',
            border: '1px solid rgba(255,50,50,.2)',
            borderRadius: 8,
            color: '#ff8080',
            fontSize: 14,
          }}
        >
          Failed to load big board: {error}
        </div>
      )}

      {/* Table */}
      {!loading && !error && board && (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              tableLayout: 'fixed',
              minWidth:
                COL_RANK + COL_AVG + COL_NAME + COL_POS + COL_SCHOOL + sources.length * COL_SOURCE,
            }}
          >
            <colgroup>
              <col style={{ width: COL_RANK }} />
              <col style={{ width: COL_AVG }} />
              <col style={{ width: COL_NAME }} />
              <col style={{ width: COL_POS }} />
              <col style={{ width: COL_SCHOOL }} />
              {sources.map((s) => (
                <col key={s.key} style={{ width: COL_SOURCE }} />
              ))}
            </colgroup>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${C.border}`,
                  position: 'sticky',
                  top: 0,
                  background: '#060d1c',
                  zIndex: 10,
                }}
              >
                <th style={{ padding: '8px 6px', textAlign: 'center' }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: C.textMuted,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                    }}
                  >
                    #
                  </span>
                </th>
                <th style={{ padding: '6px 4px', textAlign: 'center' }}>
                  <SortHeaderButton
                    label="AVG"
                    sublabel="all boards"
                    active={sortKey === 'avg'}
                    onClick={() => setSortKey('avg')}
                    title="Sort by average rank across all sources"
                  />
                </th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.textMuted,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                    }}
                  >
                    PROSPECT
                  </span>
                </th>
                <th style={{ padding: '6px 4px', textAlign: 'center' }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: C.textMuted,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                    }}
                  >
                    POS
                  </span>
                </th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: C.textMuted,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                    }}
                  >
                    SCHOOL
                  </span>
                </th>
                {sources.map((s) => (
                  <th key={s.key} style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <SortHeaderButton
                      label={((s.analyst ?? s.label).split(' ')[0] ?? '').substring(0, 8)}
                      sublabel={s.outlet?.substring(0, 7)}
                      active={sortKey === s.key}
                      onClick={() => setSortKey(s.key)}
                      title={`Sort by ${s.label}${s.updated ? ` (updated ${s.updated})` : ''}`}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <BigBoardRow
                  key={entry.nameSlug}
                  entry={entry}
                  rowIndex={idx}
                  sources={sources}
                  sortKey={sortKey}
                  onOpenProspect={setOpenProspect}
                />
              ))}
              {entries.length === 0 && (
                <tr>
                  <td
                    colSpan={5 + sources.length}
                    style={{ padding: '48px 0', textAlign: 'center', color: C.textMuted }}
                  >
                    No prospects for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state when no data at all */}
      {!loading && !error && board && board.entries.length === 0 && (
        <div
          style={{
            marginTop: 40,
            padding: '32px 24px',
            border: `1px solid ${C.borderDim}`,
            borderRadius: 8,
            background: C.surface,
            color: C.textMuted,
            fontSize: 14,
            maxWidth: 560,
          }}
        >
          <div style={{ fontWeight: 700, color: C.textSecondary, marginBottom: 8 }}>
            No big board data yet
          </div>
          <p style={{ margin: 0 }}>Run the following command to scrape and import the rankings:</p>
          <pre
            style={{
              marginTop: 12,
              padding: '10px 14px',
              background: 'rgba(0,0,0,.4)',
              borderRadius: 6,
              fontSize: 12,
              color: C.accent,
              overflowX: 'auto',
            }}
          >
            {`docker compose exec api-django python manage.py sync_big_board_rankings --season ${DRAFT_SEASON}`}
          </pre>
        </div>
      )}

      {/* Prospect drawer */}
      <PlayerQuickViewDrawer
        apiBase={API_BASE}
        playerId={null}
        playerLabel={null}
        prospect={openProspect}
        open={openProspect != null}
        onClose={() => setOpenProspect(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Big board row
// ---------------------------------------------------------------------------
function BigBoardRow({
  entry,
  rowIndex,
  sources,
  sortKey,
  onOpenProspect,
}: {
  entry: GridstreamBigBoardEntry;
  rowIndex: number;
  sources: GridstreamBigBoardSource[];
  sortKey: SortKey;
  onOpenProspect: (p: DraftProspectQuickView) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const drawerProspect = toDrawerProspect(entry.prospect);

  // Display rank is position in current sorted list (1-based)
  const displayRank = rowIndex + 1;

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? C.hoverRow
          : rowIndex % 2 === 0
            ? 'transparent'
            : 'rgba(0,229,255,.015)',
        borderBottom: `1px solid ${C.borderDim}`,
        transition: 'background 0.1s',
      }}
    >
      {/* Row rank */}
      <td style={{ padding: '9px 6px', textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
        {displayRank}
      </td>

      {/* Avg rank */}
      <td style={{ padding: '9px 4px', textAlign: 'center' }}>
        <RankBadge
          rank={entry.avgRank != null ? Math.round(entry.avgRank) : null}
          highlight={sortKey === 'avg'}
        />
      </td>

      {/* Prospect name + college logo */}
      <td style={{ padding: '9px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          {entry.prospect?.collegeLogoUrl && (
            <Image
              loader={remoteImageLoader}
              src={entry.prospect.collegeLogoUrl}
              alt=""
              width={22}
              height={22}
              style={{ objectFit: 'contain', flexShrink: 0, opacity: 0.85 }}
              unoptimized
            />
          )}
          {drawerProspect ? (
            <ProspectQuickViewTrigger
              prospect={drawerProspect}
              onOpen={onOpenProspect}
              style={{
                color: C.textPrimary,
                fontWeight: 600,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </ProspectQuickViewTrigger>
          ) : (
            <span
              style={{
                color: C.textPrimary,
                fontWeight: 600,
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </span>
          )}
        </div>
      </td>

      {/* Position */}
      <td style={{ padding: '9px 4px', textAlign: 'center' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: C.textSecondary,
            letterSpacing: '0.04em',
          }}
        >
          {entry.position || '—'}
        </span>
      </td>

      {/* School */}
      <td
        style={{
          padding: '9px 8px',
          fontSize: 12,
          color: C.textMuted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.school || '—'}
      </td>

      {/* Per-source rank columns */}
      {sources.map((s) => (
        <td
          key={s.key}
          style={{
            padding: '9px 4px',
            textAlign: 'center',
            background: sortKey === s.key ? 'rgba(0,229,255,.04)' : undefined,
          }}
        >
          <RankBadge rank={entry.rankings[s.key] ?? null} highlight={sortKey === s.key} />
        </td>
      ))}
    </tr>
  );
}
