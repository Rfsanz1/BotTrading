import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import { AIChatResponse, AIMessage, ROUTER_CONFIG, RouterHealth, RouterService, RouterConfig } from '@rfsanz/ai/router-production';
import { IAnalysisRepository } from '../../../domain/interfaces';
import { AIAnalysisCompletedEvent } from '../../../domain/events';
import { AnalysisRepository } from '../repositories/analysis.repository';
import type { StructuredAiValidation } from '../../market-intelligence/services/ai-validation.service';

export type AiFailureState = 'AI_UNAVAILABLE' | 'AI_INVALID' | 'AI_AUTH_ERROR' | 'AI_RATE_LIMITED' | 'AI_SERVER_ERROR';

export type CandidateAiResult =
  | { state: 'AI_VALID'; value: StructuredAiValidation }
  | { state: AiFailureState; reason: string };

export interface CandidateAiContext {
  state: import('../../market-intelligence/interfaces/canonical-market.interface').CanonicalMarketState;
  setupType: string;
  regime: unknown;
  opportunity: unknown;
}

const responseSchema = {
  type: 'object',
  required: ['direction', 'confidenceRaw', 'supportingFactors', 'conflictingFactors', 'riskWarnings', 'rationale'],
  additionalProperties: false,
  properties: {
    direction: { type: 'string', enum: ['LONG', 'SHORT', 'NEUTRAL'] },
    confidenceRaw: { type: 'number', minimum: 0, maximum: 1 },
    supportingFactors: { type: 'array', items: { type: 'string' } },
    conflictingFactors: { type: 'array', items: { type: 'string' } },
    riskWarnings: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string', minLength: 1 },
  },
};

