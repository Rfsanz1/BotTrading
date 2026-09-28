"use strict";
// ─── Known model identifiers for 9Router ─────────────────────────────────────
// These are reference constants. 9Router /v1/models returns the live list.
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAST_MODEL = exports.DEFAULT_MODEL = exports.ROUTER_MODELS = void 0;
exports.getModelMeta = getModelMeta;
exports.ROUTER_MODELS = [
    // ── Google ────────────────────────────────────────────────────────────────
    {
        id: 'google/gemini-2.5-pro',
        provider: 'google',
        contextWindow: 1_048_576,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'powerful',
    },
    {
        id: 'google/gemini-2.5-flash',
        provider: 'google',
        contextWindow: 1_048_576,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'fast',
    },
    {
        id: 'google/gemini-2.0-flash',
        provider: 'google',
        contextWindow: 1_048_576,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'fast',
    },
    // ── Anthropic ─────────────────────────────────────────────────────────────
    {
        id: 'anthropic/claude-sonnet-4-5',
        provider: 'anthropic',
        contextWindow: 200_000,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'powerful',
    },
    {
        id: 'anthropic/claude-haiku-3-5',
        provider: 'anthropic',
        contextWindow: 200_000,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'fast',
    },
    // ── OpenAI ────────────────────────────────────────────────────────────────
    {
        id: 'openai/gpt-4o',
        provider: 'openai',
        contextWindow: 128_000,
        supportsStreaming: true,
        supportsVision: true,
        tier: 'powerful',
    },
    {
        id: 'openai/gpt-4o-mini',
        provider: 'openai',
        contextWindow: 128_000,
        supportsStreaming: true,
        supportsVision: false,
        tier: 'fast',
    },
    // ── Meta / Groq ───────────────────────────────────────────────────────────
    {
        id: 'meta-llama/llama-3.1-70b-instruct',
        provider: 'meta',
        contextWindow: 131_072,
        supportsStreaming: true,
        supportsVision: false,
        tier: 'balanced',
    },
    {
        id: 'deepseek/deepseek-r1',
        provider: 'deepseek',
        contextWindow: 65_536,
        supportsStreaming: true,
        supportsVision: false,
        tier: 'balanced',
    },
];
/** Default model when no override is provided via ENV or options. */
exports.DEFAULT_MODEL = 'google/gemini-2.5-pro';
/** Fast model for low-latency tasks (health pings, brief summaries). */
exports.FAST_MODEL = 'google/gemini-2.5-flash';
/**
 * Lookup a model by id. Returns undefined if not in the static catalog
 * (does not mean the model is unavailable — use /v1/models for the live list).
 */
function getModelMeta(id) {
    return exports.ROUTER_MODELS.find((m) => m.id === id);
}
