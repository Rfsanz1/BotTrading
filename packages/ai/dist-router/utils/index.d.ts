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
export declare function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>;
/**
 * Race `fn` against a timeout. Throws an Error with "timed out" in the message
 * if the timeout fires first.
 */
export declare function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>;
/**
 * Parse a single SSE data line into a typed object, or null if it should
 * be skipped (empty, comment, [DONE]).
 */
export declare function parseSSELine<T>(line: string): T | null;
/**
 * Async-iterate an SSE text stream (already split into lines),
 * yielding parsed objects while skipping empty lines and [DONE].
 */
export declare function iterSSE<T>(lines: AsyncIterable<string>): AsyncGenerator<T>;
export declare function sleep(ms: number): Promise<void>;
/**
 * Clamp a number to [min, max].
 */
export declare function clamp(value: number, min: number, max: number): number;
/**
 * Extract the first JSON object from a string that may contain markdown fences.
 */
export declare function extractJsonBlock(text: string): string;
/**
 * Truncate a string to `maxLength` characters, appending '…' if cut.
 */
export declare function truncate(text: string, maxLength: number): string;
