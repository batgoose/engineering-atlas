'use client';

/**
 * Route: /gridstream
 *
 * Live game view for Gridstream.
 * Connects to the Go WebSocket hub for real-time updates
 * and hydrates initial state from the Django REST API.
 *
 * TODO: Once the scoreboard dashboard exists, this becomes the
 * game detail view at /gridstream/[gameId] and the scoreboard
 * takes over /gridstream. For now this serves as both.
 */

import { useSearchParams } from 'next/navigation';
import { useGridstreamGame } from '@/app/lib/useGridstreamGame';
import { LiveGameView } from '@/components/gridstream/LiveGameView';

const WS_BASE = process.env.NEXT_PUBLIC_GRIDSTREAM_WS_URL ?? 'ws://localhost:8085/ws';

export default function GridstreamPage() {
  const searchParams = useSearchParams();
  const gameId = searchParams.get('game');

  const wsUrl = gameId ? `${WS_BASE}/game/${gameId}` : null;

  const {
    state,
    replay,
    prevPlay,
    nextPlay,
    firstPlay,
    goLive,
    isReplaying,
  } = useGridstreamGame({ wsUrl });

  return (
    <LiveGameView
      state={state}
      onReplay={replay}
      onPrev={prevPlay}
      onNext={nextPlay}
      onFirst={firstPlay}
      onLive={goLive}
      isReplaying={isReplaying}
    />
  );
}
