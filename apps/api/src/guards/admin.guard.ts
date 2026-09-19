import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import prisma from '@rfsanz/database';

@Injectable()
export class AdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException('Authentication is required');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, roles: { select: { role: { select: { name: true } } } } },
    });
    if (!user?.isActive) throw new ForbiddenException('User is inactive');
    if (!user.roles.some(({ role }) => role.name === 'ADMIN')) {
      throw new ForbiddenException('Administrator permission is required');
    }
    return true;
  }
}