@Injectable()
export class AnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly repository: IAnalysisRepository;
  private initialized = false;
  private lastSuccess: number | null = null;
  private lastFailure: { at: number; category: AiFailureState } | null = null;
  private lastLatencyMs: number | null = null;
  private requests = 0;
  private providerRequests = 0;
  private validResponses = 0;
  private invalidResponses = 0;
  private unavailable = 0;
  private authErrors = 0;
  private rateLimited = 0;
  private serverErrors = 0;
  private timeouts = 0;
  private latencyTotalMs = 0;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly router: RouterService,
    private readonly routerHealth: RouterHealth,
    @Inject(ROUTER_CONFIG) private readonly routerConfig: RouterConfig,
    analysisRepository: AnalysisRepository,
  ) {
    this.repository = analysisRepository;
    this.initialized = true;
  }

  onModuleInit(): void {
    if (process.env.AI_BASE_URL?.trim() && process.env.AI_MODEL?.trim()) this.routerHealth.startPeriodicChecks();
  }

  onModuleDestroy(): void {
    this.routerHealth.stopPeriodicChecks();
  }

  async validateCandidate(
    symbol: string,
    context: CandidateAiContext,
    decisionTimestamp: number,
  ): Promise<CandidateAiResult> {
    this.requests += 1;
    if (!process.env.AI_BASE_URL?.trim() || !process.env.AI_MODEL?.trim()) {
      return this.failure('AI_UNAVAILABLE', 'canonical AI_BASE_URL or AI_MODEL is not configured');
    }
    let safeContext: Record<string, unknown>;
    try {
      safeContext = buildDecisionTimeContext(context, decisionTimestamp);
    } catch {
      return this.failure('AI_INVALID', 'decision-time input contains future-dated data');
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `You are an advisory validator, not an execution agent. Return only one JSON object matching this schema exactly: ${JSON.stringify(responseSchema)}. Do not recommend orders or alter deterministic strategy levels. Assess only the supplied decision-time context.`,
      },
      {
        role: 'user',
        content: JSON.stringify({ symbol, decisionTimestamp, context: safeContext }),
      },
    ];
    const startedAt = Date.now();
    try {
      this.providerRequests += 1;
      const response = await this.router.chat(messages, {
        model: this.routerConfig.defaultModel,
        timeoutMs: this.routerConfig.timeoutMs,
        retries: this.routerConfig.maxRetries,
        temperature: 0,
        maxTokens: 500,
      });
      this.lastLatencyMs = Date.now() - startedAt;
      this.latencyTotalMs += this.lastLatencyMs;
      const output = parseStructuredResponse(response);
      if (!output) return this.failure('AI_INVALID', 'provider response failed the structured schema');
      this.lastSuccess = Date.now();
      this.lastFailure = null;
      this.validResponses += 1;
      return {
        state: 'AI_VALID',
        value: {
          ...output,
          setupType: context.setupType,
          invalidation: 'Deterministic strategy invalidation remains authoritative.',
          provider: '9Router',
          model: response.model || this.routerConfig.defaultModel,
          gateway: this.routerConfig.baseUrl,
          decisionTimestamp,
        },
      };
    } catch (error) {
      this.lastLatencyMs = Date.now() - startedAt;
      this.latencyTotalMs += this.lastLatencyMs;
      const category = classifyProviderFailure(error);
      return this.failure(category, category === 'AI_UNAVAILABLE' && isTimeoutError(error) ? 'TIMEOUT' : category);
    }
  }

  async analyzeAlert(alertId: string, userId: string, symbol: string, marketData: Record<string, any>): Promise<string> {
    try {
      if (!process.env.AI_BASE_URL?.trim() || !process.env.AI_MODEL?.trim()) throw new Error('AI_UNAVAILABLE: canonical router configuration missing');
      this.logger.log(`Starting AI analysis for alert ${alertId}, symbol ${symbol}`);
      const decisionTimestamp = Date.now();
      if (containsFutureTimestamp(marketData, decisionTimestamp)) throw new Error('AI_INVALID: marketData contains future-dated information');
      const response = await this.router.chat([
        { role: 'system', content: 'Return only a JSON object with direction, confidenceRaw, supportingFactors, conflictingFactors, riskWarnings, and rationale. Never issue or execute orders.' },
        { role: 'user', content: JSON.stringify({ symbol, decisionTimestamp, marketData }) },
      ], { model: this.routerConfig.defaultModel, temperature: 0, maxTokens: 500 });
      const structured = parseStructuredResponse(response);
      if (!structured) throw new Error('AI_INVALID');
      const provider = providerEnumFromModel(response.model || this.routerConfig.defaultModel);
      const analysisText = structured.rationale;
      await this.repository.create({
        alertId,
        symbol,
        provider,
        analysis: analysisText,
        confidence: structured.confidenceRaw,
        riskLevel: structured.riskWarnings.length ? 'HIGH' : 'LOW',
        sentiment: structured.direction,
        keyPoints: structured.supportingFactors,
        metadata: { source: '9router', model: response.model || this.routerConfig.defaultModel, gateway: this.routerConfig.baseUrl, decisionTimestamp },
      });
      const event = new AIAnalysisCompletedEvent(
        alertId,
        userId,
        symbol,
        [{
          provider,
          recommendation: structured.direction === 'LONG' ? 'BUY' : structured.direction === 'SHORT' ? 'SELL' : 'HOLD',
          confidence: structured.confidenceRaw,
          analysis: analysisText,
          riskLevel: structured.riskWarnings.length ? 'HIGH' : 'LOW',
        }],
      );
      await this.eventEmitter.emitAsync('trading.analysis.completed', event);
      this.logger.log(`AI analysis completed for alert ${alertId} via 9Router model ${response.model || this.routerConfig.defaultModel}`);
      return alertId;
    } catch (error) {
      this.logger.error(`Failed to analyze alert ${alertId}: ${error instanceof Error ? error.message : 'AI_UNAVAILABLE'}`);
      throw error;
    }
  }

  async getRuntimeStatus() {
    let reachable = false;
    let healthy = false;
    const endpointConfigured = Boolean(process.env.AI_BASE_URL && validGateway(this.routerConfig.baseUrl));
    const modelConfigured = Boolean(process.env.AI_MODEL?.trim());
    if (endpointConfigured && modelConfigured) {
      let health = this.routerHealth.getCached();
      if (Date.now() - health.checkedAt >= this.routerConfig.healthIntervalMs) {
        try {
          health = await this.routerHealth.check();
        } catch {
          reachable = false;
        }
      }
      reachable = health.status !== 'down';
      healthy = health.status === 'ok';
      this.lastLatencyMs = health.latencyMs >= 0 ? health.latencyMs : this.lastLatencyMs;
      if (!reachable && !this.lastFailure) this.lastFailure = { at: Date.now(), category: 'AI_UNAVAILABLE' };
    }
    const credentialConfigured = Boolean(process.env.AI_API_KEY?.trim());
    return {
      providerConfigured: endpointConfigured && modelConfigured,
      endpointConfigured,
      credentialConfigured,
      modelConfigured,
      initialized: this.initialized,
      reachable,
      healthy,
      provider: '9Router',
      model: this.routerConfig.defaultModel,
      gateway: this.routerConfig.baseUrl,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      latency: this.lastLatencyMs,
      requests: this.requests,
      providerRequests: this.providerRequests,
      validResponses: this.validResponses,
      unavailable: this.unavailable,
      invalid: this.invalidResponses,
      authErrors: this.authErrors,
      rateLimited: this.rateLimited,
      serverErrors: this.serverErrors,
      timeoutCount: this.timeouts,
      averageLatencyMs: this.providerRequests ? this.latencyTotalMs / this.providerRequests : null,
    };
  }

  private failure(state: AiFailureState, reason: string): CandidateAiResult {
    this.lastFailure = { at: Date.now(), category: state };
    if (state === 'AI_INVALID') this.invalidResponses += 1;
    else if (state === 'AI_AUTH_ERROR') this.authErrors += 1;
    else if (state === 'AI_RATE_LIMITED') this.rateLimited += 1;
    else if (state === 'AI_SERVER_ERROR') this.serverErrors += 1;
    else this.unavailable += 1;
    if (state === 'AI_UNAVAILABLE' && /timeout|timed out|etimedout|econnaborted/i.test(reason)) this.timeouts += 1;
    return { state, reason };
  }

  /**
   * Get analysis results for alert
   */
  async getAnalysisResults(alertId: string): Promise<any[]> {
    return this.repository.findByAlertId(alertId);
  }

  /**
   * Get provider performance
   */
  async getProviderStats(provider: string): Promise<any> {
    const analyses = await this.repository.findByProvider(provider, 100);

    if (analyses.length === 0) {
      return null;
    }

    const correctPredictions = analyses.filter((a: any) => a.sentiment).length;
    const accuracy = correctPredictions / analyses.length;

    return {
      provider,
      totalAnalyses: analyses.length,
      accuracy,
      avgConfidence: analyses.reduce((sum: number, a: any) => sum + Number(a.confidence), 0) / analyses.length,
    };
  }
}

