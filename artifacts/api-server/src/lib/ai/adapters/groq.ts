import ProviderBase from '../ProviderBase';
import { Message, ChunkCallback } from '../IProvider';

export class GroqProvider extends ProviderBase {
  name = 'groq';
  constructor(private apiKey?: string) { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message> {
    const reply: Message = { id: `m-${Date.now()}`, role: 'assistant', content: 'Echo (Groq): ' + messages.map(m => m.content).join('\n'), timestamp: Date.now() };
    if (onChunk) { onChunk(reply.content); }
    return reply;
  }
}

export default GroqProvider;
