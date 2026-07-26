import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';

class RolesDto { roles: string[] }

@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get()
  async list() { return this.svc.list(); }

  @Get(':id')
  async get(@Param('id') id: string) { return this.svc.findById(id); }

  @Post(':id/roles')
  async setRoles(@Param('id') id: string, @Body() body: RolesDto) { return this.svc.setRoles(id, body.roles); }
}
