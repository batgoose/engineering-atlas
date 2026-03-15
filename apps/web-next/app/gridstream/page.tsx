'use client';

import Link from 'next/link';
import { layout, typography, cards, badges, card_buttons } from '@atlas/ui/styles';
import { resolveGridstreamApiBase } from '@atlas/sdk/gridstream/api-transforms';

const API_BASE = resolveGridstreamApiBase(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/gridstream'
);

const navCards = [
  {
    title: 'Games Database',
    href: '/gridstream/games',
    description: 'Browse full schedules by season and week, then jump straight into replay view.',
    status: 'Live',
  },
  {
    title: 'Players Database',
    href: '/gridstream/players',
    description:
      'Search active rosters and historical players with career stats, contract data, Madden ratings, and award history.',
    status: 'Live',
  },
  {
    title: 'Teams',
    href: '/gridstream/teams',
    description: 'Check franchise trends, team metrics, and year-over-year snapshots.',
    status: 'Live',
  },
  {
    title: 'Fantasy',
    href: '/gridstream/fantasy',
    description: 'Follow fantasy scoring views and prep for future Yahoo/league integrations.',
    status: 'Scaffolded',
  },
  {
    title: '2026 Draft',
    href: '/gridstream/draft',
    description:
      "Multi-source prospect big board — sort by any scout's rankings or the combined average. Scouting profiles on click.",
    status: 'New',
  },
];

const quickStats = [
  { label: 'Season Range', value: '1999–2025' },
  { label: 'Game Browser', value: 'Regular + Postseason' },
  { label: 'Replay Mode', value: 'Play-by-play timeline' },
  { label: 'Player Profiles', value: 'Career + Contract data' },
];

export default function GridstreamHubPage() {
  return (
    <div className={`${layout.page} relative overflow-hidden pb-16`}>
      {/* Ambient cyan glow — gridstream accent */}
      <div
        className="absolute top-0 left-[25%] -translate-x-1/2 pointer-events-none"
        style={{
          width: 700,
          height: 500,
          background:
            'radial-gradient(ellipse at center, rgba(0,229,255,0.07) 0%, transparent 70%)',
          filter: 'blur(32px)',
        }}
      />

      <div className={`${layout.container} pt-12 sm:pt-16 relative`}>
        <div className="mb-4">
          <span className="font-mono text-xs font-bold text-frontend tracking-[0.15em] uppercase">
            GRIDSTREAM / COMMAND
          </span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold uppercase tracking-tight text-white leading-tight mb-4">
          NFL Data Hub <span className="text-frontend">+</span> Replay Engine
        </h1>
        <p className={`${typography.body} text-lg md:text-xl text-slate-400 max-w-3xl mb-12`}>
          Use Gridstream as the front door for game replay, player and team research, and fantasy
          workflows. Start with a module below or jump directly into a game ID.
        </p>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {quickStats.map((stat) => (
            <div
              key={stat.label}
              className="p-4 bg-atlas-panel/50 border border-white/5 rounded backdrop-blur-sm"
            >
              <div className="font-mono text-[10px] text-slate-500 uppercase tracking-widest mb-2">
                {stat.label}
              </div>
              <div className="font-display font-bold text-sm sm:text-base text-white">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Navigation Cards Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {navCards.map((card) => (
            <Link key={card.href} href={card.href} className={cards.baseHover}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <h3 className="font-display text-lg font-bold text-white uppercase tracking-tight group-hover:text-frontend transition-colors">
                  {card.title}
                </h3>
                <span className={card.status === 'Live' ? badges.success : badges.warning}>
                  {card.status}
                </span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed italic mb-6 flex-grow">
                {card.description}
              </p>
              <div className={card_buttons.secondaryLink}>
                OPEN MODULE
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        {/* Direct Link Panel */}
        <div className="p-6 bg-atlas-panel/40 border border-white/5 rounded backdrop-blur-sm">
          <h3 className="font-mono text-xs font-bold text-frontend-light tracking-widest uppercase mb-4">
            DIRECT GAME LINK
          </h3>
          <p className="text-sm text-slate-400 mb-4">
            If you already have a game ID, jump straight into replay:
          </p>
          <div className="mb-4 overflow-x-auto">
            <code className="px-4 py-2 bg-atlas-dark border border-white/10 rounded font-mono text-sm text-frontend inline-block whitespace-nowrap">
              /gridstream/games/123
            </code>
          </div>
          <div className="space-y-2 font-mono text-xs text-slate-500">
            <p>
              Optional replay index: <code className="text-frontend">?play=0</code> (start),{' '}
              <code className="text-frontend">?play=live</code> (latest)
            </p>
            <p>
              Direct play sequence: <code className="text-frontend">?play_seq=123</code>
            </p>
            <p className="pt-2 mt-2 border-t border-white/5">
              Find game IDs at{' '}
              <a
                href={`${API_BASE}/games/?season=2024&week=1`}
                className="text-frontend hover:text-frontend-light hover:underline transition-colors"
              >
                /api/gridstream/games/
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
