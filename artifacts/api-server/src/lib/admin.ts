import { listUsers as _listUsers, findUserById, updateUserRoles, setUserActive } from './userStore';
import notifications from './notifications';
import { listProviders } from './ai/factory';

type Audit = { id: string; userId?: string; action: string; meta?: any; ts: number };

const audits: Audit[] = [];
const featureFlags = new Map<string, boolean>();

export function logAudit(userId: string | undefined, action: string, meta?: any) {
  const ev: Audit = { id: String(Date.now()) + Math.random().toString(36).slice(2,6), userId, action, meta, ts: Date.now() };
  audits.push(ev);
  return ev;
}

export function listAudits(limit = 100) {
  return audits.slice(-limit).reverse();
}

export function listUsers() {
  return _listUsers();
}

export function getUser(id: string) {
  return findUserById(id);
}

export function setRoles(userId: string, roles: string[]) {
  const ok = updateUserRoles(userId, roles);
  if (ok) logAudit(undefined, 'setRoles', { userId, roles });
  return ok;
}

export function deactivateUser(userId: string) {
  const ok = setUserActive(userId, false);
  if (ok) logAudit(undefined, 'deactivateUser', { userId });
  return ok;
}

export function reactivateUser(userId: string) {
  const ok = setUserActive(userId, true);
  if (ok) logAudit(undefined, 'reactivateUser', { userId });
  return ok;
}

export function getExchangeStatus() {
  // stubbed -- in production call exchange adapters
  return [{ name: 'binance', status: 'ok' }, { name: 'bybit', status: 'ok' }];
}

export function getAIProvidersStatus() {
  return listProviders().map((p) => ({ name: p, status: 'available' }));
}

export function getBotAnalytics() {
  // provide lightweight metrics
  return { uptimeMs: process.uptime() * 1000, activeBots: 2, tradesToday: 123, pnlToday: 456.7 };
}

export function getFeatureFlags() {
  const obj: Record<string, boolean> = {};
  for (const [k, v] of featureFlags.entries()) obj[k] = v;
  return obj;
}

export function setFeatureFlag(key: string, value: boolean) {
  featureFlags.set(key, value);
  logAudit(undefined, 'featureFlag', { key, value });
}

export function getSubscriptions() {
  // merge subscription info
  // notifications stores subscriptions in memory but doesn't expose listing; access via internal map not exported
  // For now return a placeholder
  return { note: 'use /notifications/subscriptions per user or query individual users' };
}

export function getSystemHealth() {
  return {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV || 'development',
  };
}

export default {
  logAudit,
  listAudits,
  listUsers,
  getUser,
  setRoles,
  deactivateUser,
  reactivateUser,
  getExchangeStatus,
  getAIProvidersStatus,
  getBotAnalytics,
  getFeatureFlags,
  setFeatureFlag,
  getSubscriptions,
  getSystemHealth,
};
