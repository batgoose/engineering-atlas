import Link from 'next/link';
import { layout, typography } from '@atlas/ui/styles';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';
import TransactionTicker from '@/components/gridstream/TransactionTicker';
import type { TransactionItem } from '@/components/gridstream/TransactionTicker';
import HubRecentMoves from '@/components/gridstream/HubRecentMoves';
import HubDraftOrder from '@/components/gridstream/HubDraftOrder';
import HubDraftPreview from '@/components/gridstream/HubDraftPreview';
import type { DraftEntryItem } from '@/components/gridstream/HubDraftPreview';
import HubSchedule from '@/components/gridstream/HubSchedule';
import type { GameApiItem } from '@/components/gridstream/HubSchedule';
import HubNewsHero from '@/components/gridstream/HubNewsHero';
import type { NewsArticle } from '@/components/gridstream/HubNewsHero';

// Server components use API_URL (internal Docker network) to avoid resolving
// Traefik hostnames (api.localhost) from inside the container.
// Falls back to NEXT_PUBLIC_API_URL for local dev outside Docker.
const API_BASE = resolveGridstreamApiBase(
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api'
);

async function safeFetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function GridstreamHubPage() {
  // Parallel fetches — all with graceful fallback
  const [txData, , draftData, seasonData, playersCountData, newsData] = await Promise.all([
    safeFetch<{ count: number; results: TransactionItem[] }>(
      `${API_BASE}/transactions/?ordering=-date&limit=30`,
      { next: { revalidate: 300 } }
    ),
    Promise.resolve(null), // standings replaced by HubDraftOrder (static)
    safeFetch<{ season: number; entries: DraftEntryItem[] }>(
      `${API_BASE}/draft/big-board/?season=2026`,
      { next: { revalidate: 3600 } }
    ),
    safeFetch<{ year: number; current_week: number; is_active: boolean }>(
      `${API_BASE}/seasons/current/`,
      { next: { revalidate: 3600 } }
    ),
    safeFetch<{ count: number }>(`${API_BASE}/players/?is_active=true&limit=1`, {
      next: { revalidate: 3600 },
    }),
    safeFetch<NewsArticle[]>(`${API_BASE}/news/articles/?limit=20`, { next: { revalidate: 300 } }),
  ]);

  const transactions: TransactionItem[] = txData?.results ?? [];
  const draftEntries: DraftEntryItem[] = (draftData?.entries ?? []).slice(0, 8);
  const draftSeason = draftData?.season ?? 2026;
  const newsArticles: NewsArticle[] = Array.isArray(newsData) ? newsData : [];

  const currentSeason = seasonData?.year ?? 2025;
  const currentWeek = seasonData?.current_week ?? 1;

  // Fetch games for current season/week, plus total game count (separate — weekly fetch is filtered)
  const [gamesData, totalGamesData] = await Promise.all([
    safeFetch<{ count: number; results: GameApiItem[] }>(
      `${API_BASE}/games/?season=${currentSeason}&week=${currentWeek}&limit=16`,
      { next: { revalidate: 300 } }
    ),
    safeFetch<{ count: number }>(`${API_BASE}/games/?limit=1`, { next: { revalidate: 86400 } }),
  ]);
  const games: GameApiItem[] = gamesData?.results ?? [];

  // Platform stats from pagination counts
  const txCount = txData?.count ?? 0;
  const playerCount = playersCountData?.count ?? 0;
  const gameCount = totalGamesData?.count ?? 0;
  const prospectCount = draftData?.entries?.length ?? 0;

  const navCards = [
    {
      title: 'Games Database',
      href: '/gridstream/games',
      description: 'Browse full schedules by season and week, then jump straight into replay view.',
      status: 'Live',
      count: gameCount,
      countLabel: 'games',
    },
    {
      title: 'Players Database',
      href: '/gridstream/players',
      description:
        'Search active rosters and historical players with career stats, contract data, Madden ratings, and award history.',
      status: 'Live',
      count: playerCount,
      countLabel: 'active players',
    },
    {
      title: 'Teams',
      href: '/gridstream/teams',
      description: 'Check franchise trends, team metrics, and year-over-year snapshots.',
      status: 'Live',
      count: 32,
      countLabel: 'franchises',
    },
    {
      title: 'Fantasy',
      href: '/gridstream/fantasy',
      description: 'Follow fantasy scoring views and prep for future Yahoo/league integrations.',
      status: 'Scaffolded',
      count: null,
      countLabel: null,
    },
    {
      title: `${draftSeason} Draft`,
      href: '/gridstream/draft',
      description:
        "Multi-source prospect big board — sort by any scout's rankings or the combined average. Scouting profiles on click.",
      status: 'New',
      count: prospectCount,
      countLabel: 'prospects',
    },
  ];

  const statsItems = [
    { value: gameCount.toLocaleString(), label: 'games' },
    { value: playerCount.toLocaleString(), label: 'active players' },
    { value: txCount.toLocaleString(), label: 'transactions' },
    { value: prospectCount.toLocaleString(), label: 'prospects ranked' },
  ].filter((s) => parseInt(s.value.replace(/,/g, '')) > 0);

  return (
    <div className={`${layout.page} relative overflow-hidden pb-16`}>
      {/* Ambient glows */}
      <div
        className="absolute top-0 left-[20%] -translate-x-1/2 pointer-events-none"
        style={{
          width: 700,
          height: 500,
          background:
            'radial-gradient(ellipse at center, rgba(0,229,255,0.06) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute top-0 right-[10%] pointer-events-none"
        style={{
          width: 500,
          height: 400,
          background:
            'radial-gradient(ellipse at center, rgba(255,182,18,0.04) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Masthead */}
      <div className={`${layout.container} pt-12 sm:pt-16 relative`}>
        <div className="mb-3">
          <span
            style={{
              fontFamily: 'var(--gs-font-mono)',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--gs-text-dim)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            {currentSeason} {seasonData?.is_active ? 'Season' : 'Offseason'} · Week {currentWeek}
          </span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold uppercase tracking-tight text-white leading-tight mb-4">
          NFL Data Hub <span className="text-frontend">+</span> Replay Engine
        </h1>
        <p className={`${typography.body} text-lg md:text-xl text-slate-400 max-w-3xl mb-8`}>
          Live roster moves, standings, and the draft board — plus full game replay and player
          research across every season since 1999.
        </p>
      </div>

      {/* Ticker — full width */}
      <TransactionTicker transactions={transactions} />

      <div className={`${layout.container} relative`}>
        {/* Module navigation — amber-topped tab strip */}
        <div className="hub-nav-strip" style={{ marginTop: '24px', marginBottom: '28px' }}>
          {navCards.map((card) => (
            <Link key={card.href} href={card.href} className="hub-nav-tab">
              {card.title}
            </Link>
          ))}
        </div>

        {/* News hero section */}
        <HubNewsHero articles={newsArticles} />

        {/* Data widgets — 3-column strip, stretch so all panels match height */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6"
          style={{ alignItems: 'stretch' }}
        >
          <HubRecentMoves transactions={transactions.slice(0, 6)} />
          <HubDraftOrder season={draftSeason} />
          <HubDraftPreview entries={draftEntries} season={draftSeason} />
        </div>

        {/* Schedule — compact below widget strip */}
        <div className="mb-8">
          <HubSchedule
            games={games}
            week={currentWeek}
            season={currentSeason}
            isActive={seasonData?.is_active ?? false}
          />
        </div>

        {/* Platform stats bar */}
        {statsItems.length > 0 && (
          <div
            style={{
              borderTop: '1px solid var(--gs-cyan-border)',
              paddingTop: '16px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 24px',
              alignItems: 'center',
            }}
          >
            {statsItems.map((item, i) => (
              <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {i > 0 && (
                  <span style={{ color: 'var(--gs-text-muted)', fontSize: '10px' }}>·</span>
                )}
                <span
                  style={{
                    fontFamily: 'var(--gs-font-mono)',
                    fontSize: '11px',
                    color: 'var(--gs-text-dim)',
                  }}
                >
                  <span style={{ color: 'var(--gs-text)', fontWeight: 600 }}>{item.value}</span>{' '}
                  {item.label}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
