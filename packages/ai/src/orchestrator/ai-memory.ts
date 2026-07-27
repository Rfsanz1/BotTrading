import fetch from 'node-fetch';
import prisma from '@rfsanz/database/src/client';
import { AIResponse } from './types';

export type MemoryType =
  | 'TRADE'
  | 'SIGNAL'
  | 'PROFIT'
  | 'LOSS'
  | 'STRATEGY'
  | 'CONVERSATION'
  | 'RESPONSE'
  | 'MARKET'
  | 'SESSION'
  | 'NOTE';

export interface MemoryEvent {
  id?: string;
  userId?: string;
  type: MemoryType;
  source?: string;
  title?: string;
  content: string;
  metadata?: Record<string, any>;
  conversationId?: string;
  embedding?: number[];
  createdAt?: number;
  persist?: boolean;
}

export interface MemorySearchOptions {
  topK?: number;
  useEmbedding?: boolean;
  types?: MemoryType[];
  userId?: string;
  since?: number;
}

export interface MemorySearchResult {
  item: MemoryEvent;
  score: number;
}

export class AIMemory {
  private shortTermHistory: MemoryEvent[] = [];
  private contextMap = new Map<string, MemoryEvent[]>();
  private maxShortTermEntries = Number(process.env.AI_MEMORY_SHORT_TERM_LIMIT || 100);
  private embeddingProvider = process.env.AI_MEMORY_EMBEDDING_PROVIDER || 'ollama';
  private embeddingModel = process.env.AI_MEMORY_EMBEDDING_MODEL || 'llama3.2';
  private dbEnabled = process.env.AI_MEMORY_PERSIST !== 'false';

  async remember(event: MemoryEvent) {
    const normalizedEvent = {
      ...event,
      source: event.source || 'ai-memory',
      createdAt: event.createdAt || Date.now(),
    };

    this.appendShortTerm(normalizedEvent);
    this.appendContext(normalizedEvent.conversationId || 'global', normalizedEvent);

    if (this.embeddingProvider && normalizedEvent.content) {
      normalizedEvent.embedding = await this.embedText(normalizedEvent.content).catch(() => undefined);
    }

    if (normalizedEvent.persist !== false && this.dbEnabled) {
      await this.persistEvent(normalizedEvent).catch((error) => {
        console.warn('AIMemory persistence failed:', error?.message || error);
      });
    }

    return normalizedEvent;
  }

  async storeResponse(response: AIResponse, conversationId?: string, userId?: string) {
    return this.remember({
      type: 'RESPONSE',
      source: `${response.provider}:${response.model}`,
      title: `AI response from ${response.provider}`,
      content: response.content,
      metadata: {
        provider: response.provider,
        model: response.model,
        latencyMs: response.latencyMs,
        tokenUsage: response.tokenUsage,
        costUsd: response.costUsd,
        confidence: response.confidence,
        success: response.success,
        timestamp: response.timestamp,
      },
      conversationId,
      userId,
    });
  }

  async rememberTrade(trade: {
    userId?: string;
    symbol: string;
    price: number;
    quantity: number;
    side: string;
    pnl?: number;
    fee?: number;
    timestamp?: number;
    metadata?: Record<string, any>;
  }) {
    const title = `${trade.side} ${trade.symbol} @ ${trade.price}`;
    const content = `Trade ${trade.side} ${trade.quantity} ${trade.symbol} at ${trade.price}${trade.pnl !== undefined ? `, PnL: ${trade.pnl}` : ''}`;
    return this.remember({
      type: 'TRADE',
      title,
      content,
      metadata: { ...trade.metadata, side: trade.side, symbol: trade.symbol, price: trade.price, quantity: trade.quantity, pnl: trade.pnl, fee: trade.fee },
      userId: trade.userId,
      createdAt: trade.timestamp,
    });
  }

  async rememberSignal(signal: {
    userId?: string;
    symbol: string;
    confidence?: number;
    riskLevel?: string;
    payload?: Record<string, any>;
    timestamp?: number;
  }) {
    return this.remember({
      type: 'SIGNAL',
      title: `Signal ${signal.symbol}`,
      content: `Signal for ${signal.symbol} with confidence ${signal.confidence ?? 'unknown'} and risk ${signal.riskLevel ?? 'unknown'}`,
      metadata: { ...signal.payload, symbol: signal.symbol, confidence: signal.confidence, riskLevel: signal.riskLevel },
      userId: signal.userId,
      createdAt: signal.timestamp,
    });
  }

  async rememberStrategy(strategy: {
    userId?: string;
    name: string;
    params?: Record<string, any>;
    description?: string;
    timestamp?: number;
  }) {
    return this.remember({
      type: 'STRATEGY',
      title: strategy.name,
      content: strategy.description || `Strategy ${strategy.name} with parameters ${JSON.stringify(strategy.params || {})}`,
      metadata: { params: strategy.params },
      userId: strategy.userId,
      createdAt: strategy.timestamp,
    });
  }

  async rememberMarketCondition(condition: {
    userId?: string;
    symbol: string;
    description: string;
    severity?: string;
    metadata?: Record<string, any>;
    timestamp?: number;
  }) {
    return this.remember({
      type: 'MARKET',
      title: `Market condition for ${condition.symbol}`,
      content: condition.description,
      metadata: { symbol: condition.symbol, severity: condition.severity, ...condition.metadata },
      userId: condition.userId,
      createdAt: condition.timestamp,
    });
  }

