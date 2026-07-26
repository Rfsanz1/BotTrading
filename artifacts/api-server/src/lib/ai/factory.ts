import OpenAIProvider from './adapters/openai';
import ClaudeProvider from './adapters/claude';
import GeminiProvider from './adapters/gemini';
import GroqProvider from './adapters/groq';
import DeepSeekProvider from './adapters/deepseek';
import OllamaProvider from './adapters/ollama';
import FutureProvider from './adapters/futureProvider';

const providers: Record<string, any> = {
  openai: OpenAIProvider,
  claude: ClaudeProvider,
  gemini: GeminiProvider,
  groq: GroqProvider,
  deepseek: DeepSeekProvider,
  ollama: OllamaProvider,
  future: FutureProvider,
};

export function createProvider(name: string, opts?: any) {
  const Cls = providers[name];
  if (!Cls) throw new Error('unknown provider ' + name);
  return new Cls(opts);
}

export function listProviders() { return Object.keys(providers); }

export default { createProvider, listProviders };
