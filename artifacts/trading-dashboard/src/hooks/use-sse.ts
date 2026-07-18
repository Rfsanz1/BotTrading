import { useState, useEffect, useRef, useCallback } from 'react';

export type SSEStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface SSEState<T> {
  data: T | null;
  status: SSEStatus;
}

const BASE = () => (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/**
 * useSSE — subscribe to the bot's /api/events Server-Sent Events stream.
 *
 * The stream sends a merged payload every 3 s:
 *   { status: {...}, positions: [...] }
 *
 * When the server closes the stream (sends `{"close":true}`) the hook
 * automatically reconnects after 1 s.  On network errors it retries after 5 s.
 */
export function useSSE<T>(endpoint: string): SSEState<T> {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearRetry = () => {
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    esRef.current?.close();
    clearRetry();

    const url = `${BASE()}/bot/api${endpoint}`;
    const es = new EventSource(url);
    esRef.current = es;
    setStatus('connecting');

    es.onopen = () => {
      if (!mountedRef.current) return;
      setStatus('connected');
    };

    es.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as T & { close?: boolean; error?: string };
        if ((parsed as any).close) {
          // Server wants us to reconnect — clean close
          es.close();
          setStatus('reconnecting');
          retryRef.current = setTimeout(connect, 1000);
          return;
        }
        if (!(parsed as any).error) {
          setData(parsed);
          setStatus('connected');
        }
      } catch {
        // ignore malformed frame
      }
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      es.close();
      setStatus('reconnecting');
      retryRef.current = setTimeout(connect, 5000);
    };
  }, [endpoint]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearRetry();
      esRef.current?.close();
    };
  }, [connect]);

  return { data, status };
}
