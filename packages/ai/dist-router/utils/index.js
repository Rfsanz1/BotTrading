"use strict";
// ─── Retry ───────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
exports.withTimeout = withTimeout;
exports.parseSSELine = parseSSELine;
exports.iterSSE = iterSSE;
exports.sleep = sleep;
exports.clamp = clamp;
exports.extractJsonBlock = extractJsonBlock;
exports.truncate = truncate;
/**
 * Execute `fn` with exponential-backoff retries.
 * Throws the last error if all attempts fail.
 */
async function withRetry(fn, options = {}) {
    const { retries = 3, delayMs = 1_000, factor = 2, maxDelayMs = 30_000, onRetry, shouldAbort, } = options;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === retries)
                break;
            if (shouldAbort?.(error))
                break;
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
async function withTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        fn().then((result) => { clearTimeout(timer); resolve(result); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
// ─── SSE parsing ─────────────────────────────────────────────────────────────
/**
 * Parse a single SSE data line into a typed object, or null if it should
 * be skipped (empty, comment, [DONE]).
 */
function parseSSELine(line) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data: '))
        return null;
    const payload = trimmed.slice(6).trim();
    if (payload === '[DONE]')
        return null;
    try {
        return JSON.parse(payload);
    }
    catch {
        return null;
    }
}
/**
 * Async-iterate an SSE text stream (already split into lines),
 * yielding parsed objects while skipping empty lines and [DONE].
 */
async function* iterSSE(lines) {
    for await (const line of lines) {
        const parsed = parseSSELine(line);
        if (parsed !== null)
            yield parsed;
    }
}
// ─── General helpers ──────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Clamp a number to [min, max].
 */
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Extract the first JSON object from a string that may contain markdown fences.
 */
function extractJsonBlock(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (fenced?.[1])
        return fenced[1].trim();
    const brace = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (brace !== -1 && last !== -1 && last > brace)
        return text.slice(brace, last + 1);
    return text.trim();
}
/**
 * Truncate a string to `maxLength` characters, appending '…' if cut.
 */
function truncate(text, maxLength) {
    if (text.length <= maxLength)
        return text;
    return text.slice(0, maxLength - 1) + '…';
}
