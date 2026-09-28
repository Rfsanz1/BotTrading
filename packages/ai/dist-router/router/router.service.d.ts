import type { IRouterService } from '../core/ai.interface';
import type { AIMessage, AIChatResponse, AIStreamChunk, AIModel, AIHealthStatus, AIManagerOptions, AIEmbeddingRequest, AIEmbeddingResponse } from '../core/ai.types';
import { RouterClient } from './router.client';
import { RouterHealth } from './router.health';
import { type RouterConfig } from './router.config';
/**
 * Primary consumer-facing service for the 9Router gateway.
 * Implements IRouterService and adds retry, timeout, and logging on top of
 * the thin RouterClient.
 */
export declare class RouterService implements IRouterService {
    private readonly client;
    private readonly healthService;
    private readonly config;
    private readonly log;
    constructor(client: RouterClient, healthService: RouterHealth, config: RouterConfig);
    chat(messages: AIMessage[], options?: AIManagerOptions): Promise<AIChatResponse>;
    stream(messages: AIMessage[], options?: AIManagerOptions): AsyncGenerator<AIStreamChunk, void, unknown>;
    listModels(): Promise<AIModel[]>;
    health(): Promise<AIHealthStatus>;
    embeddings(request: AIEmbeddingRequest): Promise<AIEmbeddingResponse>;
}
