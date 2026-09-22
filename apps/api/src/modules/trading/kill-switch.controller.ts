import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { requireAdminScope } from '../../common/user-scope';
import { getKillSwitch, setKillSwitch } from './kill-switch';

@Controller('admin/kill-switch')
export class KillSwitchController {
  @Get()
  async status(@Req() req: any) {
    await requireAdminScope(req);
    return getKillSwitch();
  }

  @Post()
  async update(@Body() body: { active: boolean; reason?: string }, @Req() req: any) {
    const operator = await requireAdminScope(req);
    if (typeof body.active !== 'boolean') throw new Error('active must be boolean');
    await setKillSwitch(body.active, body.reason ?? (body.active ? 'Operator activated' : 'Operator cleared'), operator);
    return getKillSwitch();
  }
}
