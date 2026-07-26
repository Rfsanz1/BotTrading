import { createProvider, listProviders } from './factory';
import { Message, ProviderName } from './types';
import * as convRepo from './conversations/repository';
import { EventEmitter } from 'eventemitter3';

type StreamEvent = { provider: ProviderName; chunk: string };

export class AIService {
  private emitter = new EventEmitter();

  listProviders() { return listProviders(); }

  async sendMessage(providerName: ProviderName, conversationId: string, messages: Message[], onChunk?: (chunk: string) => void) {
    const provider = createProvider(providerName);
    // persist user message
    await convRepo.appendMessage(conversationId, { id: `m-${Date.now()}`, role: 'user', content: messages.map(m=>m.content).join('\n'), timestamp: Date.now() });
    const assistant = await provider.sendMessage(conversationId, messages, (chunk) => {
      this.emitter.emit('chunk', { provider: providerName, chunk } as StreamEvent);
      if (onChunk) onChunk(chunk);
    });
    await convRepo.appendMessage(conversationId, assistant as Message);
    return assistant as Message;
  }

  async *streamConsensus(conversationId: string, messages: Message[], providers: ProviderName[]) : AsyncGenerator<{ provider: ProviderName; chunk: string } | { done: true; result?: Message }, void, unknown> {
    // for each provider start sendMessage with onChunk feeding generator
    const pending = new Map<ProviderName, Promise<Message>>();
    const chunksQueue: Array<{ provider: ProviderName; chunk: string }> = [];

    const pushChunk = (ev: StreamEvent) => { chunksQueue.push(ev); };
    this.emitter.on('chunk', pushChunk);

    for (const p of providers) {
      const prov = createProvider(p);
      const promise = prov.sendMessage(conversationId, messages, (chunk) => this.emitter.emit('chunk', { provider: p, chunk } as StreamEvent));
      pending.set(p, promise);
    }

    // yield chunks as they arrive
    while (pending.size > 0 || chunksQueue.length > 0) {
      while (chunksQueue.length > 0) {
        const c = chunksQueue.shift()!;
        yield c;
      }
      // check for finished providers
      for (const [p, pr] of Array.from(pending.entries())) {
        const isSettled = (pr as any).then ? false : true; // cannot detect easily — await with timeout below
      }
      // small sleep
      await new Promise(r => setTimeout(r, 20));
      // check completions
      for (const [p, pr] of Array.from(pending.entries())) {
        const ready = await Promise.race([pr.then(res => ({ ready: true, res })), new Promise(r => setTimeout(() => r({ ready: false }), 0))]);
        if ((ready as any).ready) {
          const res = (ready as any).res as Message;
          // persist assistant message
          await convRepo.appendMessage(conversationId, res);
          pending.delete(p);
        }
      }
    }

    this.emitter.off('chunk', pushChunk);

    // produce consensus output (simple averaging of content length or choose highest confidence if available)
    // For now concatenate provider outputs
    const results: Message[] = [];
    for (const p of providers) {
      // try to fetch last message from convRepo
      const msgs = await convRepo.getConversationMessages(conversationId);
      const last = msgs.reverse().find(m => m.role === 'assistant');
      if (last) results.push(last);
    }
    const concat = results.map(r => `[${r.id}] ${r.content}`).join('\n---\n');
    yield { done: true, result: { id: `cons-${Date.now()}`, role: 'assistant', content: concat, timestamp: Date.now() } as Message };
  }

  async consensus(conversationId: string, messages: Message[], providers: ProviderName[]) {
    // call providers in parallel, collect outputs, return aggregate
    const promises = providers.map(p => createProvider(p).sendMessage(conversationId, messages));
    const outputs = await Promise.all(promises);
    // simplistic consensus: pick most common answer or concatenate
    const texts = outputs.map(o => o.content);
    const unique = Array.from(new Set(texts));
    let result: Message;
    if (unique.length === 1) result = { id: `cons-${Date.now()}`, role: 'assistant', content: unique[0], timestamp: Date.now() };
    else result = { id: `cons-${Date.now()}`, role: 'assistant', content: texts.join('\n---\n'), timestamp: Date.now() };
    // persist
    await convRepo.appendMessage(conversationId, result);
    return result;
  }
}

export default new AIService();
