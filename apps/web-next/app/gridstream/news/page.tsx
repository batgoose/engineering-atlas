'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArticleModal } from '@/components/gridstream/HubNewsHero';
import type { NewsArticle } from '@/components/gridstream/HubNewsHero';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api')
    .replace(/\/$/, '')
    .replace(/\/api(\/gridstream)?$/, '') + '/api/gridstream';

const SOURCES = [
  { key: '', label: 'All' },
  { key: 'espn', label: 'ESPN' },
  { key: 'pfr', label: 'PFR' },
  { key: 'rotowire', label: 'RotoWire' },
] as const;

const SOURCE_COLORS: Record<string, string> = {
  espn: '#e51717',
  rotowire: '#1565c0',
  pfr: '#5a6a40',
};

const PAGE_SIZE = 24;

type TeamOption = { abbreviation: string; display_name: string };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--gs-font-display)',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        padding: '2px 6px',
        background: SOURCE_COLORS[source] ?? 'rgba(0,229,255,0.12)',
        color: '#fff',
        borderRadius: '2px',
        textTransform: 'uppercase',
      }}
    >
      {source === 'pfr' ? 'PFR' : source === 'rotowire' ? 'RotoWire' : source.toUpperCase()}
    </span>
  );
}

// ── Team multi-select dropdown ───────────────────────────────────────────────

