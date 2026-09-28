export interface RouterModelMeta {
    id: string;
    provider: string;
    contextWindow: number;
    supportsStreaming: boolean;
    supportsVision: boolean;
    tier: 'fast' | 'balanced' | 'powerful';
}
export declare const ROUTER_MODELS: RouterModelMeta[];
/** Default model when no override is provided via ENV or options. */
export declare const DEFAULT_MODEL = "google/gemini-2.5-pro";
/** Fast model for low-latency tasks (health pings, brief summaries). */
export declare const FAST_MODEL = "google/gemini-2.5-flash";
/**
 * Lookup a model by id. Returns undefined if not in the static catalog
 * (does not mean the model is unavailable — use /v1/models for the live list).
 */
export declare function getModelMeta(id: string): RouterModelMeta | undefined;
