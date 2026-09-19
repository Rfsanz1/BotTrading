import { Router } from 'express';
import { requireAuth, AuthedRequest, requireRole } from '../middlewares/auth';
import notifications, { NotificationType } from '../lib/notifications';

const router = Router();

// Subscribe current user to notification types and channels
router.post('/subscribe', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.sub as string;
  const { types, channels } = req.body as { types: NotificationType[]; channels: string[] };
  if (!types || !Array.isArray(types)) return res.status(400).json({ error: 'types required' });
  notifications.subscribe(userId, types, channels || ['app']);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.sub as string;
  notifications.unsubscribe(userId);
  res.json({ ok: true });
});

router.get('/subscriptions', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.sub as string;
  const s = notifications.getSubscription(userId);
  res.json({ subscription: s });
});

// SSE stream for push notifications. Client must include Bearer token.
router.get('/stream', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.sub as string;
  notifications.sseSubscribe(userId, res);
});

// Admin endpoint to send notifications to users or broadcast
router.post('/send', requireRole('admin'), (req, res) => {
  const { notification, users } = req.body as { notification: any; users?: string[] };
  if (!notification || !notification.type || !notification.title) return res.status(400).json({ error: 'invalid notification' });
  notifications.sendNotification({ ...notification, id: String(Date.now()), timestamp: Date.now() }, users);
  res.json({ ok: true });
});

export default router;
