import type { Message, ProviderName } from './types';
import { EventEmitter } from 'eventemitter3';

type StreamEvent = { provider: ProviderName; chunk: string };

export class AIService {
  private emitter = new EventEmitter();

  listProviders() {
    return [] as ProviderName[];
  }

  async sendMessage(_providerName: ProviderName, _conversationId: string, _messages: Message[], _onChunk?: (chunk: string) => void) {
    throw new Error('Legacy AIService is disabled in production. Use the canonical RouterService from packages/ai/router-production.');
  }

  async *streamConsensus(_conversationId: string, _messages: Message[], _providers: ProviderName[]): AsyncGenerator<{ provider: ProviderName; chunk: string } | { done: true; result?: Message }, void, unknown> {
    throw new Error('Legacy AIService is disabled in production. Use the canonical RouterService from packages/ai/router-production.');
  }

  async consensus(_conversationId: string, _messages: Message[], _providers: ProviderName[]) {
    throw new Error('Legacy AIService is disabled in production. Use the canonical RouterService from packages/ai/router-production.');
  }
}

export default new AIService();
