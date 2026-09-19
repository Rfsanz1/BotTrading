import ProviderBase from '../ProviderBase';
import { Message, ChunkCallback } from '../IProvider';

export class OpenAIProvider extends ProviderBase {
  name = 'openai';

  constructor(private apiKey?: string) { super(); }

  async sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message> {
    // Adapter stub: implement OpenAI API request and streaming
    // For now return an echo assistant message
    const reply: Message = { id: `m-${Date.now()}`, role: 'assistant', content: 'Echo (OpenAI): ' + messages.map(m => m.content).join('\n'), timestamp: Date.now() };
    if (onChunk) {
      const text = reply.content;
      for (let i = 0; i < text.length; i += 40) {
        onChunk(text.slice(i, i + 40));
        await new Promise(r => setTimeout(r, 10));
      }
    }
    return reply;
  }
}

export default OpenAIProvider;
