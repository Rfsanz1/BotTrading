// ─── Retry ───────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Number of additional attempts after the first failure. Default: 3 */
  retries?: number;
  /** Base delay in ms between retries. Default: 1000 */
  delayMs?: number;
  /** Exponential backoff multiplier. Default: 2 */
  factor?: number;
  /** Max delay cap in ms. Default: 30000 */
  maxDelayMs?: number;
  /** Called before each retry (attempt = 1-based retry number). */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Return true to stop retrying early (e.g. 4xx errors). */
  shouldAbort?: (error: unknown) => boolean;
}

/**
 * Execute `fn` with exponential-backoff retries.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries    = 3,
    delayMs    = 1_000,
    factor     = 2,
    maxDelayMs = 30_000,
    onRetry,
    shouldAbort,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === retries) break;
      if (shouldAbort?.(error)) break;

      onRetry?.(attempt + 1, error);

      const wait = Math.min(delayMs * Math.pow(factor, attempt), maxDelayMs);
      await sleep(wait);
    }
  }

  throw lastError;
}

// ─── Timeout ─────────────────────────────────────────────────────────────────

/**
 * Race `fn` against a timeout. Throws an Error with "timed out" in the message
 * if the timeout fires first.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn().then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error)  => { clearTimeout(timer); reject(error); },
    );
  });
}

// ─── SSE parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a single SSE data line into a typed object, or null if it should
 * be skipped (empty, comment, [DONE]).
 */
export function parseSSELine<T>(line: string): T | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;
  const payload = trimmed.slice(6).trim();
  if (payload === '[DONE]') return null;

  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Async-iterate an SSE text stream (already split into lines),
 * yielding parsed objects while skipping empty lines and [DONE].
 */
export async function* iterSSE<T>(lines: AsyncIterable<string>): AsyncGenerator<T> {
  for await (const line of lines) {
    const parsed = parseSSELine<T>(line);
    if (parsed !== null) yield parsed;
  }
}

// ─── General helpers ──────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clamp a number to [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Extract the first JSON object from a string that may contain markdown fences.
 */
export function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced?.[1]) return fenced[1].trim();
  const brace = text.indexOf('{');
  const last  = text.lastIndexOf('}');
  if (brace !== -1 && last !== -1 && last > brace) return text.slice(brace, last + 1);
  return text.trim();
}

/**
 * Truncate a string to `maxLength` characters, appending '…' if cut.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
