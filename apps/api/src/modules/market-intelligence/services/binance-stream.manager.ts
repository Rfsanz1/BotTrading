import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { toBinanceStreamName } from '../collectors/binance-interval';

export type BinanceStreamMarket = 'spot' | 'futures';
export type BinanceStreamHealth = 'DISCONNECTED' | 'CONNECTING' | 'HEALTHY' | 'DEGRADED' | 'HALTED';

export interface BinanceStreamStatus {
  market: BinanceStreamMarket;
  health: BinanceStreamHealth;
  reconnects: number;
  lastMessageAt: number | null;
  latencyMs: number | null;
  subscriptions: string[];
  activeSubscriptions: number;
  messagesReceived: number;
  eventsReceived: number;
  lastEventAt: number | null;
  lastError?: string;
}

@Injectable()
export class BinanceStreamManager {
  private readonly logger = new Logger(BinanceStreamManager.name);
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private staleTimer: NodeJS.Timeout | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private reconnects = 0;
  private lastMessageAt: number | null = null;
  private lastEventTime: number | null = null;
  private health: BinanceStreamHealth = 'DISCONNECTED';
  private lastError: string | undefined;
  private messagesReceived = 0;
  private eventsReceived = 0;
  private loggedFirstEvent = false;
  private activeSubscriptions = 0;
  private readonly subscriptions = new Set<string>();
  private manualClose = false;

  constructor(
    private readonly market: BinanceStreamMarket,
    private readonly socketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
    private readonly rotationMs = 23 * 60 * 60 * 1000 + 50 * 60 * 1000,
  ) {}

  connect(): void {
    this.manualClose = false;
    this.clearTimers();
    this.health = 'CONNECTING';
    const base = this.market === 'spot' ? 'wss://stream.binance.com:9443/stream' : 'wss://fstream.binance.com/stream';
    const streams = [...this.subscriptions].join('/');
    this.socket = this.socketFactory(streams ? `${base}?streams=${streams}` : base);
    this.socket.on('open', () => {
      this.health = 'HEALTHY';
      this.reconnects = 0;
      this.activeSubscriptions = this.subscriptions.size;
      this.startStaleMonitor();
      this.scheduleRotation();
    });
    const socket = this.socket;
    socket.on('message', (raw) => this.handleMessage(raw.toString(), socket));
    this.socket.on('ping', (payload) => this.socket?.pong(payload));
    this.socket.on('error', (error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.health = 'DEGRADED';
    });
    this.socket.on('close', () => {
      this.socket = null;
      this.activeSubscriptions = 0;
      this.health = this.manualClose ? 'HALTED' : 'DEGRADED';
      if (!this.manualClose) this.scheduleReconnect();
    });
  }

  subscribe(stream: string): void {
    const normalized = toBinanceStreamName(stream);
    this.subscriptions.add(normalized);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [normalized], id: Date.now() }));
    }
  }

  unsubscribe(stream: string): void {
    const normalized = stream.toLowerCase();
    this.subscriptions.delete(normalized);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [normalized], id: Date.now() }));
    }
  }

  close(): void {
    this.manualClose = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.health = 'HALTED';
  }

  status(now = Date.now()): BinanceStreamStatus {
    return {
      market: this.market,
      health: this.health,
      reconnects: this.reconnects,
      lastMessageAt: this.lastMessageAt,
      latencyMs: this.lastEventTime === null ? null : Math.max(0, now - this.lastEventTime),
      subscriptions: [...this.subscriptions],
      activeSubscriptions: this.activeSubscriptions,
      messagesReceived: this.messagesReceived,
      eventsReceived: this.eventsReceived,
      lastEventAt: this.lastEventTime,
      lastError: this.lastError,
    };
  }

  async handover(timeoutMs = 5_000): Promise<boolean> {
    if (this.manualClose) return false;
    const base = this.market === 'spot' ? 'wss://stream.binance.com:9443/stream' : 'wss://fstream.binance.com/stream';
    const streams = [...this.subscriptions].join('/');
    const replacement = this.socketFactory(streams ? `${base}?streams=${streams}` : base);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        replacement.close();
        resolve(false);
      }, timeoutMs);
      replacement.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const previous = this.socket;
          this.socket = replacement;
          this.health = 'HEALTHY';
          this.activeSubscriptions = this.subscriptions.size;
          this.lastMessageAt = Date.now();
          previous?.close();
        resolve(true);
      });
      replacement.on('message', (raw) => this.handleMessage(raw.toString(), replacement));
      replacement.on('ping', (payload) => replacement.pong(payload));
      replacement.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.health = 'DEGRADED';
      });
    });
  }

  onEvent(handler: (event: Record<string, unknown>) => void): void {
    this.eventHandler = handler;
  }

  private eventHandler?: (event: Record<string, unknown>) => void;

  private handleMessage(text: string, source?: WebSocket): void {
    if (source && source !== this.socket) return;
    this.lastMessageAt = Date.now();
    this.messagesReceived += 1;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const event = (parsed.data ?? parsed) as Record<string, unknown>;
      if (typeof event.e !== 'string' && typeof event.eventType !== 'string') return;
      const eventTime = typeof event.E === 'number' ? event.E : typeof event.T === 'number' ? event.T : undefined;
      this.lastEventTime = eventTime ?? null;
      this.eventsReceived += 1;
      if (!this.loggedFirstEvent) {
        this.loggedFirstEvent = true;
        this.logger.log(`Binance ${this.market} stream received first event: symbol=${String(event.s ?? event.symbol ?? 'unknown')} type=${String(event.e ?? event.eventType ?? 'unknown')} subscriptions=${this.subscriptions.size}`);
      }
      try {
        this.eventHandler?.(event);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.health = 'DEGRADED';
      }
    } catch {
      this.lastError = 'INVALID_JSON_MESSAGE';
      this.health = 'DEGRADED';
    }
  }

  private resubscribe(): void {
    if (this.subscriptions.size === 0 || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [...this.subscriptions], id: Date.now() }));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnects, 6));
    this.reconnects += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startStaleMonitor(): void {
    this.staleTimer = setInterval(() => {
      if (this.lastMessageAt !== null && Date.now() - this.lastMessageAt > 30_000) {
        this.health = 'DEGRADED';
        this.logger.warn(`Binance ${this.market} stream is stale`);
        this.socket?.terminate();
      }
    }, 5_000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.rotationTimer) clearTimeout(this.rotationTimer);
    this.reconnectTimer = null;
    this.staleTimer = null;
    this.rotationTimer = null;
  }

  private scheduleRotation(): void {
    this.rotationTimer = setTimeout(() => {
      if (this.manualClose) return;
      this.health = 'DEGRADED';
      this.socket?.close();
    }, this.rotationMs);
  }
}
