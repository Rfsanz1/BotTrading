import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { getJwtConfig } from '../modules/auth/jwt-config';

declare global {
  namespace Express {
    interface User {
      id: string;
      email?: string;
      roles?: string[];
      iat?: number;
      exp?: number;
      iss?: string;
      aud?: string | string[];
    }
  }
}

type JwtClaims = Express.User & { sub?: string; nbf?: number };

function decodePart(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function verifyAccessToken(token: string, secret: string): JwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(decodePart(encodedHeader)) as { alg?: string; typ?: string };
  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Unsupported JWT algorithm');
  const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
  const claims = JSON.parse(decodePart(encodedPayload)) as JwtClaims;
  const now = Math.floor(Date.now() / 1000);
  if (!claims.sub || typeof claims.sub !== 'string') throw new Error('Missing subject');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('Expired token');
  if (typeof claims.nbf === 'number' && claims.nbf > now) throw new Error('Token not active');
  const jwtConfig = getJwtConfig();
  if (claims.iss !== jwtConfig.issuer) throw new Error('Invalid issuer');
  {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(jwtConfig.audience)) throw new Error('Invalid audience');
  }
  return claims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !/^Bearer\s+\S+$/.test(authHeader)) {
      throw new UnauthorizedException('Bearer token is required');
    }
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret || secret === 'dev' || secret === 'changeme' || secret.length < 32) {
      throw new UnauthorizedException('JWT authentication is not configured securely');
    }
    try {
      const claims = verifyAccessToken(authHeader.slice(7), secret);
      request.user = {
        id: claims.sub!,
        email: claims.email,
        roles: claims.roles,
        iat: claims.iat,
        exp: claims.exp,
        iss: claims.iss,
        aud: claims.aud,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
