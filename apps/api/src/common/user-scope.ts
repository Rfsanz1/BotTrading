import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import prisma from '@rfsanz/database';

export async function requireUserScope(
  request: { user?: { id?: string } },
  requestedUserId?: string,
): Promise<string> {
  const subject = request.user?.id;
  if (!subject) throw new UnauthorizedException('Authentication is required');
  if (!requestedUserId || requestedUserId === subject) return subject;

  const user = await prisma.user.findUnique({
    where: { id: subject },
    select: {
      isActive: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user?.isActive || !user.roles.some(({ role }) => role.name === 'ADMIN')) {
    throw new ForbiddenException('User is not accessible');
  }
  return requestedUserId;
}

export async function requireAdminScope(request: { user?: { id?: string } }): Promise<string> {
  const subject = request.user?.id;
  if (!subject) throw new UnauthorizedException('Authentication is required');
  const user = await prisma.user.findUnique({
    where: { id: subject },
    select: {
      isActive: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user?.isActive || !user.roles.some(({ role }) => role.name === 'ADMIN')) {
    throw new ForbiddenException('Administrator scope is required');
  }
  return subject;
}
