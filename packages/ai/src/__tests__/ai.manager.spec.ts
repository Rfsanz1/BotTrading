import { AIManager } from '../core/ai.manager';
import type { IRouterService } from '../core/ai.interface';
import type {
  AIChatResponse,
  AIHealthStatus,
  AIStreamChunk,
  AIMessage,
  AIManagerOptions,
} from '../core/ai.types';

// ─── Mock IRouterService ──────────────────────────────────────────────────────

function makeMockRouter(overrides: Partial<IRouterService> = {}): IRouterService {
  return {
    chat:       jest.fn(),
    stream:     jest.fn(),
    listModels: jest.fn(),
    health:     jest.fn(),
    ...overrides,
  } as IRouterService;
}

function fakeResponse(content = 'Test response', model = 'google/gemini-2.5-pro'): AIChatResponse {
  return {
    id:      `chatcmpl-${Math.random().toString(36).slice(2, 8)}`,
    object:  'chat.completion',
    created: Date.now(),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage:   { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  };
}

const testMessages: AIMessage[] = [{ role: 'user', content: 'Analyse BTC/USDT' }];

// ─── execute() ───────────────────────────────────────────────────────────────

describe('AIManager.execute()', () => {
  it('returns AIManagerResult on success', async () => {
    const response = fakeResponse('BUY signal');
    const router   = makeMockRouter({ chat: jest.fn().mockResolvedValue(response) });
    const manager  = new AIManager(router);

    const result = await manager.execute(testMessages, { retries: 0 });

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(1);
    expect(result.response.choices[0]?.message.content).toBe('BUY signal');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('marks status as retried when first attempt fails', async () => {
    const response = fakeResponse('Recovered');
    const chat = jest
      .fn()
      .mockRejectedValueOnce(new Error('Flaky network'))
      .mockResolvedValue(response);

    const router  = makeMockRouter({ chat });
    const manager = new AIManager(router);

    const result = await manager.execute(testMessages, { retries: 2, timeoutMs: 5_000 });

    expect(result.status).toBe('retried');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('throws when all retries are exhausted', async () => {
    const router  = makeMockRouter({
      chat: jest.fn().mockRejectedValue(new Error('Always fails')),
    });
    const manager = new AIManager(router);

    await expect(
      manager.execute(testMessages, { retries: 1, timeoutMs: 5_000 }),
    ).rejects.toThrow('Always fails');
  });

  it('propagates timeout error', async () => {
    const router = makeMockRouter({
      chat: jest.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 50ms')), 50)),
      ),
    });
    const manager = new AIManager(router);

    await expect(
      manager.execute(testMessages, { retries: 0, timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);
  });

  it('uses model from options over default', async () => {
    const response = fakeResponse('OK', 'openai/gpt-4o');
    const chat = jest.fn().mockResolvedValue(response);
    const router   = makeMockRouter({ chat });
    const manager  = new AIManager(router);

    const result = await manager.execute(testMessages, { model: 'openai/gpt-4o', retries: 0 });

    expect(result.model).toBe('openai/gpt-4o');
    const callArg = (chat as jest.Mock).mock.calls[0] as [AIMessage[], AIManagerOptions];
    expect(callArg[1]?.model).toBe('openai/gpt-4o');
  });
});

// ─── executeStream() ─────────────────────────────────────────────────────────

describe('AIManager.executeStream()', () => {
  it('yields chunks from the router', async () => {
    const chunks: AIStreamChunk[] = [
      {
        id: 'c1', object: 'chat.completion.chunk', created: 0,
        model: 'google/gemini-2.5-pro',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      },
    ];

    async function* gen() { for (const c of chunks) yield c; }
    const router  = makeMockRouter({ stream: jest.fn().mockReturnValue(gen()) });
    const manager = new AIManager(router);

    const collected: AIStreamChunk[] = [];
    for await (const chunk of manager.executeStream(testMessages)) {
      collected.push(chunk);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]?.choices[0]?.delta.content).toBe('Hello');
  });
});

// ─── healthCheck() ───────────────────────────────────────────────────────────

describe('AIManager.healthCheck()', () => {
  it('delegates to router.health()', async () => {
    const status: AIHealthStatus = {
      status: 'ok', latencyMs: 200, model: 'google/gemini-2.5-pro',
      baseUrl: 'http://localhost:20128/v1', checkedAt: Date.now(),
    };
    const router  = makeMockRouter({ health: jest.fn().mockResolvedValue(status) });
    const manager = new AIManager(router);

    const result = await manager.healthCheck();
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBe(200);
  });
});
