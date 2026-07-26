import { Router } from 'express';
import { requireRole, requireAuth, AuthedRequest } from '../middlewares/auth';
import admin from '../lib/admin';
import notifications from '../lib/notifications';

const router = Router();

router.use(requireRole('admin'));

router.get('/users', async (req, res) => {
  const users = admin.listUsers();
  res.json({ users });
});

router.get('/users/:id', async (req, res) => {
  const u = admin.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ user: u });
});

router.post('/users/:id/roles', async (req, res) => {
  const { roles } = req.body as { roles?: string[] };
  if (!roles) return res.status(400).json({ error: 'roles required' });
  const ok = admin.setRoles(req.params.id, roles);
  res.json({ ok });
});

router.post('/users/:id/deactivate', async (req, res) => {
  const ok = admin.deactivateUser(req.params.id);
  res.json({ ok });
});

router.post('/users/:id/reactivate', async (req, res) => {
  const ok = admin.reactivateUser(req.params.id);
  res.json({ ok });
});

router.get('/exchanges', async (req, res) => {
  const s = admin.getExchangeStatus();
  res.json({ exchanges: s });
});

router.get('/providers', async (req, res) => {
  const p = admin.getAIProvidersStatus();
  res.json({ providers: p });
});

router.get('/analytics', async (req, res) => {
  const a = admin.getBotAnalytics();
  res.json({ analytics: a });
});

router.get('/audit', async (req, res) => {
  const logs = admin.listAudits(200);
  res.json({ logs });
});

router.post('/feature-flag', async (req: AuthedRequest, res) => {
  const { key, value } = req.body as { key: string; value: boolean };
  if (!key) return res.status(400).json({ error: 'key required' });
  admin.setFeatureFlag(key, Boolean(value));
  res.json({ ok: true });
});

router.get('/feature-flag', async (req, res) => {
  res.json({ flags: admin.getFeatureFlags() });
});

router.get('/subscriptions', async (req, res) => {
  res.json({ subscriptions: admin.getSubscriptions(), note: 'subscribe per user via /notifications' });
});

router.get('/health', async (req, res) => {
  res.json({ health: admin.getSystemHealth() });
});

export default router;
