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
  provider?: string;
  ownerId?: string;
  createdAt?: number;
  messages: Message[];
};

export type ProviderName = 'openai' | 'claude' | 'gemini' | 'groq' | 'deepseek' | 'ollama' | 'future';
