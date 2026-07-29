import { Injectable } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { ConversationMemory, ConversationMemoryEntry, AIRole } from '../core/ai.types';

/**
 * In-process conversation memory store.
 *
 * Manages sliding-window conversation history so the AI has context across
 * multiple turns without replaying the full history every time.
 *
 * For production, replace the in-memory Map with a Redis or DB-backed store.
 */
@Injectable()
export class ConversationMemoryStore {
  private readonly log: Logger;
  /** Max entries per conversation before oldest are pruned. */
  private readonly maxEntries: number;
  private readonly store = new Map<string, ConversationMemory>();

  constructor(maxEntries = 50) {
    this.log = createLogger('ConversationMemoryStore');
    this.maxEntries = maxEntries;
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  append(
    conversationId: string,
    role: AIRole,
    content: string,
    metadata?: Record<string, string | number | boolean>,
  ): ConversationMemoryEntry {
    const entry: ConversationMemoryEntry = {
      id:        `${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      timestamp: Date.now(),
      metadata,
    };

    const conv = this.getOrCreate(conversationId);
    conv.entries.push(entry);
    conv.updatedAt = Date.now();

    // Prune oldest entries if over limit
    if (conv.entries.length > this.maxEntries) {
      // Always keep the first system message if present
      const firstSystem = conv.entries[0]?.role === 'system' ? conv.entries[0] : null;
      const rest = conv.entries.slice(firstSystem ? 1 : 0);
      const pruned = rest.slice(rest.length - (this.maxEntries - (firstSystem ? 1 : 0)));
      conv.entries = firstSystem ? [firstSystem, ...pruned] : pruned;
      this.log.debug({ conversationId, kept: conv.entries.length }, 'Memory pruned');
    }

    return entry;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  getHistory(conversationId: string): ConversationMemoryEntry[] {
    return this.store.get(conversationId)?.entries ?? [];
  }

  getConversation(conversationId: string): ConversationMemory | undefined {
    return this.store.get(conversationId);
  }

  /** Return the last N entries (useful for building AIMessage[] arrays). */
  getRecent(conversationId: string, n: number): ConversationMemoryEntry[] {
    const entries = this.getHistory(conversationId);
    return entries.slice(-n);
  }

  // ─── Manage ───────────────────────────────────────────────────────────────

  clear(conversationId: string): void {
    this.store.delete(conversationId);
    this.log.debug({ conversationId }, 'Conversation cleared');
  }

  clearAll(): void {
    this.store.clear();
    this.log.debug('All conversations cleared');
  }

  listConversationIds(): string[] {
    return Array.from(this.store.keys());
  }

  size(): number {
    return this.store.size;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private getOrCreate(conversationId: string): ConversationMemory {
    let conv = this.store.get(conversationId);
    if (!conv) {
      conv = {
        conversationId,
        entries:   [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.store.set(conversationId, conv);
    }
    return conv;
  }
}

export type { ConversationMemory, ConversationMemoryEntry };
