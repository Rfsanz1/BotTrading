// ─── Router configuration — reads exclusively from ENV ────────────────────────

export const ROUTER_CONFIG  = Symbol('ROUTER_CONFIG');
export const ROUTER_SERVICE = Symbol('ROUTER_SERVICE');

export interface RouterConfig {
  /** Base URL of the 9Router instance (no trailing slash).
   *  ENV: AI_BASE_URL  default: http://localhost:20128/v1 */
  baseUrl: string;

  /** Bearer token sent in the Authorization header.
   *  ENV: AI_API_KEY  default: '' (unauthenticated local instance) */
  apiKey: string;

  /** Model identifier forwarded to 9Router.
   *  ENV: AI_MODEL  default: google/gemini-2.5-pro */
  defaultModel: string;

  /** Per-request HTTP timeout in ms.
   *  ENV: AI_TIMEOUT_MS  default: 30000 */
  timeoutMs: number;

  /** Maximum retry attempts for failed requests.
   *  ENV: AI_MAX_RETRIES  default: 3 */
  maxRetries: number;

  /** Base delay between retries (ms). Doubles each attempt.
   *  ENV: AI_RETRY_DELAY_MS  default: 1000 */
  retryDelayMs: number;

  /** Model used exclusively for health-check pings.
   *  ENV: AI_HEALTH_MODEL  default: same as defaultModel */
  healthModel: string;

  /** How often the RouterHealth service pings (ms).
   *  ENV: AI_HEALTH_INTERVAL_MS  default: 60000 */
  healthIntervalMs: number;
}

function env(key: string, fallback: string): string {
  return (process.env[key] ?? fallback).trim();
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build RouterConfig from environment variables.
 * Never throws — unknown keys fall back to sensible defaults.
 */
export function loadRouterConfig(): RouterConfig {
  const baseUrl = env('AI_BASE_URL', 'http://localhost:20128/v1').replace(/\/$/, '');
  const defaultModel = env('AI_MODEL', 'google/gemini-2.5-pro');

  return {
    baseUrl,
    apiKey:           env('AI_API_KEY', ''),
    defaultModel,
    timeoutMs:        envInt('AI_TIMEOUT_MS', 30_000),
    maxRetries:       envInt('AI_MAX_RETRIES', 3),
    retryDelayMs:     envInt('AI_RETRY_DELAY_MS', 1_000),
    healthModel:      env('AI_HEALTH_MODEL', defaultModel),
    healthIntervalMs: envInt('AI_HEALTH_INTERVAL_MS', 60_000),
  };
}
