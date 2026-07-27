import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { QuantitativeAnalysisService } from './services/quantitative-analysis.service';

@Injectable()
@WebSocketGateway({ namespace: '/quantitative-analysis', cors: true })
export class QuantitativeAnalysisGateway {
  private readonly logger = new Logger(QuantitativeAnalysisGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly service: QuantitativeAnalysisService) {}

  @SubscribeMessage('subscribe')
  async handleSubscribe(@MessageBody() data: { symbol: string; timeframe: string; exchange: string; candles: Array<any> }) {
    const result = await this.service.calculate(data.symbol, data.timeframe, data.exchange, data.candles || []);
    this.server.emit('indicators', result);
    return { ok: true, channel: `${data.symbol}:${data.timeframe}:${data.exchange}` };
  }
}
