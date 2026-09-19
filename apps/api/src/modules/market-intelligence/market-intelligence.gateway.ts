import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarketAggregationEvent } from './events/market-aggregation.event';

@Injectable()
@WebSocketGateway({ namespace: '/market-intelligence', cors: true })
export class MarketIntelligenceGateway {
  private readonly logger = new Logger(MarketIntelligenceGateway.name);

  @WebSocketServer()
  server: Server;

  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() data: { symbol: string; timeframe: string }) {
    this.logger.log(`Client subscribed to ${data.symbol}/${data.timeframe}`);
    return { ok: true, channel: `${data.symbol}:${data.timeframe}` };
  }

  @OnEvent('market.aggregated')
  handleAggregated(event: MarketAggregationEvent) {
    this.server.emit('market.aggregated', event);
  }
}
