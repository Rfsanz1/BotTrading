// ---------------------------------------------------------------------------
// Environment schema — validated once at startup, exported as typed config
// ---------------------------------------------------------------------------

export interface AppConfig {
  // App
  nodeEnv:  'development' | 'production' | 'test';
  port:     number;

  // Database
  databaseUrl: string;

  // Redis
  redisUrl: string;

  // JWT
  jwtSecret:    string;
  jwtExpiresIn: string;

  // ── 9Router AI Gateway ────────────────────────────────────────────────────
  /** Always '9router' — signals all AI traffic must go via 9Router. */
  aiProvider:  string;
  /** Base URL of the running 9Router instance.  ENV: AI_BASE_URL */
  aiBaseUrl:   string;
  /** Bearer token for the 9Router instance.     ENV: AI_API_KEY  */
  aiApiKey:    string;
  /** Default model forwarded to 9Router.        ENV: AI_MODEL    */
  aiModel:     string;
  /** Per-request timeout (ms).                  ENV: AI_TIMEOUT_MS */
  aiTimeoutMs: number;
  /** Max retries per request.                   ENV: AI_MAX_RETRIES */
  aiMaxRetries: number;

  // Legacy direct-SDK keys (kept for backward compatibility — prefer 9Router)
  openaiApiKey?:  string;
  anthropicKey?:  string;
  geminiApiKey?:  string;
  groqApiKey?:    string;
  deepseekKey?:   string;

  // Telegram
  telegramBotToken?: string;

  // Email (optional)
  emailEnabled:  boolean;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailFrom:     string;
  emailTo:       string;
  emailPassword: string;
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable: ${key}`);
  return v;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function optionalInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function flag(key: string, fallback = false): boolean {
  const v = process.env[key]?.toLowerCase();
  if (v === undefined) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function loadConfig(): AppConfig {
  const nodeEnv = (optional('NODE_ENV', 'development')) as AppConfig['nodeEnv'];

  return {
    nodeEnv,
    port: optionalInt('PORT', 3000),

    databaseUrl: required('DATABASE_URL'),
    redisUrl:    optional('REDIS_URL', 'redis://localhost:6379'),

    jwtSecret:    required('JWT_SECRET'),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '1d'),

    // 9Router AI Gateway
    aiProvider:   optional('AI_PROVIDER', '9router'),
    aiBaseUrl:    optional('AI_BASE_URL', 'http://localhost:20128/v1').replace(/\/$/, ''),
    aiApiKey:     optional('AI_API_KEY', ''),
    aiModel:      optional('AI_MODEL', 'google/gemini-2.5-pro'),
    aiTimeoutMs:  optionalInt('AI_TIMEOUT_MS', 30_000),
    aiMaxRetries: optionalInt('AI_MAX_RETRIES', 3),

    // Legacy direct-SDK keys (kept for backward compat — prefer 9Router)
    openaiApiKey:  optional('OPENAI_API_KEY')    || undefined,
    anthropicKey:  optional('ANTHROPIC_API_KEY') || undefined,
    geminiApiKey:  optional('GOOGLE_API_KEY')    || undefined,
    groqApiKey:    optional('GROQ_API_KEY')      || undefined,
    deepseekKey:   optional('DEEPSEEK_API_KEY')  || undefined,

    telegramBotToken: optional('TELEGRAM_BOT_TOKEN') || undefined,

    emailEnabled:  flag('EMAIL_ENABLED'),
    emailSmtpHost: optional('EMAIL_SMTP_HOST', 'smtp.gmail.com'),
    emailSmtpPort: optionalInt('EMAIL_SMTP_PORT', 587),
    emailFrom:     optional('EMAIL_FROM'),
    emailTo:       optional('EMAIL_TO'),
    emailPassword: optional('EMAIL_PASSWORD'),
  };
}

let _config: AppConfig | null = null;

/**
 * Returns the validated, typed application config.
 * Throws on first call if required env vars are missing.
 * Cached after first load.
 */
export function getConfig(): AppConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

/** Reset cached config (useful in tests). */
export function resetConfig(): void {
  _config = null;
}
