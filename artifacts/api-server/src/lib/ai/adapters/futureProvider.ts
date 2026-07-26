import ProviderBase from '../ProviderBase';
import { Message, ChunkCallback } from '../IProvider';

export class FutureProvider extends ProviderBase {
  name = 'future';
  constructor() { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message> {
    const reply: Message = { id: `m-${Date.now()}`, role: 'assistant', content: 'Echo (Future): ' + messages.map(m => m.content).join('\n'), timestamp: Date.now() };
    if (onChunk) { onChunk(reply.content); }
    return reply;
  }
}

export default FutureProvider;
