import ProviderBase from '../ProviderBase';

export default class OllamaProvider extends ProviderBase {
  opts: any;
  constructor(opts: any = {}) {
    super();
    this.opts = opts;
  }

  async generate(_prompt: string, _opts: any = {}) {
    return { ok: false, error: 'Legacy Ollama provider is disabled in production. Use the canonical 9Router path.' };
  }

  get name(): string { return 'ollama'; }
  async sendMessage(): Promise<any> {
    return { role: 'assistant', content: '', timestamp: Date.now() };
  }
}
