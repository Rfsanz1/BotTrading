import ProviderBase from '../ProviderBase';
import { Message } from '../../types';

export class OpenAIProvider extends ProviderBase {
  name = 'openai';
  private apiKey?: string;
  constructor(opts?: { apiKey?: string }) { super(); this.apiKey = opts?.apiKey; }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: (chunk: string) => void): Promise<Message> {
    // TODO: plug real OpenAI SDK. This stub echoes combined content and simulates streaming chunks.
    const combined = messages.map(m => m.content).join('\n');
    const content = `[OpenAI echo] ${combined}`;
    if (onChunk) {
      for (let i = 0; i < content.length; i += 80) {
        onChunk(content.slice(i, i + 80));
        await new Promise(r => setTimeout(r, 8));
      }
    }
    return { id: `m-${Date.now()}`, role: 'assistant', content, timestamp: Date.now() };
  }
}

export default OpenAIProvider;
