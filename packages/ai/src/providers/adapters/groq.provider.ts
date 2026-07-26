import ProviderBase from '../ProviderBase';
import { Message } from '../../types';

export class GroqProvider extends ProviderBase {
  name = 'groq';
  constructor(opts?: any) { super(); }
  async sendMessage(conversationId: string, messages: Message[], onChunk?: (chunk: string) => void): Promise<Message> {
    const content = `[Groq echo] ${messages.map(m => m.content).join('\n')}`;
    if (onChunk) onChunk(content);
    return { id: `m-${Date.now()}`, role: 'assistant', content, timestamp: Date.now() };
  }
}

export default GroqProvider;
