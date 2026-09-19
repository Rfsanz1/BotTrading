import ProviderBase from '../ProviderBase';
import { Message } from '../../types';

const clampConfidence = (value: number): number => Math.min(1, Math.max(0, value));

export class FutureProvider extends ProviderBase {
  name = 'future';

  constructor(opts?: any) { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: (chunk: string) => void): Promise<Message> {
    const prompt = messages.map((m) => m.content).join('\n');
    const decision = /BUY/i.test(prompt) ? 'BUY' : /SELL/i.test(prompt) ? 'SELL' : 'HOLD';
    const confidence = clampConfidence(prompt.length ? 0.5 : 0.1);
    const payload = JSON.stringify({
      status: 'success',
      provider: this.name,
      decision,
      confidence,
      probability: confidence,
      setup: 'FALLBACK_PROVIDER',
      regime: 'UNKNOWN',
      reasoning: 'Forward-compatible provider placeholder safely returns a structured analysis object.',
      keyFactors: ['fallback_provider', 'market_snapshot'],
      risks: ['provider_fallback'],
      invalidationConditions: ['insufficient_data'],
    });

    if (onChunk) onChunk(payload);
    return { id: `m-${Date.now()}`, role: 'assistant', content: payload, timestamp: Date.now() };
  }
}

export default FutureProvider;
