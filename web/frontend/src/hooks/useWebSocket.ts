'use client';
import { useEffect, useRef, useCallback } from 'react';
import { WSClient } from '@/lib/ws';
import type { WSMessage } from '@/lib/types';

export function useWebSocket(onMessage?: (msg: WSMessage) => void) {
  const clientRef = useRef<WSClient | null>(null);

  useEffect(() => {
    const client = new WSClient();
    clientRef.current = client;
    client.connect();

    let unsub: (() => void) | undefined;
    if (onMessage) {
      unsub = client.onMessage(onMessage);
    }

    return () => {
      unsub?.();
      client.disconnect();
    };
  }, []);

  // Re-register handler when it changes
  useEffect(() => {
    if (!clientRef.current || !onMessage) return;
    const unsub = clientRef.current.onMessage(onMessage);
    return unsub;
  }, [onMessage]);

  const subscribe = useCallback((taskId: string) => {
    clientRef.current?.subscribe(taskId);
  }, []);

  return { subscribe, client: clientRef };
}
