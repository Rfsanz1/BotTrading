import { Controller, Post, Body, Req, HttpCode, UnauthorizedException } from '@nestjs/common';
import { TradingviewService } from './tradingview.service';
import { Public } from '../../common/public.decorator';
import { verifyWebhookSignature } from '../alerts/webhook-security';

@Controller('tradingview')
export class TradingviewController {
  constructor(private svc: TradingviewService) {}

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async webhook(@Body() payload: any, @Req() req: any) {
    const rawBody = req.rawBody?.toString('utf8') || JSON.stringify(payload);
    if (!verifyWebhookSignature(
      rawBody,
      req.headers['x-webhook-signature'],
      req.headers['x-webhook-timestamp'],
    )) {
      throw new UnauthorizedException('Invalid webhook authentication');
    }
    await this.svc.handleWebhook(payload, { ip: req.ip, headers: req.headers });
    return { ok: true };
  }
}
