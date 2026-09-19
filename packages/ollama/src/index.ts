import fetch from 'node-fetch';

export interface OllamaOptions { host?: string }

export class OllamaClient {
  constructor(private opts: OllamaOptions = {}) {}

  async generate(model: string, prompt: string) {
    const base = this.opts.host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt })
    });
    return res.json();
  }
}
