import OpenAIProvider from './providers/adapters/openai.provider';
import ClaudeProvider from './providers/adapters/claude.provider';
import GeminiProvider from './providers/adapters/gemini.provider';
import GroqProvider from './providers/adapters/groq.provider';
import DeepSeekProvider from './providers/adapters/deepseek.provider';
import FutureProvider from './providers/adapters/future.provider';
import type { ProviderName } from './types';

const map: Record<string, any> = {
  openai: OpenAIProvider,
  claude: ClaudeProvider,
  gemini: GeminiProvider,
  groq: GroqProvider,
  deepseek: DeepSeekProvider,
  future: FutureProvider,
};

export function createProvider(name: ProviderName, opts?: any) {
  const C = map[name];
  if (!C) throw new Error('Unknown provider ' + name);
  return new C(opts);
}

export function listProviders() { return Object.keys(map) as ProviderName[]; }

export default { createProvider, listProviders };
