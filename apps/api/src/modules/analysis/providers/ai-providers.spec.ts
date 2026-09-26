import { OpenAIProvider } from './ai-providers';

describe('AI provider runtime contract', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('reports missing production configuration without exposing secrets', () => {
    delete process.env.AI_OPENAI_ENDPOINT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_MODEL;

    const status = new OpenAIProvider().runtimeStatus();

    expect(status).toEqual({
      provider: 'OPENAI',
      endpointConfigured: false,
      credentialConfigured: false,
      modelConfigured: false,
    });
  });

  it('accepts only valid structured provider output', async () => {
    process.env.AI_OPENAI_ENDPOINT = 'https://provider.invalid';
    process.env.OPENAI_API_KEY = 'test-only';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      recommendation: 'BUY',
      confidence: 0.8,
      analysis: 'valid structured response',
      riskLevel: 'LOW',
      keyPoints: ['trend'],
    }), { status: 200 }));

    await expect(new OpenAIProvider().analyzeMarket('TESTUSDT', { timestamp: 1 }))
      .resolves.toMatchObject({ recommendation: 'BUY', confidence: 0.8 });
  });

  it('aborts a provider request at the configured timeout', async () => {
    process.env.AI_OPENAI_ENDPOINT = 'https://provider.invalid';
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.AI_REQUEST_TIMEOUT_MS = '1000';
    jest.spyOn(global, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    await expect(new OpenAIProvider().analyzeMarket('TESTUSDT', { timestamp: 1 }))
      .rejects.toThrow('AI analysis failed for provider OPENAI');
  });
});
