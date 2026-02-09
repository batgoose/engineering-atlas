import { useEffect, useState } from 'react';
import { gridStream } from '@atlas/sdk';
import type { GameEvent, ConnectionStatus } from '@atlas/sdk';

export const useGridStream = () => {
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>(gridStream.getStatus());

  useEffect(() => {
    // Use the ENV variable we set up in .env.local
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://go-service.localhost/ws';
    gridStream.connect(wsUrl);

    const unsubStatus = gridStream.onStatusChange(setStatus);
    const unsubEvents = gridStream.subscribe((newEvent) => {
      setEvents((prev) => [newEvent, ...prev].slice(0, 5));
    });

    return () => {
      unsubStatus();
      unsubEvents();
    };
  }, []);

  return { events, status };
};
