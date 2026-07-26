import { Router } from 'express';
import { requireAuth, AuthedRequest, requireRole } from '../middlewares/auth';
import { createProvider, listProviders } from '../lib/ai/factory';
import convos from '../lib/ai/conversations';
import { Message } from '../lib/ai/IProvider';

const router = Router();

router.get('/providers', (req, res) => {
  res.json({ providers: listProviders() });
});

router.post('/conversations', requireAuth, (req: AuthedRequest, res) => {
  const ownerId = req.user!.sub as string;
  const { provider, title } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  const c = convos.createConversation(ownerId, provider, title);
  res.json({ conversation: c });
});

router.get('/conversations', requireAuth, (req: AuthedRequest, res) => {
  const ownerId = req.user!.sub as string;
  const list = convos.listConversations(ownerId);
  res.json({ conversations: list });
});

router.get('/conversations/:id', requireAuth, (req: AuthedRequest, res) => {
  const c = convos.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ conversation: c });
});

// Send a message to a conversation and stream chunks via SSE
router.post('/conversations/:id/message', requireAuth, async (req: AuthedRequest, res) => {
  const convId = req.params.id;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const convo = convos.getConversation(convId);
  if (!convo) return res.status(404).json({ error: 'not found' });

  const userMsg: Message = { id: `m-${Date.now()}`, role: 'user', content, timestamp: Date.now() };
  convos.appendMessage(convId, userMsg);

  // SSE response
  res.writeHead(200, {
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });
  res.write('\n');

  const provider = createProvider(convo.provider);

  try {
    const assistant = await provider.sendMessage(convId, convo.messages.concat(userMsg), (chunk) => {
      try { res.write(`data: ${JSON.stringify({ chunk })}\n\n`); } catch (e) {}
    });
    convos.appendMessage(convId, assistant);
    res.write(`data: ${JSON.stringify({ done: true, message: assistant })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  } finally {
    try { res.end(); } catch (e) {}
  }
});

export default router;
