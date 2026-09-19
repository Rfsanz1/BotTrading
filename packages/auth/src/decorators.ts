/**
 * Metadata key constants for NestJS Reflector-based guards.
 * Use these keys when building NestJS @SetMetadata decorators in apps/api.
 *
 * Example (in apps/api):
 *   import { SetMetadata } from '@nestjs/common';
 *   import { ROLES_KEY } from '@rfsanz/auth';
 *   export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
 */

export const ROLES_KEY       = 'rfsanz:roles';
export const PERMISSIONS_KEY = 'rfsanz:permissions';
export const IS_PUBLIC_KEY   = 'rfsanz:isPublic';
