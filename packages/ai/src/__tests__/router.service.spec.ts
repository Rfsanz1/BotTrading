import { RouterService } from '../router/router.service';
import { RouterClient }  from '../router/router.client';
import { RouterHealth }  from '../router/router.health';
import { loadRouterConfig } from '../router/router.config';
import type { AIChatResponse, AIModelsResponse, AIStreamChunk } from '../core/ai.types';

// ─── Minimal mocks ────────────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<RouterClient> = {}): RouterClient {
  return {
    chatCompletions: jest.fn(),
    streamCompletions: jest.fn(),
    getModels: jest.fn(),
    createEmbedding: jest.fn(),
    ping: jest.fn(),
    ...overrides,
  } as unknown as RouterClient;
}

function makeMockHealth(overrides: Partial<RouterHealth> = {}): RouterHealth {
  return {
    check: jest.fn(),
    getCached: jest.fn(),
    startPeriodicChecks: jest.fn(),
    stopPeriodicChecks: jest.fn(),
    ...overrides,
  } as unknown as RouterHealth;
}

const testConfig = loadRouterConfig();

// ─── chat() ───────────────────────────────────────────────────────────────────

describe('RouterService.chat()', () => {
  it('returns the chat response from RouterClient', async () => {
    const mockResponse: AIChatResponse = {
      id:      'chatcmpl-test-1',
      object:  'chat.completion',
      created: 1_700_000_000,
      model:   'google/gemini-2.5-pro',
      choices: [
        {
          index:        0,
          message:      { role: 'assistant', content: 'Hello, trader!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const client = makeMockClient({
      chatCompletions: jest.fn().mockResolvedValue(mockResponse),
    });
    const health  = makeMockHealth();
    const svc     = new RouterService(client, health, testConfig);

    const result = await svc.chat(
      [{ role: 'user', content: 'Hello' }],
      { model: 'google/gemini-2.5-pro' },
    );

    expect(result.choices[0]?.message.content).toBe('Hello, trader!');
    expect(result.model).toBe('google/gemini-2.5-pro');
    expect(client.chatCompletions).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure and succeeds on second attempt', async () => {
    const mockResponse: AIChatResponse = {
      id:      'chatcmpl-retry',
      object:  'chat.completion',
      created: 1_700_000_001,
      model:   'google/gemini-2.5-pro',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage:   { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };

    const chatCompletions = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(mockResponse);

    const client = makeMockClient({ chatCompletions });
    const health = makeMockHealth();
    const svc    = new RouterService(client, health, {
      ...testConfig,
      maxRetries:   2,
      retryDelayMs: 0, // no delay in tests
    });

    const result = await svc.chat([{ role: 'user', content: 'test' }]);
    expect(result.id).toBe('chatcmpl-retry');
    expect(chatCompletions).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const client = makeMockClient({
      chatCompletions: jest.fn().mockRejectedValue(new Error('Persistent error')),
    });
    const svc = new RouterService(client, makeMockHealth(), {
      ...testConfig,
      maxRetries:   1,
      retryDelayMs: 0,
    });

    await expect(
      svc.chat([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow('Persistent error');
  });
});

// ─── listModels() ─────────────────────────────────────────────────────────────

describe('RouterService.listModels()', () => {
  it('returns the model list from RouterClient', async () => {
    const mockModels: AIModelsResponse = {
      object: 'list',
      data: [
        { id: 'google/gemini-2.5-pro', object: 'model', created: 0, owned_by: 'google' },
      ],
    };

    const client = makeMockClient({
      getModels: jest.fn().mockResolvedValue(mockModels),
    });
    const svc = new RouterService(client, makeMockHealth(), testConfig);

    const models = await svc.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('google/gemini-2.5-pro');
  });
});

// ─── health() ─────────────────────────────────────────────────────────────────

describe('RouterService.health()', () => {
  it('delegates to RouterHealth.check()', async () => {
    const healthStatus = {
      status:    'ok' as const,
      latencyMs: 120,
      model:     'google/gemini-2.5-pro',
      baseUrl:   'http://localhost:20128/v1',
      checkedAt: Date.now(),
    };

    const healthSvc = makeMockHealth({
      check: jest.fn().mockResolvedValue(healthStatus),
    });
    const svc = new RouterService(makeMockClient(), healthSvc, testConfig);

    const result = await svc.health();
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBe(120);
    expect(healthSvc.check).toHaveBeenCalledTimes(1);
  });
});

// ─── stream() ─────────────────────────────────────────────────────────────────

describe('RouterService.stream()', () => {
  it('yields chunks from RouterClient.streamCompletions', async () => {
    const chunk1: AIStreamChunk = {
      id: 'chunk-1', object: 'chat.completion.chunk', created: 0,
      model: 'google/gemini-2.5-pro',
      choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
    };
    const chunk2: AIStreamChunk = {
      id: 'chunk-2', object: 'chat.completion.chunk', created: 0,
      model: 'google/gemini-2.5-pro',
      choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }],
    };

    async function* fakeStream() { yield chunk1; yield chunk2; }

    const client = makeMockClient({
      streamCompletions: jest.fn().mockReturnValue(fakeStream()),
    });
    const svc = new RouterService(client, makeMockHealth(), testConfig);

    const collected: AIStreamChunk[] = [];
    for await (const c of svc.stream([{ role: 'user', content: 'Hi' }])) {
      collected.push(c);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0]?.choices[0]?.delta.content).toBe('Hello');
    expect(collected[1]?.choices[0]?.delta.content).toBe(' world');
  });
});
