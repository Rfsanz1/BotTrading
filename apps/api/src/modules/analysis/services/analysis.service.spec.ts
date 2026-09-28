import { AnalysisService, buildDecisionTimeContext } from './analysis.service';
import type { CandidateAiContext } from './analysis.service';
import type { CanonicalMarketState } from '../../market-intelligence/interfaces/canonical-market.interface';
import { AIModule, RouterService } from '@rfsanz/ai/router-production';

const validResponse = {
  id: 'resp-1',
  object: 'chat.completion' as const,
  created: 1,
  model: 'groq/llama-test',
  choices: [{
    index: 0,
    message: {
      role: 'assistant' as const,
      content: JSON.stringify({
        direction: 'LONG',
        confidenceRaw: 0.72,
        supportingFactors: ['trend'],
        conflictingFactors: [],
        riskWarnings: [],
        rationale: 'The supplied decision-time context supports the deterministic setup.',
      }),
    },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function fixtureState(overrides: Record<string, unknown> = {}): CanonicalMarketState {
  const timestamp = 1_000;
  return {
    symbol: 'TESTUSDT',
    marketType: 'spot',
    lastPrice: 10,
    bid: 9.99,
    ask: 10.01,
    mid: 10,
    candles: { '1m': [{ openTime: 100, closeTime: 900, open: 9, high: 11, low: 8, close: 10, volume: 5, closed: true }] },
    formingCandles: {},
    orderBook: null,
    tradeFlow: { updatedAt: timestamp },
    futures: { lastUpdateAt: timestamp },
    liquidation: { lastLiquidationTime: null },
    structure: {},
    timeframes: { '1m': { updatedAt: timestamp } },
    dataQuality: { state: 'HEALTHY' },
    lastUpdate: timestamp,
    lastEventType: 'trade',
    ...overrides,
  } as unknown as CanonicalMarketState;
}

function context(state = fixtureState()): CandidateAiContext {
  return { state, setupType: 'deterministic-setup', regime: { regime: 'TREND' }, opportunity: { score: 1 } };
}

describe('production AnalysisService canonical router path', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  function service(chat = jest.fn().mockResolvedValue(validResponse)) {
    const router = { chat };
    const health = { startPeriodicChecks: jest.fn(), stopPeriodicChecks: jest.fn(), check: jest.fn().mockResolvedValue({ status: 'ok', latencyMs: 5 }) };
    const repository = { findByAlertId: jest.fn(), findByProvider: jest.fn(), create: jest.fn() };
    const config = {
      baseUrl: 'https://router.example/v1', apiKey: '', defaultModel: 'groq/llama-test',
      timeoutMs: 2000, maxRetries: 1, retryDelayMs: 100,
      healthModel: 'groq/llama-test', healthIntervalMs: 60_000,
    };
    return {
      service: new AnalysisService({ emitAsync: jest.fn() } as never, router as never, health as never, config as never, repository as never),
      router,
    };
  }

  it('routes production candidate analysis through RouterService and never selects legacy provider classes', async () => {
    process.env.AI_BASE_URL = 'https://router.example/v1';
    process.env.AI_MODEL = 'groq/llama-test';
    const { service: analysis, router } = service();

    const result = await analysis.validateCandidate('TESTUSDT', context(), 1_100);

    expect(result.state).toBe('AI_VALID');
    expect(router.chat).toHaveBeenCalledTimes(1);
    expect(router.chat.mock.calls[0][0][1].content).toContain('"decisionTimestamp":1100');
    expect((analysis as unknown as { providers?: unknown }).providers).toBeUndefined();
    const registeredProviders = AIModule.register().providers ?? [];
    expect(registeredProviders).toContain(RouterService);
    expect(registeredProviders.some((provider) => typeof provider === 'function' && /OpenAI|Claude|Gemini|Groq|DeepSeek|Ollama/.test(provider.name))).toBe(false);
  });

  it('fails closed when canonical router configuration is absent', async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL;
    const { service: analysis, router } = service();

    await expect(analysis.validateCandidate('TESTUSDT', context(), 1_100))
      .resolves.toMatchObject({ state: 'AI_UNAVAILABLE' });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'AI_AUTH_ERROR'],
    [403, 'AI_AUTH_ERROR'],
    [429, 'AI_RATE_LIMITED'],
    [503, 'AI_SERVER_ERROR'],
  ])('classifies router HTTP %s errors as %s', async (status, expected) => {
    process.env.AI_BASE_URL = 'https://router.example/v1';
    process.env.AI_MODEL = 'groq/llama-test';
    const chat = jest.fn().mockRejectedValue({ response: { status } });
    const { service: analysis } = service(chat);

    await expect(analysis.validateCandidate('TESTUSDT', context(), 1_100))
      .resolves.toMatchObject({ state: expected });
  });

  it.each([
    ['malformed JSON', '{bad json}'],
    ['empty response', ''],
    ['missing fields', '{"direction":"LONG","confidenceRaw":0.5}'],
    ['out-of-range confidence', '{"direction":"LONG","confidenceRaw":1.1,"supportingFactors":[],"conflictingFactors":[],"riskWarnings":[],"rationale":"x"}'],
    ['extra fields', '{"direction":"LONG","confidenceRaw":0.5,"supportingFactors":[],"conflictingFactors":[],"riskWarnings":[],"rationale":"x","order":"BUY"}'],
  ])('classifies %s as AI_INVALID', async (_case, content) => {
    process.env.AI_BASE_URL = 'https://router.example/v1';
    process.env.AI_MODEL = 'groq/llama-test';
    const response = { ...validResponse, choices: [{ ...validResponse.choices[0], message: { role: 'assistant' as const, content } }] };
    const { service: analysis } = service(jest.fn().mockResolvedValue(response));

    await expect(analysis.validateCandidate('TESTUSDT', context(), 1_100))
      .resolves.toMatchObject({ state: 'AI_INVALID' });
  });

  it.each([
    ['future candle', { candles: { '1m': [{ openTime: 1_200, closeTime: 1_300, closed: true }] } }],
    ['future orderbook event', { orderBook: { lastEventTime: 1_200 } }],
    ['future trade', { tradeFlow: { updatedAt: 1_200 } }],
    ['future fill', { fills: [{ filledAt: 1_200 }] }],
    ['future outcome', { outcomes: [{ resolvedAt: 1_200 }] }],
    ['future calibration result', { calibration: [{ updatedAt: 1_200 }] }],
  ])('rejects %s before any provider request', async (_case, overrides) => {
    process.env.AI_BASE_URL = 'https://router.example/v1';
    process.env.AI_MODEL = 'groq/llama-test';
    const { service: analysis, router } = service();
    const state = fixtureState(overrides);

    await expect(analysis.validateCandidate('TESTUSDT', context(state), 1_100))
      .resolves.toMatchObject({ state: 'AI_INVALID' });
    expect(router.chat).not.toHaveBeenCalled();
  });

  it('includes only approved decision-time data in the canonical input projection', () => {
    const state = fixtureState({
      fills: [{ filledAt: 900, quantity: 1 }],
      outcomes: [{ resolvedAt: 900, pnl: 1 }],
      calibration: [{ updatedAt: 900, probability: 0.7 }],
    });

    const projection = buildDecisionTimeContext(context(state), 1_100);

    expect(JSON.stringify(projection)).not.toContain('fills');
    expect(JSON.stringify(projection)).not.toContain('outcomes');
    expect(JSON.stringify(projection)).not.toContain('calibration');
  });
});
