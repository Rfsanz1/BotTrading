import type { AIHealthStatus } from '../core/ai.types';
import { RouterClient } from './router.client';
import { type RouterConfig } from './router.config';
/**
 * Tracks liveness of the 9Router gateway.
 * Performs periodic background pings and caches the latest status so callers
 * can query health synchronously without incurring an extra network round-trip.
 */
export declare class RouterHealth {
    private readonly client;
    private readonly config;
    private readonly log;
    private latest;
    private timer;
    constructor(client: RouterClient, config: RouterConfig);
    startPeriodicChecks(): void;
    stopPeriodicChecks(): void;
    check(): Promise<AIHealthStatus>;
    getCached(): AIHealthStatus;
    private classify;
    private unknown;
}