function parseStructuredResponse(response: AIChatResponse): Omit<StructuredAiValidation, 'setupType' | 'invalidation' | 'provider' | 'model' | 'gateway' | 'decisionTimestamp'> | null {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const arrays = ['supportingFactors', 'conflictingFactors', 'riskWarnings'];
  if (!['LONG', 'SHORT', 'NEUTRAL'].includes(String(candidate.direction))
    || typeof candidate.confidenceRaw !== 'number'
    || !Number.isFinite(candidate.confidenceRaw) || candidate.confidenceRaw < 0 || candidate.confidenceRaw > 1
    || arrays.some((key) => !Array.isArray(candidate[key]) || (candidate[key] as unknown[]).some((entry) => typeof entry !== 'string'))
    || typeof candidate.rationale !== 'string' || !candidate.rationale.trim()
    || Object.keys(candidate).some((key) => ![...arrays, 'direction', 'confidenceRaw', 'rationale'].includes(key))) return null;
  return {
    direction: candidate.direction as StructuredAiValidation['direction'],
    confidenceRaw: candidate.confidenceRaw,
    supportingFactors: candidate.supportingFactors as string[],
    conflictingFactors: candidate.conflictingFactors as string[],
    riskWarnings: candidate.riskWarnings as string[],
    rationale: candidate.rationale,
  };
}

