'use client';

/**
 * Route: /gridstream/draft/mocks
 *
 * Mock drafts view — shows analyst source cards in a sidebar, with the full
 * pick list for the selected mock in the main panel.
 */

import Image from 'next/image';
import { useEffect, useState } from 'react';
import {
  fetchGridstreamMockDrafts,
  resolveGridstreamApiBase,
  type GridstreamMockDraft,
  type GridstreamMockDraftPick,
  type GridstreamMockDraftSource,
  type GridstreamMockDraftsResponse,
  type GridstreamDraftProspectData,
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
  textPrimary: '#f0f8ff',
  textSecondary: '#9fc3db',
  textMuted: '#6f9ab8',
  accent: '#00e5ff',
  accentDim: 'rgba(0,229,255,.12)',
  border: 'rgba(0,229,255,.13)',
  borderDim: 'rgba(0,229,255,.07)',
  surface: 'rgba(0,12,28,.95)',
  surfaceRaised: 'rgba(0,18,40,.90)',
  hoverRow: 'rgba(0,229,255,.05)',
  gold: '#f5c842',
} as const;

const remoteImageLoader = ({ src }: { src: string }) => src;

function toDrawerProspect(
  data: GridstreamDraftProspectData | null | undefined
): DraftProspectQuickView | null {
  return (data as DraftProspectQuickView | null) ?? null;
}

// ---------------------------------------------------------------------------
// Team slug → display name helper
// ---------------------------------------------------------------------------
function teamSlugToName(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Source sidebar card
// ---------------------------------------------------------------------------
function SourceCard({
  source,
  active,
  onClick,
}: {
  source: GridstreamMockDraftSource;
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
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        borderRadius: 6,
        border: `1px solid ${active ? C.accent : hovered ? C.border : C.borderDim}`,
        background: active ? C.accentDim : hovered ? 'rgba(0,229,255,.03)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: active ? C.accent : C.textPrimary,
          marginBottom: 2,
        }}
      >
        {source.analyst || source.label}
      </div>
      {source.outlet && source.analyst && (
        <div style={{ fontSize: 11, color: C.textMuted }}>{source.outlet}</div>
      )}
      <div
        style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <span
          style={{
            fontSize: 11,
            color: active ? C.accent : C.textMuted,
            padding: '1px 6px',
            borderRadius: 3,
            border: `1px solid ${active ? C.accent : C.borderDim}`,
          }}
        >
          {source.pickCount} pick{source.pickCount !== 1 ? 's' : ''}
        </span>
        {source.updated && (
          <span style={{ fontSize: 10, color: C.textMuted }}>{source.updated}</span>
        )}
        {source.url && !source.url.includes('nflmockdraftdatabase') && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 10, color: C.accent, opacity: 0.7, textDecoration: 'none' }}
          >
            ↗ article
          </a>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// One pick row
