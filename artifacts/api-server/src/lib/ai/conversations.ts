import { Conversation, Message } from './IProvider';
import { v4 as uuidv4 } from 'uuid';

const convos = new Map<string, Conversation>();

export function createConversation(ownerId: string | undefined, provider: string, title?: string) {
  const id = uuidv4();
  const c: Conversation = { id, title, provider, createdAt: Date.now(), messages: [], ownerId };
  convos.set(id, c);
  return c;
}

export function getConversation(id: string) {
  return convos.get(id) ?? null;
}

export function listConversations(ownerId?: string) {
  const out: Conversation[] = [];
  for (const c of convos.values()) {
    if (!ownerId || c.ownerId === ownerId) out.push(c);
  }
  return out;
}

export function appendMessage(conversationId: string, msg: Message) {
  const c = convos.get(conversationId);
  if (!c) throw new Error('not found');
  c.messages.push(msg);
  return msg;
}

export default { createConversation, getConversation, listConversations, appendMessage };
