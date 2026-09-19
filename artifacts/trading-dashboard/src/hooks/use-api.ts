import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';

export function useApiData<T>(endpoint: string, pollIntervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const lastFetched = useRef<number>(0);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiFetch<T>(endpoint);
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err);
      if (!lastFetched.current) {
        toast.error('Bot offline \u2014 configure API keys or start bot');
      }
    } finally {
      setLoading(false);
      lastFetched.current = Date.now();
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    if (pollIntervalMs) {
      const interval = setInterval(fetchData, pollIntervalMs);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [fetchData, pollIntervalMs]);

  return { data, loading, error, refetch: fetchData };
}
