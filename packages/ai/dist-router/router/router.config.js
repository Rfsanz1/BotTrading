"use strict";
// ─── Router configuration — reads exclusively from ENV ────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTER_SERVICE = exports.ROUTER_CONFIG = void 0;
exports.loadRouterConfig = loadRouterConfig;
exports.ROUTER_CONFIG = Symbol('ROUTER_CONFIG');
exports.ROUTER_SERVICE = Symbol('ROUTER_SERVICE');
function env(key, fallback) {
    return (process.env[key] ?? fallback).trim();
}
function envInt(key, fallback, min, max) {
    const v = process.env[key];
    if (!v)
        return fallback;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
/**
 * Build RouterConfig from environment variables.
 * Never throws — unknown keys fall back to sensible defaults.
 */
function loadRouterConfig() {
    const baseUrl = env('AI_BASE_URL', 'http://localhost:20128/v1').replace(/\/$/, '');
    const defaultModel = env('AI_MODEL', 'google/gemini-2.5-pro');
    return {
        baseUrl,
        apiKey: env('AI_API_KEY', ''),
        defaultModel,
        timeoutMs: envInt('AI_TIMEOUT_MS', 30_000, 1_000, 120_000),
        maxRetries: envInt('AI_MAX_RETRIES', 3, 0, 3),
        retryDelayMs: envInt('AI_RETRY_DELAY_MS', 1_000, 100, 30_000),
        healthModel: env('AI_HEALTH_MODEL', defaultModel),
        healthIntervalMs: envInt('AI_HEALTH_INTERVAL_MS', 60_000, 5_000, 86_400_000),
    };
}
