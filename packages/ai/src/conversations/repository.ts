import prisma from '@rfsanz/database/src/client';
import { Message } from '../types';

export async function createConversation(ownerId: string | undefined, title?: string) {
  const c = await prisma.conversation.create({ data: { ownerId, title } }).catch(() => null as any);
  // If Conversation model doesn't exist yet, fallback to an in-memory implementation is required by caller.
  return c;
}

export async function appendMessage(conversationId: string, message: Message) {
  // Store message in a separate Message model if exists
  try {
    const m = await prisma.message.create({ data: { conversationId, role: message.role, content: message.content, meta: message.meta } });
    return m;
  } catch (e) {
    // prisma model may not exist; return message as-is
    return message;
  }
}

export async function getConversationMessages(conversationId: string) {
  try {
    const rows = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    return rows.map(r => ({ id: r.id, role: r.role as any, content: r.content, meta: r.meta, timestamp: r.createdAt.getTime() } as Message));
  } catch (e) {
    return [] as Message[];
  }
}

export default { createConversation, appendMessage, getConversationMessages };