function classifyProviderFailure(error: unknown): AiFailureState {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401 || status === 403) return 'AI_AUTH_ERROR';
  if (status === 429) return 'AI_RATE_LIMITED';
  if (typeof status === 'number' && status >= 500) return 'AI_SERVER_ERROR';
  return 'AI_UNAVAILABLE';
}

function isTimeoutError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return candidate?.code === 'ETIMEDOUT' || candidate?.code === 'ECONNABORTED'
    || /timeout|timed out/i.test(candidate?.message ?? '');
}

function validGateway(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function providerEnumFromModel(model: string): string {
  const prefix = model.split('/')[0]?.toUpperCase();
  const providerMap: Record<string, string> = {
    OPENAI: 'OPENAI',
    ANTHROPIC: 'CLAUDE',
    CLAUDE: 'CLAUDE',
    GOOGLE: 'GEMINI',
    GEMINI: 'GEMINI',
    GROQ: 'GROQ',
    DEEPSEEK: 'DEEPSEEK',
    OLLAMA: 'OLLAMA',
  };
  if (providerMap[prefix]) return providerMap[prefix];
  throw new Error('Configured AI model does not map to a persisted provider identity');
}

export function buildDecisionTimeContext(context: CandidateAiContext, decisionTimestamp: number): Record<string, unknown> {
  if (!Number.isFinite(decisionTimestamp) || decisionTimestamp <= 0) throw new Error('Invalid decision timestamp');
  const { state } = context;
  const future = (value: number | null | undefined) => value !== null && value !== undefined && value > decisionTimestamp;
  if (containsFutureTimestamp(context, decisionTimestamp)
    || future(state.lastUpdate)
    || future(state.orderBook?.lastEventTime)
    || future(state.tradeFlow.updatedAt)
    || future(state.futures.lastUpdateAt)
    || future(state.liquidation.lastLiquidationTime)
    || Object.values(state.timeframes).some((feature) => feature && future(feature.updatedAt))
    || Object.values(state.candles).flat().some((candle) => future(candle.openTime) || future(candle.closeTime))) {
    throw new Error('Future-dated market input');
  }
  return {
    decisionTimestamp,
    marketType: state.marketType,
    lastPrice: state.lastPrice,
    bid: state.bid,
    ask: state.ask,
    candles: Object.fromEntries(Object.entries(state.candles).map(([timeframe, candles]) => [
      timeframe,
      candles.filter((candle) => candle.closed && candle.closeTime <= decisionTimestamp).slice(-200),
    ])),
    orderBook: state.orderBook && state.orderBook.lastEventTime !== null && state.orderBook.lastEventTime <= decisionTimestamp
      ? state.orderBook : null,
    tradeFlow: state.tradeFlow.updatedAt !== null && state.tradeFlow.updatedAt <= decisionTimestamp ? state.tradeFlow : null,
    futures: state.futures.lastUpdateAt !== null && state.futures.lastUpdateAt <= decisionTimestamp ? state.futures : null,
    timeframes: Object.fromEntries(Object.entries(state.timeframes).filter(([, feature]) =>
      feature && feature.updatedAt <= decisionTimestamp)),
    dataQuality: state.dataQuality,
    setupType: context.setupType,
    regime: context.regime,
    opportunity: context.opportunity,
  };
}

function containsFutureTimestamp(value: unknown, decisionTimestamp: number, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (value instanceof Date) return value.getTime() > decisionTimestamp;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsFutureTimestamp(item, decisionTimestamp, seen));
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    const timestampField = /(?:timestamp|time|updatedat|createdat|eventtime|opentime|closetime|filledat|resolvedat)$/i.test(key);
    if (timestampField && typeof item === 'number' && item > decisionTimestamp) return true;
    return containsFutureTimestamp(item, decisionTimestamp, seen);
  });
}
