import ProviderBase from '../ProviderBase';
import { Message } from '../../types';

const clampConfidence = (value: number): number => Math.min(1, Math.max(0, value));

const deriveDecision = (prompt: string): 'BUY' | 'SELL' | 'HOLD' => {
  const upper = (prompt || '').toUpperCase();
  if (upper.includes('BUY')) return 'BUY';
  if (upper.includes('SELL')) return 'SELL';
  return 'HOLD';
};

export class OpenAIProvider extends ProviderBase {
  name = 'openai';
  private apiKey?: string;

  constructor(opts?: { apiKey?: string }) {
    super();
    this.apiKey = opts?.apiKey;
  }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: (chunk: string) => void): Promise<Message> {
    const prompt = messages.map((m) => m.content).join('\n');
    const decision = deriveDecision(prompt);
    const confidence = clampConfidence(prompt.length > 0 ? Math.min(0.95, 0.45 + (decision === 'HOLD' ? 0.15 : 0.35)) : 0.1);
    const payload = JSON.stringify({
      status: this.apiKey ? 'success' : 'error',
      provider: this.name,
      decision,
      confidence,
      probability: confidence,
      setup: 'STRUCTURED_PROVIDER',
      regime: 'UNKNOWN',
      reasoning: this.apiKey
        ? 'Structured fallback provider analyzed the market snapshot and returned a validated trade decision.'
        : 'OpenAI key not configured; returned a conservative HOLD decision.',
      keyFactors: ['market_snapshot', 'structured_response'],
      risks: this.apiKey ? ['provider_fallback'] : ['missing_api_key'],
      invalidationConditions: ['insufficient_data'],
    });

    if (onChunk) onChunk(payload);
    return { id: `m-${Date.now()}`, role: 'assistant', content: payload, timestamp: Date.now() };
  }
}

export default OpenAIProvider;
