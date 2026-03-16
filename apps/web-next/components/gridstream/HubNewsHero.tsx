'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

export type NewsArticle = {
  id: number;
  source: string;
  headline: string;
  summary: string;
  author: string;
  body: string;
  url: string;
  image_url: string;
  published_at: string;
  team_abbrs: string[];
  player_ids: number[];
  player_names: string[];
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = { espn: 'ESPN', rotowire: 'RotoWire', pfr: 'PFR' };
  return map[source] ?? source.toUpperCase();
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    espn: '#e51717',
    rotowire: '#1565c0',
    pfr: '#5a6a40',
  };
  return (
    <span
      style={{
        fontFamily: 'var(--gs-font-display)',
        fontSize: '8px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        padding: '2px 6px',
        background: colors[source] ?? 'rgba(0,229,255,0.12)',
        color: '#fff',
        borderRadius: '2px',
        textTransform: 'uppercase',
      }}
    >
      {sourceLabel(source)}
    </span>
  );
}

function TeamBadges({ abbrs }: { abbrs: string[] }) {
  if (!abbrs.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
      {abbrs.map((a) => (
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
    </span>
  );
}

// ── Article detail modal ──────────────────────────────────────────

export function ArticleModal({ article, onClose }: { article: NewsArticle; onClose: () => void }) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          maxWidth: '680px',
          width: '90%',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: '#050d1a',
          border: '1px solid rgba(0,229,255,0.18)',
          borderRadius: '6px',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '10px',
            right: '14px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '18px',
            color: 'var(--gs-text-muted)',
            lineHeight: 1,
            padding: '2px 6px',
            zIndex: 1,
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = 'var(--gs-text-bright)')
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = 'var(--gs-text-muted)')
          }
        >
          ×
        </button>

        {/* Hero image */}
        {article.image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={article.image_url}
            alt={article.headline}
            style={{
              width: '100%',
              height: '260px',
              objectFit: 'cover',
              objectPosition: 'center 20%',
              display: 'block',
              borderRadius: '5px 5px 0 0',
            }}
          />
        )}

        {/* Content */}
        <div
          style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          {/* Source + time + date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <SourceBadge source={article.source} />
            <span
              style={{
                fontFamily: 'var(--gs-font-mono)',
                fontSize: '10px',
                color: 'var(--gs-text-muted)',
              }}
            >
              {timeAgo(article.published_at)}
            </span>
            <span
              style={{
                fontFamily: 'var(--gs-font-mono)',
                fontSize: '10px',
                color: 'var(--gs-text-muted)',
              }}
            >
              {formatDate(article.published_at)}
            </span>
          </div>

          {/* Author */}
          {article.author && (
            <div
              style={{
                fontFamily: 'var(--gs-font-body)',
                fontSize: '12px',
                color: 'var(--gs-text-muted)',
              }}
            >
              By {article.author}
            </div>
          )}

          {/* Team + player badges */}
          {(article.team_abbrs.length > 0 || article.player_names.length > 0) && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              <TeamBadges abbrs={article.team_abbrs} />
              {article.player_names.map((name) => (
                <span
                  key={name}
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: '9px',
                    color: 'var(--gs-amber)',
                    border: '1px solid rgba(255,182,18,0.3)',
                    padding: '1px 5px',
                    borderRadius: '2px',
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          )}

          {/* Headline */}
          <h2
            style={{
              fontFamily: 'var(--gs-font-display)',
              fontSize: '20px',
              fontWeight: 700,
              color: 'var(--gs-text-bright)',
              lineHeight: 1.3,
              margin: '12px 0 8px',
            }}
          >
            {article.headline}
          </h2>

          {/* Body — paragraphs; fall back to summary */}
          {(article.body || article.summary) && (
            <div>
              {(article.body || article.summary)
                .split('\n\n')
                .filter(Boolean)
                .map((p, i) => (
                  <p
                    key={i}
                    style={{
                      fontFamily: 'var(--gs-font-body)',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      color: 'var(--gs-text-dim)',
                      margin: '0 0 12px',
                    }}
                  >
                    {p}
                  </p>
                ))}
            </div>
          )}

          {/* External link */}
          <div style={{ paddingTop: '4px' }}>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                border: '1px solid var(--gs-cyan-dim)',
                color: 'var(--gs-cyan)',
                fontFamily: 'var(--gs-font-display)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                padding: '8px 16px',
                textDecoration: 'none',
                textTransform: 'uppercase',
                display: 'inline-block',
              }}
            >
              READ FULL ARTICLE AT {sourceLabel(article.source)} →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Featured text article (left column) ─────────────────────────

