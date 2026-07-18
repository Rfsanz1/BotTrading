const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Read/write the dashboard API key from localStorage */
export const apiKey = {
  get: (): string => localStorage.getItem('dashboard_api_key') ?? '',
  set: (key: string) => localStorage.setItem('dashboard_api_key', key),
  clear: () => localStorage.removeItem('dashboard_api_key'),
};

export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const isWrite = options?.method && options.method !== 'GET';
  const key = apiKey.get();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (isWrite && key) {
    headers['X-Dashboard-Key'] = key;
  }

  const res = await fetch(`${BASE}/bot/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  return res.json();
}
