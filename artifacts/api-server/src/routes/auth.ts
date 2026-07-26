import { Router } from 'express';
import { createUser, findUserByEmail, verifyPassword, findUserById, linkTelegram, findByTelegramId } from '../lib/userStore';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { storeRefreshToken, findRefreshToken, revokeRefreshToken, revokeTokensForUser } from '../lib/tokenStore';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const existing = findUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'user exists' });
  const u = await createUser(email, password, name);
  res.json({ id: u.id, email: u.email });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });
  const user = findUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await verifyPassword(user, password);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const access = signAccessToken({ sub: user.id, email: user.email, roles: user.roles }, '15m');
  const refresh = signRefreshToken({ sub: user.id }, '7d');
  // store refresh
  const decoded: any = verifyRefreshToken(refresh);
  storeRefreshToken(refresh, user.id, decoded.exp * 1000);

  res.cookie('refresh_token', refresh, { httpOnly: true, sameSite: 'lax' });
  res.json({ accessToken: access, user: { id: user.id, email: user.email, roles: user.roles } });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'missing refresh' });
  const rec = findRefreshToken(token);
  if (!rec) return res.status(401).json({ error: 'invalid refresh' });
  try {
    const payload: any = verifyRefreshToken(token);
    const userId = payload.sub;
    const user = findUserById(userId);
    if (!user) return res.status(401).json({ error: 'invalid user' });
    const access = signAccessToken({ sub: user.id, email: user.email, roles: user.roles }, '15m');
    res.json({ accessToken: access });
  } catch (e) {
    revokeRefreshToken(token);
    return res.status(401).json({ error: 'invalid refresh' });
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) revokeRefreshToken(token);
  res.clearCookie('refresh_token');
  res.json({ ok: true });
});

// Telegram linking: create a short-lived code that a Telegram bot/user can post to verify
const telegramCodes = new Map<string, { userId: string; code: string; expiresAt: number }>();

router.post('/link-telegram', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  telegramCodes.set(code, { userId, code, expiresAt: Date.now() + (10 * 60 * 1000) });
  // In production: send this code to the user via Telegram bot using Telegram API
  // For now return the code so the operator can send it manually.
  res.json({ code, expiresIn: 10 * 60 });
});

router.post('/verify-telegram', async (req, res) => {
  const { code, telegramId } = req.body;
  if (!code || !telegramId) return res.status(400).json({ error: 'code and telegramId required' });
  const rec = telegramCodes.get(code);
  if (!rec) return res.status(400).json({ error: 'invalid code' });
  if (rec.expiresAt < Date.now()) return res.status(400).json({ error: 'code expired' });
  linkTelegram(rec.userId, telegramId);
  telegramCodes.delete(code);
  res.json({ ok: true });
});

export default router;
