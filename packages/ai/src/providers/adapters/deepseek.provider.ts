import ProviderBase from '../ProviderBase';
import { Message } from '../../types';

export class DeepSeekProvider extends ProviderBase {
  name = 'deepseek';
  constructor(opts?: any) { super(); }
  async sendMessage(conversationId: string, messages: Message[], onChunk?: (chunk: string) => void): Promise<Message> {
    const content = `[DeepSeek echo] ${messages.map(m => m.content).join('\n')}`;
    if (onChunk) onChunk(content);
    return { id: `m-${Date.now()}`, role: 'assistant', content, timestamp: Date.now() };
  }
}

export default DeepSeekProvider;
