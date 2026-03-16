import Link from 'next/link';

// API shape: games have nested team_detail objects, not flat abbr fields
export type GameApiItem = {
  id: number;
  status: string;   // 'scheduled' | 'in_progress' | 'final' | 'final_ot'
  week: number;
  game_date: string;
  home_team_detail: { id: number; abbreviation: string };
  away_team_detail: { id: number; abbreviation: string };
  home_score: number | null;
  away_score: number | null;
  season_type?: string;
};

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const isFinal = s === 'final' || s === 'final_ot';
  const isLive  = s === 'in_progress';

  if (isLive) {
    return (
      <span
        style={{
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '10px',
          fontWeight: 700,
          color: 'var(--gs-cyan)',
          textShadow: '0 0 8px var(--gs-cyan-glow)',
          letterSpacing: '0.08em',
        }}
      >
        LIVE
      </span>
    );
  }

  if (isFinal) {
    return (
      <span
        style={{
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '10px',
          color: 'var(--gs-text-dim)',
          letterSpacing: '0.05em',
        }}
      >
        {status === 'final_ot' ? 'FINAL/OT' : 'FINAL'}
      </span>
    );
  }

  return (
    <span
      style={{
        fontFamily: 'var(--gs-font-mono)',
        fontSize: '10px',
        color: 'var(--gs-text-muted)',
        letterSpacing: '0.05em',
      }}
    >
      SCH
    </span>
  );
}

function GameRow({ game }: { game: GameApiItem }) {
  const isFinal = game.status === 'final' || game.status === 'final_ot';
  const isLive  = game.status === 'in_progress';
  const hasScore = game.home_score !== null && game.away_score !== null;

  const inner = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 16px',
        borderBottom: '1px solid rgba(0,229,255,0.05)',
      }}
    >
      {/* Teams + scores */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontFamily: 'var(--gs-font-body)',
          fontSize: '13px',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--gs-text-bright)', minWidth: '28px' }}>
          {game.away_team_detail.abbreviation}
        </span>
        {hasScore ? (
          <>
            <span style={{ color: 'var(--gs-text)', fontFamily: 'var(--gs-font-mono)', fontSize: '12px' }}>
              {game.away_score}
            </span>
            <span style={{ color: 'var(--gs-text-muted)', fontSize: '10px' }}>·</span>
            <span style={{ color: 'var(--gs-text)', fontFamily: 'var(--gs-font-mono)', fontSize: '12px' }}>
              {game.home_score}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--gs-text-muted)', fontSize: '10px' }}>vs</span>
        )}
        <span style={{ fontWeight: 700, color: 'var(--gs-text-bright)', minWidth: '28px' }}>
          {game.home_team_detail.abbreviation}
        </span>
      </div>

      {/* Status */}
      <StatusBadge status={game.status} />

      {/* Date */}
      <span
        style={{
          color: 'var(--gs-text-dim)',
          fontFamily: 'var(--gs-font-mono)',
          fontSize: '10px',
          whiteSpace: 'nowrap',
        }}
      >
        {formatDate(game.game_date)}
      </span>
    </div>
  );

  if (isFinal || isLive) {
    return (
      <Link
        href={`/gridstream/games/${game.id}`}
        style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        {inner}
      </Link>
    );
  }

  return <div>{inner}</div>;
}

export default function HubSchedule({
  games,
  week,
  season,
  isActive,
}: {
  games: GameApiItem[];
  week: number;
  season: number;
  isActive: boolean;
}) {
  const maxRows = isActive ? 8 : 4;
  const rows = games.slice(0, maxRows);

  // Hide entirely in offseason — out of place context
  if (!isActive) return null;

  const headerLabel = isActive ? `Week ${week} · ${season}` : `${season} Season Results`;

  return (
    <div
      style={{
        background: 'rgba(10, 16, 32, 0.6)',
        border: '1px solid var(--gs-cyan-border)',
        borderRadius: '4px',
        overflow: 'hidden',
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
          {headerLabel}
        </span>
        <Link
          href="/gridstream/games"
          style={{
            color: 'var(--gs-cyan-dim)',
            fontFamily: 'var(--gs-font-mono)',
            fontSize: '10px',
            textDecoration: 'none',
          }}
        >
          Games browser →
        </Link>
      </div>

      <div>
        {rows.map((game) => (
          <GameRow key={game.id} game={game} />
        ))}
      </div>
    </div>
  );
}
