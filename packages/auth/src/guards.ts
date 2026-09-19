/**
 * NestJS-compatible guards for JWT auth, role checks, and permission checks.
 *
 * These are plain classes with the required CanActivate interface so they work
 * in NestJS without importing @nestjs/common here (avoiding a hard dep).
 * The apps/api package provides NestJS — this package only provides the logic.
 */

import { RoleName, PermissionKey, type IJwtPayload } from '@rfsanz/shared';
import { verifyToken } from './jwt.service';
import { hasPermission, hasRole } from './roles';

// ─── Minimal NestJS shim types (no @nestjs/common dep needed) ────────────────

export interface HttpAdapterLike {
  getRequest<T = RequestLike>(): T;
}

export interface ExecutionContextLike {
  switchToHttp(): HttpAdapterLike;
}

interface RequestLike {
  headers:  Record<string, string | string[] | undefined>;
  user?:    IJwtPayload;
}

// ─── JWT Auth Guard ──────────────────────────────────────────────────────────

export class JwtAuthGuard {
  constructor(private readonly jwtSecret: string) {}

  canActivate(context: ExecutionContextLike): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const token = extractBearer(req.headers['authorization']);
    if (!token) return false;

    const payload = verifyToken(token, this.jwtSecret);
    if (!payload) return false;

    req.user = payload;
    return true;
  }
}

// ─── Roles Guard ─────────────────────────────────────────────────────────────

export class RolesGuard {
  constructor(private readonly required: RoleName[]) {}

  canActivate(context: ExecutionContextLike): boolean {
    const req  = context.switchToHttp().getRequest<RequestLike>();
    const user = req.user;
    if (!user) return false;
    return this.required.every(r => hasRole(user.roles, r));
  }
}

// ─── Permissions Guard ────────────────────────────────────────────────────────

export class PermissionsGuard {
  constructor(private readonly required: PermissionKey[]) {}

  canActivate(context: ExecutionContextLike): boolean {
    const req  = context.switchToHttp().getRequest<RequestLike>();
    const user = req.user;
    if (!user) return false;
    return this.required.every(p => hasPermission(user.roles, p));
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractBearer(header: string | string[] | undefined): string | null {
  if (!header) return null;
  const h = Array.isArray(header) ? header[0] : header;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}
