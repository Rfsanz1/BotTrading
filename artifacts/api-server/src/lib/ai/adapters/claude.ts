import ProviderBase from '../ProviderBase';
import { Message, ChunkCallback } from '../IProvider';

export class ClaudeProvider extends ProviderBase {
  name = 'claude';
  constructor(private apiKey?: string) { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message> {
    const reply: Message = { id: `m-${Date.now()}`, role: 'assistant', content: 'Echo (Claude): ' + messages.map(m => m.content).join('\n'), timestamp: Date.now() };
    if (onChunk) { onChunk(reply.content); }
    return reply;
  }
}

export default ClaudeProvider;
