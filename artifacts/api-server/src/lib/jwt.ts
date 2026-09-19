import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';

export function signAccessToken(payload: Record<string, any>, expiresIn = '15m') {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, ACCESS_SECRET) as Record<string, any>;
}

export function signRefreshToken(payload: Record<string, any>, expiresIn = '7d') {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, REFRESH_SECRET) as Record<string, any>;
}