  async rememberSession(session: {
    userId?: string;
    title: string;
    details?: string;
    metadata?: Record<string, any>;
    timestamp?: number;
  }) {
    return this.remember({
      type: 'SESSION',
      title: session.title,
      content: session.details || `Trading session ${session.title}`,
      metadata: session.metadata,
      userId: session.userId,
      createdAt: session.timestamp,
    });
  }

  async appendContext(conversationId: string, event: MemoryEvent) {
    const existing = this.contextMap.get(conversationId) || [];
    existing.push(event);
    if (existing.length > this.maxShortTermEntries) existing.splice(0, existing.length - this.maxShortTermEntries);
    this.contextMap.set(conversationId, existing);
  }

  getContext(conversationId: string) {
    return [...(this.contextMap.get(conversationId) || [])];
  }

  getShortTerm(limit = 20) {
    return this.shortTermHistory.slice(-limit);
  }

  listLongTerm(options: { userId?: string; types?: MemoryType[]; limit?: number } = {}) {
    return prisma.memoryItem.findMany({
      where: {
        userId: options.userId,
        type: options.types ? { in: options.types } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
    });
  }

  async list(options: { userId?: string; types?: MemoryType[]; limit?: number } = {}) {
    const rows = await prisma.memoryItem.findMany({
      where: {
        userId: options.userId,
        type: options.types ? { in: options.types } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId || undefined,
      type: row.type as MemoryType,
      source: row.source,
      title: row.title || undefined,
      content: row.content,
      metadata: row.metadata || undefined,
      conversationId: row.conversationId || undefined,
      embedding: Array.isArray(row.embedding) ? row.embedding.map(Number) : undefined,
      createdAt: row.createdAt.getTime(),
    }) as MemoryEvent);
  }

  async search(query: string, options: MemorySearchOptions = {}) {
    const rows = await prisma.memoryItem.findMany({
      where: {
        userId: options.userId,
        type: options.types ? { in: options.types } : undefined,
        createdAt: options.since ? { gte: new Date(options.since) } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const queryEmbedding = options.useEmbedding ? await this.embedText(query).catch(() => undefined) : undefined;
    const normalizedQuery = query.toLowerCase();

    const scored = rows
      .map((row) => {
        const item: MemoryEvent = {
          id: row.id,
          userId: row.userId || undefined,
          type: row.type as MemoryType,
          source: row.source,
          title: row.title || undefined,
          content: row.content,
          metadata: row.metadata || undefined,
          conversationId: row.conversationId || undefined,
          embedding: Array.isArray(row.embedding) ? row.embedding.map(Number) : undefined,
          createdAt: row.createdAt.getTime(),
        };

        const textScore = this.computeTextScore(normalizedQuery, item);
        const vectorScore = queryEmbedding && item.embedding ? this.cosineSimilarity(queryEmbedding, item.embedding) : 0;
        const score = Math.max(textScore, vectorScore * 10);
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK ?? 20);

    return scored;
  }

  async embedText(text: string) {
    if (!text || !this.embeddingProvider) return [];
    if (this.embeddingProvider !== 'ollama') {
      throw new Error(`Unsupported embedding provider: ${this.embeddingProvider}`);
    }

    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const model = process.env.OLLAMA_EMBEDDING_MODEL || this.embeddingModel;
    const response = await fetch(`${host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embeddings request failed: ${errorText}`);
    }

    const body = await response.json();
    const embedding =
      body?.data?.[0]?.embedding ||
      body?.embeddings?.[0] ||
      body?.embedding ||
      body;

    if (!Array.isArray(embedding) || embedding.some((value: any) => typeof value !== 'number')) {
      throw new Error('Ollama embeddings response did not contain a numeric vector');
    }

    return embedding as number[];
  }

  private appendShortTerm(event: MemoryEvent) {
    this.shortTermHistory.push(event);
    if (this.shortTermHistory.length > this.maxShortTermEntries) {
      this.shortTermHistory.splice(0, this.shortTermHistory.length - this.maxShortTermEntries);
    }
  }

  getRecent(limit = 10) {
    return this.shortTermHistory.slice(-limit);
  }

  private async persistEvent(event: MemoryEvent) {
    await prisma.memoryItem.create({
      data: {
        userId: event.userId,
        type: event.type,
        source: event.source || 'ai-memory',
        title: event.title,
        content: event.content,
        metadata: event.metadata,
        embedding: event.embedding,
        conversationId: event.conversationId,
        createdAt: event.createdAt ? new Date(event.createdAt) : undefined,
      },
    });
  }

  private computeTextScore(query: string, item: MemoryEvent) {
    const queryTokens = query.split(/\s+/).filter(Boolean);
    if (!queryTokens.length) return 0;

    const haystack = `${item.title || ''} ${item.content}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) score += 1;
    }

    if (haystack.startsWith(query)) score += 1;
    return score / queryTokens.length;
  }

  private cosineSimilarity(a: number[], b: number[]) {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

export default AIMemory;
