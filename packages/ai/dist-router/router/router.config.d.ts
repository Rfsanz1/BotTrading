export declare const ROUTER_CONFIG: unique symbol;
export declare const ROUTER_SERVICE: unique symbol;
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
/**
 * Build RouterConfig from environment variables.
 * Never throws — unknown keys fall back to sensible defaults.
 */
export declare function loadRouterConfig(): RouterConfig;
