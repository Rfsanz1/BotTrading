import type { RouterConfig } from './router.config';
import type { AIChatRequest, AIChatResponse, AIModelsResponse, AIStreamChunk, AIEmbeddingRequest, AIEmbeddingResponse } from '../core/ai.types';
/**
 * Low-level Axios client for the 9Router gateway.
 * Handles auth headers, base URL, and SSE stream parsing.
 * All other logic (retry, timeout, logging) lives in RouterService.
 */
export declare class RouterClient {
    private readonly config;
    private readonly http;
    private readonly log;
    constructor(config: RouterConfig);
    chatCompletions(request: AIChatRequest): Promise<AIChatResponse>;
    streamCompletions(request: AIChatRequest): AsyncGenerator<AIStreamChunk, void, unknown>;
    getModels(): Promise<AIModelsResponse>;
    createEmbedding(request: AIEmbeddingRequest): Promise<AIEmbeddingResponse>;
    ping(model: string): Promise<{
        latencyMs: number;
    }>;
}
