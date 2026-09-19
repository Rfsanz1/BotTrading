import ProviderBase from '../ProviderBase';
import fetch from 'node-fetch';

export default class OllamaProvider extends ProviderBase {
  opts: any;
  constructor(opts: any = {}) { super(); this.opts = opts; }

  async generate(prompt: string, opts: any = {}) {
    const host = this.opts.host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = opts.model || this.opts.model || 'ollama';
    const res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt }),
    });
    return res.json();
  }
}
