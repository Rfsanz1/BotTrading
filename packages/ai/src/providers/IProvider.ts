import { Message } from '../types';

export type ChunkCallback = (chunk: string) => void;

export interface IProvider {
  name: string;
  sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message>;
}

export default IProvider;
