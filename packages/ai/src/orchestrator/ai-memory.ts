import { AIResponse } from './types';

export class AIMemory {
  private responses: AIResponse[] = [];
  private facts = new Map<string, string>();

  store(response: AIResponse) {
    this.responses.push(response);
    this.facts.set(`${response.provider}:${response.model}`, `${response.content.slice(0, 120)} (${response.timestamp})`);
  }

  list(): AIResponse[] {
    return [...this.responses];
  }

  getRecent(limit = 10): AIResponse[] {
    return this.responses.slice(-limit);
  }

  remember(key: string, value: string) {
    this.facts.set(key, value);
  }

  recall(key: string): string | undefined {
    return this.facts.get(key);
  }
}

export default AIMemory;
