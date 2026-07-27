import { Injectable, Logger } from '@nestjs/common';
import { TradingViewAlert } from '@rfsanz/tradingview';

@Injectable()
export class TradingviewService {
  private readonly logger = new Logger(TradingviewService.name);

  async handleWebhook(payload: any, ctx: { ip?: string; headers?: any }) {
    // Basic parsing: support both raw alert JSON and TradingView template messages
    // For now, forward raw payload to logger and later to signal processing pipeline
    this.logger.debug('Received tradingview webhook', payload);

    // Try to coerce into TradingViewAlert shape
    const alerts: TradingViewAlert[] = [];
    if (payload && payload.symbol) {
      alerts.push({ symbol: payload.symbol, price: payload.price, meta: payload });
    } else if (payload && payload.alerts) {
      for (const a of payload.alerts) alerts.push({ symbol: a.symbol, meta: a });
    } else {
      // fallback: try to parse message field
      if (payload && payload.message) {
        alerts.push({ symbol: payload.message, meta: payload });
      }
    }

    // TODO: enqueue processing via BullMQ / Signal service
    this.logger.log('Parsed tradingview alerts: ' + JSON.stringify(alerts));
    return alerts;
  }
}