function FeaturedArticle({
  article,
  onOpen,
}: {
  article: NewsArticle;
  onOpen: (a: NewsArticle) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(article)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(article)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '20px',
        background: 'var(--gs-panel)',
        border: '1px solid var(--gs-panel-border)',
        height: '100%',
        textDecoration: 'none',
        transition: 'border-color 0.18s',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
      className="group"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SourceBadge source={article.source} />
        <span
          style={{
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
            color: 'var(--gs-text-muted)',
          }}
        >
          {timeAgo(article.published_at)}
        </span>
        <TeamBadges abbrs={article.team_abbrs} />
      </div>

      <h2
        style={{
          fontFamily: 'var(--gs-font-display)',
          fontSize: '16px',
          fontWeight: 700,
          lineHeight: 1.35,
          color: 'var(--gs-text-bright)',
          letterSpacing: '0.02em',
          margin: 0,
        }}
      >
        {article.headline}
      </h2>

      {article.summary && (
        <p
          style={{
            fontFamily: 'var(--gs-font-body)',
            fontSize: '14px',
            lineHeight: 1.55,
            color: 'var(--gs-text-dim)',
            margin: 0,
            flex: 1,
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {article.summary}
        </p>
      )}

      {article.player_names.length > 0 && (
        <div
          style={{
            fontFamily: 'var(--gs-font-body)',
            fontSize: '11px',
            color: 'var(--gs-text-muted)',
            borderTop: '1px solid var(--gs-cyan-border)',
            paddingTop: '8px',
          }}
        >
          {article.player_names.slice(0, 5).join(' · ')}
        </div>
      )}

      <div
        style={{
          fontFamily: 'var(--gs-font-display)',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--gs-cyan-dim)',
          textTransform: 'uppercase',
          marginTop: 'auto',
        }}
      >
        READ MORE →
      </div>
    </div>
  );
}

// ── Hero image article (center) ──────────────────────────────────

function HeroImageArticle({
  article,
  onOpen,
}: {
  article: NewsArticle;
  onOpen: (a: NewsArticle) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(article)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(article)}
      style={{
        display: 'block',
        position: 'relative',
        height: '100%',
        minHeight: '300px',
        overflow: 'hidden',
        border: '1px solid var(--gs-panel-border)',
        textDecoration: 'none',
        cursor: 'pointer',
      }}
    >
      {article.image_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
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
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #0a1828 0%, #071420 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--gs-font-display)',
              fontSize: '11px',
              color: 'var(--gs-text-muted)',
              letterSpacing: '0.15em',
            }}
          >
            NFL
          </span>
        </div>
      )}

      {/* Gradient overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(7,11,20,0.92) 0%, rgba(7,11,20,0.4) 50%, transparent 100%)',
        }}
      />

      {/* Headline overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 18px',
        }}
      >
        {/* Frosted glass title bar */}
        <div
          style={{
            background: 'rgba(0,5,15,0.28)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '3px',
            padding: '10px 14px',
            display: 'inline-block',
            maxWidth: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <SourceBadge source={article.source} />
            <span
              style={{
                fontFamily: 'var(--gs-font-mono)',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.55)',
              }}
            >
              {timeAgo(article.published_at)}
            </span>
          </div>
          <h2
            style={{
              fontFamily: 'var(--gs-font-display)',
              fontSize: '15px',
              fontWeight: 700,
              lineHeight: 1.3,
              color: '#fff',
              margin: 0,
              letterSpacing: '0.02em',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}
          >
            {article.headline}
          </h2>
        </div>
      </div>

      {/* Top-left cyan tick */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '14px',
          height: '14px',
          borderTop: '2px solid var(--gs-cyan-dim)',
          borderLeft: '2px solid var(--gs-cyan-dim)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

// ── Sidebar headline list (right column) ────────────────────────

function SidebarHeadlines({
  articles,
  onOpen,
}: {
  articles: NewsArticle[];
  onOpen: (a: NewsArticle) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--gs-panel-border)',
        background: 'var(--gs-panel)',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--gs-panel-border)',
          fontFamily: 'var(--gs-font-display)',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.16em',
          color: 'var(--gs-text-dim)',
          textTransform: 'uppercase',
        }}
      >
        Latest Headlines
      </div>
      {articles.map((article, i) => (
        <div
          key={article.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(article)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(article)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            padding: '12px 14px',
            borderBottom: i < articles.length - 1 ? '1px solid rgba(0,229,255,0.05)' : 'none',
            textDecoration: 'none',
            transition: 'background 0.12s',
            flex: 1,
            cursor: 'pointer',
          }}
        >
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
          <span
            style={{
              fontFamily: 'var(--gs-font-body)',
              fontSize: '13px',
              lineHeight: 1.4,
              color: 'var(--gs-text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {article.headline}
          </span>
          {article.team_abbrs.length > 0 && <TeamBadges abbrs={article.team_abbrs} />}
        </div>
      ))}
    </div>
  );
}

