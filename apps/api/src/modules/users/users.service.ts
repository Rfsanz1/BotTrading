import { Injectable } from '@nestjs/common';
import prisma from '@rfsanz/database';
import { RoleName } from '@prisma/client';

@Injectable()
export class UsersService {
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  async list() {
    return prisma.user.findMany();
  }

  async setRoles(id: string, roles: string[]) {
    const roleNames = Object.values(RoleName);
    if (roles.some((role) => !roleNames.includes(role as RoleName))) {
      throw new Error('Invalid role');
    }

    const matchingRoles = await prisma.role.findMany({
      where: { name: { in: roles as RoleName[] } },
      select: { id: true },
    });
    if (matchingRoles.length !== roles.length) {
      throw new Error('One or more roles were not found');
    }

    return prisma.user.update({
      where: { id },
      data: { roles: { set: matchingRoles.map(({ id: roleId }) => ({ id: roleId })) } },
    });
  }

  async setActive(id: string, active: boolean) {
    return prisma.user.update({ where: { id }, data: { isActive: active } });
  }
}
