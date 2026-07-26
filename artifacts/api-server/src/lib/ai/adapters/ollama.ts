import ProviderBase from '../ProviderBase';
import { Message, ChunkCallback } from '../IProvider';

export class OllamaProvider extends ProviderBase {
  name = 'ollama';
  constructor(private endpoint?: string) { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message> {
    const reply: Message = { id: `m-${Date.now()}`, role: 'assistant', content: 'Echo (ollama): ' + messages.map(m => m.content).join('\n'), timestamp: Date.now() };
    if (onChunk) { onChunk(reply.content); }
    return reply;
  }
}

export default OllamaProvider;
