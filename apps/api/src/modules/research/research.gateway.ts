import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { ResearchResult } from './interfaces/research.interface';

@Injectable()
@WebSocketGateway({ namespace: '/research', cors: true })
export class ResearchGateway {
  private readonly logger = new Logger(ResearchGateway.name);

  @WebSocketServer()
  server: Server;

  @SubscribeMessage('subscribe')
  handleSubscribe(@MessageBody() data: { symbol: string; timeframe: string; exchange: string }) {
    this.logger.log(`Client subscribed to research for ${data.symbol}/${data.timeframe}/${data.exchange}`);
    return { ok: true, channel: `${data.symbol}:${data.timeframe}:${data.exchange}` };
  }

  @OnEvent('research.completed')
  handleResearchCompleted(result: ResearchResult) {
    this.server.emit('research.completed', result);
  }
}
