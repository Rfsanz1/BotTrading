import { RoleName, PermissionKey } from '@rfsanz/shared';

// ─── Default role → permission map ──────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<RoleName, PermissionKey[]> = {
  [RoleName.ADMIN]: [
    PermissionKey.READ,
    PermissionKey.WRITE,
    PermissionKey.TRADE,
    PermissionKey.ADMIN,
  ],
  [RoleName.USER]: [
    PermissionKey.READ,
    PermissionKey.WRITE,
    PermissionKey.TRADE,
  ],
  [RoleName.BOT]: [
    PermissionKey.READ,
    PermissionKey.TRADE,
  ],
};

/**
 * Check whether a set of roles collectively grants a permission.
 */
export function hasPermission(
  roles:      RoleName[],
  permission: PermissionKey,
): boolean {
  return roles.some(role =>
    ROLE_PERMISSIONS[role]?.includes(permission) ?? false,
  );
}

/**
 * Check whether a set of roles includes a required role.
 */
export function hasRole(roles: RoleName[], required: RoleName): boolean {
  return roles.includes(required);
}

/**
 * Check all required permissions.
 */
export function hasAllPermissions(
  roles:       RoleName[],
  permissions: PermissionKey[],
): boolean {
  return permissions.every(p => hasPermission(roles, p));
}
