import jwt from 'jsonwebtoken';
import type { IJwtPayload } from '@rfsanz/shared';

export interface JwtConfig {
  secret:    string;
  expiresIn: string;
}

export interface TokenPair {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number; // seconds
}

/**
 * Sign an access token (short-lived) + refresh token (long-lived).
 */
export function signTokens(payload: IJwtPayload, config: JwtConfig): TokenPair {
  const expiresIn = parseExpiry(config.expiresIn);

  const accessToken = jwt.sign(payload, config.secret, {
    expiresIn: config.expiresIn as jwt.SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(
    { sub: payload.sub },
    config.secret,
    { expiresIn: '30d' },
  );

  return { accessToken, refreshToken, expiresIn };
}

/**
 * Verify and decode a token. Returns null if invalid/expired.
 */
export function verifyToken(token: string, secret: string): IJwtPayload | null {
  try {
    return jwt.verify(token, secret) as IJwtPayload;
  } catch {
    return null;
  }
}

/**
 * Decode without verification (for logging / extracting claims).
 */
export function decodeToken(token: string): IJwtPayload | null {
  try {
    return jwt.decode(token) as IJwtPayload | null;
  } catch {
    return null;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseExpiry(exp: string): number {
  const match = exp.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const [, n, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(n, 10) * (multipliers[unit] ?? 1);
}
