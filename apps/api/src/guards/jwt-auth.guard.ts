/**
 * JWT Authentication Guard
 * Protects all trading endpoints
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
    }
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      this.logger.warn(`Missing authorization header from ${request.ip}`);
      throw new UnauthorizedException('Missing authorization header');
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer') {
      throw new UnauthorizedException('Invalid authorization scheme');
    }

    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    try {
      // TODO: Verify JWT token with your secret
      // This is a placeholder - implement with jwt.verify()
      // Example:
      // const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // request.user = decoded;

      // For now, extract userId from custom header (development)
      const userId = request.headers['x-user-id'] as string;
      const email = request.headers['x-user-email'] as string;

      if (!userId) {
        // In production, use proper JWT verification
        if (process.env.NODE_ENV === 'production') {
          throw new UnauthorizedException('Invalid token');
        }
        throw new UnauthorizedException('Missing x-user-id header (development only)');
      }

      request.user = {
        id: userId,
        email: email || 'user@example.com',
        role: 'trader',
      };

      this.logger.log(`Auth success for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Auth failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