// ── Bottom image card ────────────────────────────────────────────

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
        textDecoration: 'none',
        transition: 'border-color 0.18s',
        cursor: 'pointer',
      }}
    >
      {article.image_url && (
        <div style={{ position: 'relative', height: '140px', overflow: 'hidden', flexShrink: 0 }}>
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
              background: 'linear-gradient(to top, rgba(10,16,32,0.7) 0%, transparent 60%)',
            }}
          />
        </div>
      )}
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flex: 1,
        }}
      >
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
        <span
          style={{
            fontFamily: 'var(--gs-font-body)',
            fontSize: '14px',
            lineHeight: 1.4,
            color: 'var(--gs-text)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {article.headline}
        </span>
        {article.team_abbrs.length > 0 && <TeamBadges abbrs={article.team_abbrs} />}
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────

export default function HubNewsHero({ articles }: { articles: NewsArticle[] }) {
  const [selected, setSelected] = useState<NewsArticle | null>(null);

  if (!articles.length) return null;

  const withImages = articles.filter((a) => a.image_url);
  const withoutImages = articles.filter((a) => !a.image_url);

  const heroArticle = (withImages[0] ?? articles[0])!;
  const featuredArticle =
    withoutImages[0] ?? articles.find((a) => a.id !== heroArticle.id) ?? articles[1];

  const usedIds = new Set([heroArticle?.id, featuredArticle?.id]);
  const cardArticles = withImages.filter((a) => !usedIds.has(a.id)).slice(0, 3);
  const sidebarArticles = articles
    .filter((a) => !usedIds.has(a.id) && !cardArticles.find((c) => c.id === a.id))
    .slice(0, 5);

  return (
    <section style={{ marginBottom: '24px' }}>
      {/* Article detail modal */}
      {selected && <ArticleModal article={selected} onClose={() => setSelected(null)} />}

      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '12px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--gs-font-display)',
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: 'var(--gs-text-dim)',
            textTransform: 'uppercase',
          }}
        >
          NFL News
        </span>
        <div style={{ flex: 1, height: '1px', background: 'var(--gs-cyan-border)' }} />
        <Link
          href="/gridstream/news"
          style={{
            fontFamily: 'var(--gs-font-display)',
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: 'var(--gs-cyan-dim)',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          ALL NEWS →
        </Link>
      </div>

      {/* Top row: featured | hero | sidebar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.6fr 280px',
          gap: '1px',
          marginBottom: '1px',
          minHeight: '320px',
        }}
      >
        {featuredArticle && <FeaturedArticle article={featuredArticle} onOpen={setSelected} />}
        {heroArticle && <HeroImageArticle article={heroArticle} onOpen={setSelected} />}
        {sidebarArticles.length > 0 && (
          <SidebarHeadlines articles={sidebarArticles} onOpen={setSelected} />
        )}
      </div>

      {/* Bottom row: 3 image cards */}
      {cardArticles.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cardArticles.length}, 1fr)`,
            gap: '1px',
          }}
        >
          {cardArticles.map((article) => (
            <NewsCard key={article.id} article={article} onOpen={setSelected} />
          ))}
        </div>
      )}
    </section>
  );
}
