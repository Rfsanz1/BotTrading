import { Controller, Get, Param, Post, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AdminGuard } from '../../guards/admin.guard';

class RolesDto { roles: string[] }

@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  @UseGuards(AdminGuard)
  async list() { return this.svc.list(); }

  @Get(':id')
  async get(@Param('id') id: string, @Request() req: any) {
    const isAdmin = req.user?.roles?.includes('ADMIN');
    if (id !== req.user?.id && !isAdmin) {
      throw new ForbiddenException('User is not accessible');
    }
    return this.svc.findById(id);
  }

  @Post(':id/roles')
  @UseGuards(AdminGuard)
  async setRoles(@Param('id') id: string, @Body() body: RolesDto) { return this.svc.setRoles(id, body.roles); }
}
