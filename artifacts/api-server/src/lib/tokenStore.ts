/**
 * Simple in-memory refresh token store. In production, persist to DB.
 */
type TokenRecord = { token: string; userId: string; expiresAt: number };
const tokens = new Map<string, TokenRecord>();

export function storeRefreshToken(token: string, userId: string, expiresAt: number) {
  tokens.set(token, { token, userId, expiresAt });
}

export function revokeRefreshToken(token: string) {
  tokens.delete(token);
}

export function findRefreshToken(token: string) {
  const rec = tokens.get(token);
  if (!rec) return null;
  if (rec.expiresAt < Date.now()) { tokens.delete(token); return null; }
  return rec;
}

export function revokeTokensForUser(userId: string) {
  for (const [k, v] of tokens.entries()) {
    if (v.userId === userId) tokens.delete(k);
  }
}
