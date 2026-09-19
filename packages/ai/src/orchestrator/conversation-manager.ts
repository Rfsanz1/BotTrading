import { ChatMessage } from './types';

export class ConversationManager {
  private store = new Map<string, ChatMessage[]>();

  createConversation(id: string) {
    if (!this.store.has(id)) this.store.set(id, []);
    return id;
  }

  append(conversationId: string, message: ChatMessage) {
    const history = this.store.get(conversationId) || [];
    history.push(message);
    this.store.set(conversationId, history);
    return history;
  }

  get(conversationId: string): ChatMessage[] {
    return this.store.get(conversationId) || [];
  }

  clear(conversationId: string) {
    this.store.delete(conversationId);
  }
}

export default ConversationManager;
