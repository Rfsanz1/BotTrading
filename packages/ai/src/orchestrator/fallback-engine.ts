import { OrchestratorProvider } from './types';

export class FallbackEngine {
  private fallbackMap: Record<OrchestratorProvider, OrchestratorProvider> = {
    openai: 'claude',
    claude: 'gemini',
    gemini: 'groq',
    groq: 'deepseek',
    deepseek: 'ollama',
    ollama: 'openai',
  };

  getFallback(provider: OrchestratorProvider): OrchestratorProvider | undefined {
    return this.fallbackMap[provider];
  }

  handle(provider: OrchestratorProvider, reason: string) {
    console.warn(`Fallback triggered for ${provider}: ${reason}`);
  }
}

export default FallbackEngine;