function TeamDropdown({
  teams,
  selected,
  onChange,
}: {
  teams: TeamOption[];
  selected: string[];
  onChange: (abbrs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(abbr: string) {
    onChange(selected.includes(abbr) ? selected.filter((a) => a !== abbr) : [...selected, abbr]);
  }

  const label =
    selected.length === 0
      ? 'All Teams'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} teams`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '11px',
          fontWeight: 600,
          padding: '6px 12px',
          background: selected.length ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${selected.length ? 'var(--gs-cyan-border)' : 'rgba(0,229,255,0.15)'}`,
          borderRadius: '3px',
          color: selected.length ? 'var(--gs-cyan)' : 'var(--gs-text-dim)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        <span style={{ fontSize: '9px', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 200,
            background: '#070f1d',
            border: '1px solid var(--gs-cyan-border)',
            borderRadius: '4px',
            width: '220px',
            maxHeight: '340px',
            overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid rgba(0,229,255,0.08)',
                color: 'var(--gs-red)',
                fontFamily: 'var(--gs-font-mono)',
                fontSize: '10px',
                cursor: 'pointer',
                textAlign: 'left',
                letterSpacing: '0.06em',
              }}
            >
              Clear ({selected.length})
            </button>
          )}
          {teams.map((t) => {
            const checked = selected.includes(t.abbreviation);
            return (
              <button
                key={t.abbreviation}
                onClick={() => toggle(t.abbreviation)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '7px 12px',
                  background: checked ? 'rgba(0,229,255,0.07)' : 'none',
                  border: 'none',
                  borderBottom: '1px solid rgba(0,229,255,0.04)',
                  color: checked ? 'var(--gs-cyan)' : 'var(--gs-text)',
                  fontFamily: 'var(--gs-font-mono)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {/* Team logo */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://a.espncdn.com/i/teamlogos/nfl/500/${t.abbreviation.toLowerCase()}.png`}
                  alt={t.abbreviation}
                  width={18}
                  height={18}
                  style={{ objectFit: 'contain', flexShrink: 0 }}
                />
                <span style={{ fontWeight: 700, flexShrink: 0, width: '30px' }}>
                  {t.abbreviation}
                </span>
                <span
                  style={{
                    color: 'var(--gs-text-dim)',
                    fontSize: '10px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.display_name}
                </span>
                {checked && (
                  <span style={{ marginLeft: 'auto', fontSize: '10px', flexShrink: 0 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── News card ────────────────────────────────────────────────────────────────

function NewsCard({ article, onOpen }: { article: NewsArticle; onOpen: (a: NewsArticle) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(article)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(article)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--gs-panel-border)',
        background: 'var(--gs-panel)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
    >
      {article.image_url && (
        <div style={{ position: 'relative', height: '160px', overflow: 'hidden', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url}
            alt={article.headline}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center 20%',
              display: 'block',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to top, rgba(10,16,32,0.65) 0%, transparent 60%)',
            }}
          />
          <div style={{ position: 'absolute', top: '10px', left: '10px' }}>
            <SourceBadge source={article.source} />
          </div>
        </div>
      )}

      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          flex: 1,
        }}
      >
        {!article.image_url && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <SourceBadge source={article.source} />
            <span
              style={{
                fontFamily: 'var(--gs-font-mono)',
                fontSize: '9px',
                color: 'var(--gs-text-muted)',
              }}
            >
              {timeAgo(article.published_at)}
            </span>
          </div>
        )}
        {article.image_url && (
          <span
            style={{
              fontFamily: 'var(--gs-font-mono)',
              fontSize: '9px',
              color: 'var(--gs-text-muted)',
            }}
          >
            {timeAgo(article.published_at)}
          </span>
        )}

        <span
          style={{
            fontFamily: 'var(--gs-font-body)',
            fontSize: '14px',
            lineHeight: 1.4,
            color: 'var(--gs-text)',
            fontWeight: 600,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {article.headline}
        </span>

        {(article.body || article.summary) && (
          <span
            style={{
              fontFamily: 'var(--gs-font-body)',
              fontSize: '12px',
              lineHeight: 1.5,
              color: 'var(--gs-text-dim)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              flex: 1,
            }}
          >
            {(article.body || article.summary).split('\n\n')[0]}
          </span>
        )}

        {(article.team_abbrs.length > 0 || article.player_names.length > 0) && (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              flexWrap: 'wrap',
              marginTop: 'auto',
              paddingTop: '4px',
            }}
          >
            {article.team_abbrs.map((a) => (
              <span
                key={a}
                style={{
                  fontFamily: 'var(--gs-font-mono)',
                  fontSize: '9px',
                  color: 'var(--gs-cyan-dim)',
                  border: '1px solid var(--gs-cyan-border)',
                  padding: '1px 5px',
                  borderRadius: '2px',
                }}
              >
                {a}
              </span>
            ))}
            {article.player_names.slice(0, 3).map((n) => (
              <span
                key={n}
                style={{
                  fontFamily: 'var(--gs-font-mono)',
                  fontSize: '9px',
                  color: 'var(--gs-amber)',
                  border: '1px solid rgba(255,182,18,0.3)',
                  padding: '1px 5px',
                  borderRadius: '2px',
                }}
              >
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const [source, setSource] = useState('');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<NewsArticle | null>(null);
  const [teams, setTeams] = useState<TeamOption[]>([]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Load team list once
  useEffect(() => {
    fetch(`${API_BASE}/teams/`)
      .then((r) => r.json())
      .then((data: TeamOption[]) => {
        const sorted = [...data].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
        setTeams(sorted);
      })
      .catch(() => {});
  }, []);

  const buildParams = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (source) p.set('source', source);
      if (selectedTeams.length) p.set('team', selectedTeams.join(','));
      if (debouncedSearch) p.set('search', debouncedSearch);
      return p;
    },
    [source, selectedTeams, debouncedSearch]
  );

  const fetchArticles = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/news/articles/?${buildParams(offset)}`);
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        const items: NewsArticle[] = Array.isArray(data) ? data : (data.results ?? []);
        setArticles((prev) => (append ? [...prev, ...items] : items));
        setHasMore(items.length === PAGE_SIZE);
      } catch {
        if (!append) setArticles([]);
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [buildParams]
  );

  // Refetch on any filter change
  useEffect(() => {
    fetchArticles(0, false);
  }, [fetchArticles]);

  const handleSourceChange = (s: string) => setSource(s);
  const handleTeamsChange = (abbrs: string[]) => setSelectedTeams(abbrs);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--gs-bg)',
        color: 'var(--gs-text)',
        paddingBottom: '48px',
      }}
    >
      {selected && <ArticleModal article={selected} onClose={() => setSelected(null)} />}

      {/* Page header */}
      <div style={{ borderBottom: '1px solid var(--gs-cyan-border)', padding: '20px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '24px', flexWrap: 'wrap' }}>
          <div
            style={{ display: 'flex', alignItems: 'baseline', gap: '12px', paddingBottom: '16px' }}
          >
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
              NFL News
            </span>
          </div>

          {/* Source tabs */}
          <nav style={{ display: 'flex', gap: 0, marginLeft: 'auto' }}>
            {SOURCES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleSourceChange(key)}
                style={{
                  fontFamily: 'var(--gs-font-display)',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  padding: '0 18px',
                  height: '36px',
                  background: 'none',
                  border: 'none',
                  borderBottom:
                    source === key ? '2px solid var(--gs-cyan)' : '2px solid transparent',
                  color: source === key ? 'var(--gs-cyan)' : 'rgba(180,220,235,0.65)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Filter bar: search + team dropdown */}
      <div
        style={{
          padding: '10px 32px',
          borderBottom: '1px solid rgba(0,229,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {/* Search bar */}
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: '360px' }}>
          <span
            style={{
              position: 'absolute',
              left: '10px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--gs-text-muted)',
              fontSize: '12px',
              pointerEvents: 'none',
            }}
          >
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search headlines, players, teams…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: '30px',
              paddingRight: search ? '30px' : '10px',
              paddingTop: '6px',
              paddingBottom: '6px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(0,229,255,0.15)',
              borderRadius: '3px',
              color: 'var(--gs-text)',
              fontFamily: 'var(--gs-font-body)',
              fontSize: '12px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--gs-text-muted)',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: 1,
                padding: '2px',
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Team dropdown */}
        <TeamDropdown teams={teams} selected={selectedTeams} onChange={handleTeamsChange} />

        {/* Active filter summary */}
        {(selectedTeams.length > 0 || debouncedSearch) && (
          <button
            onClick={() => {
              setSelectedTeams([]);
              setSearch('');
            }}
            style={{
              fontFamily: 'var(--gs-font-mono)',
              fontSize: '10px',
              padding: '5px 10px',
              background: 'none',
              border: '1px solid rgba(255,59,79,0.3)',
              borderRadius: '3px',
              color: 'var(--gs-red)',
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Articles grid */}
      <div style={{ padding: '24px 32px 0' }}>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: '280px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--gs-panel-border)',
                }}
              />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 0',
              fontFamily: 'var(--gs-font-mono)',
              fontSize: '13px',
              color: 'var(--gs-text-dim)',
            }}
          >
            No articles found
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px' }}>
            {articles.map((article) => (
              <NewsCard key={article.id} article={article} onOpen={setSelected} />
            ))}
          </div>
        )}

        {/* Load more */}
        {!loading && hasMore && (
          <div style={{ textAlign: 'center', paddingTop: '32px' }}>
            <button
              onClick={() => fetchArticles(articles.length, true)}
              disabled={loadingMore}
              style={{
                fontFamily: 'var(--gs-font-display)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '10px 28px',
                border: '1px solid var(--gs-cyan-border)',
                background: 'none',
                color: loadingMore ? 'var(--gs-text-muted)' : 'var(--gs-cyan-dim)',
                cursor: loadingMore ? 'not-allowed' : 'pointer',
              }}
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
