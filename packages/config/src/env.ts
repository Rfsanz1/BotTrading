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

  // External AI
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

    openaiApiKey:  optional('OPENAI_API_KEY')  || undefined,
    anthropicKey:  optional('ANTHROPIC_API_KEY') || undefined,
    geminiApiKey:  optional('GOOGLE_API_KEY')  || undefined,
    groqApiKey:    optional('GROQ_API_KEY')    || undefined,
    deepseekKey:   optional('DEEPSEEK_API_KEY') || undefined,

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