// ---------------------------------------------------------------------------
function PickRow({
  pick,
  onOpenProspect,
}: {
  pick: GridstreamMockDraftPick;
  onOpenProspect: (p: DraftProspectQuickView) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const drawerProspect = toDrawerProspect(pick.prospect);
  const teamName = teamSlugToName(pick.teamSlug);

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.hoverRow : 'transparent',
        borderBottom: `1px solid ${C.borderDim}`,
        transition: 'background 0.1s',
      }}
    >
      {/* Pick # */}
      <td style={{ padding: '10px 12px', textAlign: 'center', width: 48 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{pick.pick}</span>
      </td>

      {/* Team logo + name */}
      <td style={{ padding: '10px 8px', width: 180 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pick.teamLogo ? (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: pick.teamColor || 'rgba(255,255,255,.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <Image
                loader={remoteImageLoader}
                src={pick.teamLogo}
                alt={teamName}
                width={24}
                height={24}
                style={{ objectFit: 'contain' }}
                unoptimized
              />
            </div>
          ) : (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 4,
                background: 'rgba(255,255,255,.06)',
                flexShrink: 0,
              }}
            />
          )}
          <span style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.2 }}>{teamName}</span>
        </div>
      </td>

      {/* Player — name + pos/school inline, blurb spanning full remaining width */}
      <td style={{ padding: '10px 8px' }} colSpan={pick.traded ? 2 : 3}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          {pick.playerCollegeLogo && (
            <Image
              loader={remoteImageLoader}
              src={pick.playerCollegeLogo}
              alt=""
              width={20}
              height={20}
              style={{ objectFit: 'contain', opacity: 0.8, flexShrink: 0 }}
              unoptimized
            />
          )}
          {drawerProspect ? (
            <ProspectQuickViewTrigger
              prospect={drawerProspect}
              onOpen={onOpenProspect}
              style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary }}
            >
              {pick.playerName}
            </ProspectQuickViewTrigger>
          ) : (
            <span style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary }}>
              {pick.playerName}
            </span>
          )}
          {pick.playerPosition && (
            <span
              style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: '0.04em' }}
            >
              {pick.playerPosition}
            </span>
          )}
          {pick.playerCollege && (
            <span style={{ fontSize: 12, color: C.textMuted }}>{pick.playerCollege}</span>
          )}
          {pick.traded && (
            <span
              style={{
                fontSize: 10,
                color: C.gold,
                border: `1px solid ${C.gold}`,
                borderRadius: 3,
                padding: '1px 5px',
                opacity: 0.8,
              }}
            >
              VIA TRADE
            </span>
          )}
        </div>
        {pick.blurb && (
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 1.55 }}>
            {pick.blurb}
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Mock pick table
// ---------------------------------------------------------------------------
function MockPickTable({
  mock,
  onOpenProspect,
}: {
  mock: GridstreamMockDraft;
  onOpenProspect: (p: DraftProspectQuickView) => void;
}) {
  // Group by round
  const rounds: Record<number, GridstreamMockDraftPick[]> = {};
  for (const pick of mock.picks) {
    const r = pick.round || 1;
    if (!rounds[r]) rounds[r] = [];
    rounds[r].push(pick);
  }
  const roundNumbers = Object.keys(rounds)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      {roundNumbers.map((roundNum) => (
        <div key={roundNum} style={{ marginBottom: roundNumbers.length > 1 ? 32 : 0 }}>
          {roundNumbers.length > 1 && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: C.textMuted,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${C.borderDim}`,
              }}
            >
              Round {roundNum}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 }}>
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 180 }} />
              <col />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th style={{ padding: '6px 12px', textAlign: 'center' }}>
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
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: C.textMuted,
                      fontWeight: 500,
                      letterSpacing: '0.08em',
                    }}
                  >
                    TEAM
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
                    PLAYER
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(rounds[roundNum] ?? []).map((pick) => (
                <PickRow key={pick.pick} pick={pick} onOpenProspect={onOpenProspect} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function MockDraftsPage() {
  const [data, setData] = useState<GridstreamMockDraftsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openProspect, setOpenProspect] = useState<DraftProspectQuickView | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchGridstreamMockDrafts(API_BASE, DRAFT_SEASON, ctrl.signal)
      .then((d) => {
        setData(d);
        if (d.sources.length > 0) setSelectedKey(d.sources[0]?.key ?? null);
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

  const selectedMock = data?.mocks.find((m) => m.key === selectedKey) ?? null;

  if (loading) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: C.textMuted }}>
        Loading mock drafts…
      </div>
    );
  }

  if (error) {
    return (
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
        Failed to load mock drafts: {error}
      </div>
    );
  }

  if (!data || data.sources.length === 0) {
    return (
      <div
        style={{
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
          No mock draft data yet
        </div>
        <p style={{ margin: 0 }}>Run the following to scrape and import mock drafts:</p>
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
          {`node gridstream/scripts/scrape_nflmockdraftdb_mock_drafts.mjs --season ${DRAFT_SEASON} --output-json /tmp/mocks.json\ndocker compose exec api-django python manage.py sync_mock_drafts --season ${DRAFT_SEASON} --input-json /tmp/mocks.json`}
        </pre>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* Sidebar — source list */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: C.textMuted,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Sources
          </div>
          {data.sources.map((source) => (
            <SourceCard
              key={source.key}
              source={source}
              active={source.key === selectedKey}
              onClick={() => setSelectedKey(source.key)}
            />
          ))}
        </div>

        {/* Main panel — pick list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedMock ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, marginBottom: 2 }}
                >
                  {selectedMock.analyst || selectedMock.label}
                  {selectedMock.outlet && selectedMock.analyst && (
                    <span
                      style={{ fontSize: 13, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}
                    >
                      {selectedMock.outlet}
                    </span>
                  )}
                </div>
                {selectedMock.updated && (
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    Updated {selectedMock.updated} · {selectedMock.picks.length} picks
                  </div>
                )}
              </div>
              <MockPickTable mock={selectedMock} onOpenProspect={setOpenProspect} />
            </>
          ) : (
            <div style={{ color: C.textMuted, padding: '40px 0', textAlign: 'center' }}>
              Select a source to view picks
            </div>
          )}
        </div>
      </div>

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
