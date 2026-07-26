import IProvider, { ChunkCallback } from './IProvider';
import { Message } from '../types';

export abstract class ProviderBase implements IProvider {
  abstract name: string;
  abstract sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message>;
}

export default ProviderBase;
