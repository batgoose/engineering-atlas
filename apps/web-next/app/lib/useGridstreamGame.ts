'use client';

/**
 * useGridstreamGame — React hook for the Gridstream live game store.
 *
 * Bridges the singleton GridStreamStore into React's rendering cycle
 * via useSyncExternalStore. Handles WebSocket connect/disconnect
 * on mount/unmount.
 */

import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import { gridStream, type ConnectionStatus } from '@atlas/sdk/gridstream/gridstream-store';
import type { LiveGameState, GameContext } from '@atlas/sdk/gridstream/types';

interface UseGridstreamGameOptions {
  /** WebSocket URL for the game feed. Null to skip connecting. */
  wsUrl: string | null;
  /** Initial game context from the REST API (for SSR hydration). */
  initialContext?: GameContext;
}

interface UseGridstreamGameReturn {
  state: LiveGameState;
  connectionStatus: ConnectionStatus;
  prevPlay: () => void;
  nextPlay: () => void;
  firstPlay: () => void;
  goLive: () => void;
  replay: () => void;
  isReplaying: boolean;
}

export function useGridstreamGame({
  wsUrl,
  initialContext,
}: UseGridstreamGameOptions): UseGridstreamGameReturn {
  const hydratedRef = useRef(false);

  // Hydrate from initial context once
  useEffect(() => {
    if (initialContext && !hydratedRef.current) {
      gridStream.hydrate(initialContext);
      hydratedRef.current = true;
    }
  }, [initialContext]);

  // Connect WebSocket on mount, disconnect on unmount
  useEffect(() => {
    if (!wsUrl) return;
    gridStream.connect(wsUrl);
    return () => gridStream.disconnect();
  }, [wsUrl]);

  // Subscribe to state via useSyncExternalStore (concurrent-safe)
  const state = useSyncExternalStore(
    useCallback((cb: () => void) => gridStream.subscribe(() => cb()), []),
    () => gridStream.getState(),
    () => gridStream.getState()
  );

  const connectionStatus = useSyncExternalStore(
    useCallback((cb: () => void) => gridStream.onStatusChange(() => cb()), []),
    () => gridStream.getStatus(),
    () => 'closed' as ConnectionStatus
  );

  return {
    state,
    connectionStatus,
    prevPlay: gridStream.prevPlay.bind(gridStream),
    nextPlay: gridStream.nextPlay.bind(gridStream),
    firstPlay: gridStream.firstPlay.bind(gridStream),
    goLive: gridStream.goLive.bind(gridStream),
    replay: gridStream.replay.bind(gridStream),
    isReplaying: state.playIndex !== -1,
  };
}
