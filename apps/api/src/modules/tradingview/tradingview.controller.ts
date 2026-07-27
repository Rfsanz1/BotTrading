import { Controller, Post, Body, Req, HttpCode } from '@nestjs/common';
import { TradingviewService } from './tradingview.service';

@Controller('tradingview')
export class TradingviewController {
  constructor(private svc: TradingviewService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: any, @Req() req: any) {
    // Accept TradingView webhook POSTs (no auth by design for alerts)
    await this.svc.handleWebhook(payload, { ip: req.ip, headers: req.headers });
    return { ok: true };
  }
}
