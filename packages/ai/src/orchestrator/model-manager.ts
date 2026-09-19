import { ModelDefinition, OrchestratorProvider } from './types';

export class ModelManager {
  private models = new Map<string, ModelDefinition>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    const modelList: ModelDefinition[] = [
      { id: 'gpt-4o', provider: 'openai', name: 'gpt-4o', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false }, enabled: true, default: true },
      { id: 'claude-3-5-sonnet', provider: 'claude', name: 'claude-3-5-sonnet', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false }, enabled: true, default: true },
      { id: 'gemini-1.5-pro', provider: 'gemini', name: 'gemini-1.5-pro', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false }, enabled: true, default: true },
      { id: 'llama3-70b', provider: 'groq', name: 'llama3-70b', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: false }, enabled: true, default: true },
      { id: 'deepseek-chat', provider: 'deepseek', name: 'deepseek-chat', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: false }, enabled: true, default: true },
      { id: 'llama3.2', provider: 'ollama', name: 'llama3.2', capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: true }, enabled: true, default: true },
    ];

    for (const model of modelList) {
      this.models.set(`${model.provider}:${model.name}`, model);
    }
  }

  list(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  get(provider: OrchestratorProvider, name?: string): ModelDefinition | undefined {
    if (name) return this.models.get(`${provider}:${name}`);
    return this.list().find((m) => m.provider === provider && m.default);
  }
}

export default ModelManager;
