export type Role = 'user' | 'assistant' | 'system';

export type Message = {
  id: string;
  role: Role;
  content: string;
  meta?: Record<string, any>;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title?: string;
  provider: string;
  createdAt: number;
  messages: Message[];
  ownerId?: string;
};

export type ChunkCallback = (chunk: string) => void;

export interface IProvider {
  name: string;
  // send a message and stream chunks via onChunk; resolves to final assistant message
  sendMessage(conversationId: string, messages: Message[], onChunk?: ChunkCallback): Promise<Message>;
}

export default IProvider;
