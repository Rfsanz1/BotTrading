const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const ACCESS_TOKEN_KEY = 'bot_access_token';

export const accessToken = {
  get: (): string => sessionStorage.getItem(ACCESS_TOKEN_KEY) ?? '',
  set: (token: string) => sessionStorage.setItem(ACCESS_TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(ACCESS_TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function requestUrl(endpoint: string) {
  return `${BASE}/bot${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = typeof body === 'object' && body && 'message' in body
      ? String((body as { message: unknown }).message)
      : typeof body === 'string' && body
        ? body
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  if (body && typeof body === 'object' && 'data' in body && 'ok' in body) {
    const data = (body as { data: unknown }).data;
    if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
      return (data as { data: T }).data;
    }
    return data as T;
  }
  return body as T;
}

async function refreshAccessToken(): Promise<string | null> {
  const res = await fetch(requestUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) return null;
  const body = await res.json() as { accessToken?: string; data?: { accessToken?: string } };
  const token = body.accessToken ?? body.data?.accessToken;
  if (!token) return null;
  accessToken.set(token);
  return token;
}

export async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  const token = accessToken.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(requestUrl(endpoint), { ...options, headers, credentials: 'include' });
  if (res.status === 401 && !endpoint.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set('Authorization', `Bearer ${refreshed}`);
      res = await fetch(requestUrl(endpoint), { ...options, headers, credentials: 'include' });
    }
    if (res.status === 401) {
      accessToken.clear();
      window.dispatchEvent(new Event('auth:expired'));
    }
  }
  return parseResponse<T>(res);
}

export async function login(email: string, password: string) {
  return apiFetch<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logoutSession() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    accessToken.clear();
  }
}
