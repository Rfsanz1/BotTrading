import { Injectable } from '@nestjs/common';
import prisma from '@rfsanz/database/src/client';

@Injectable()
export class UsersService {
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  async list() {
    return prisma.user.findMany();
  }

  async setRoles(id: string, roles: string[]) {
    return prisma.user.update({ where: { id }, data: { roles } });
  }

  async setActive(id: string, active: boolean) {
    return prisma.user.update({ where: { id }, data: { isActive: active } });
  }
}
