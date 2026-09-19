import axios from 'axios';
import { BinanceAdapter } from '../adapters/binance.adapter';

jest.mock('ws', () => {
  class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    handlers = new Map<string, (...args: any[]) => void>();
    sent: string[] = [];
    url: string;

    constructor(url: string) {
      this.url = url;
      FakeWebSocket.instances.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }

    send(message: string): void {
      this.sent.push(message);
    }

    close(): void {
      this.readyState = 3;
    }

    emit(event: string, ...args: any[]): void {
      this.handlers.get(event)?.(...args);
    }
  }
  (globalThis as any).__FakeWebSocket = FakeWebSocket;
  return FakeWebSocket;
});
jest.mock('axios');

const MockWebSocket = () => (globalThis as any).__FakeWebSocket;

describe('BinanceAdapter Spot WebSocket user-data subscription', () => {
  const account = {
    id: 'account',
    userId: 'user',
    exchange: 'binance',
    credentials: { apiKey: 'test-key', apiSecret: 'test-secret' },
    isActive: true,
    isPaper: false,
    tradingMode: 'TESTNET' as const,
  };

  beforeEach(() => {
    MockWebSocket().instances = [];
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue({
      get: jest.fn().mockResolvedValue({ data: { balances: [] } }),
      post: jest.fn(),
    });
  });

  it('uses signed userDataStream.subscribe.signature and routes execution events', async () => {
    const adapter = new BinanceAdapter(account);
    const connected = jest.fn();
    adapter.on('websocket.connected', connected);
    const promise = adapter.startUserDataStream();
    const socket = MockWebSocket().instances[0];
    socket.readyState = 1;
    socket.emit('open');
    const request = JSON.parse(socket.sent[0]);
    expect(socket.url).toBe('wss://ws-api.testnet.binance.vision/ws-api/v3');
    expect(request.method).toBe('userDataStream.subscribe.signature');
    expect(request.params.apiKey).toBe('test-key');
    expect(request.params.signature).toHaveLength(64);
    socket.emit('message', JSON.stringify({ id: request.id, status: 200, result: { subscriptionId: 7 } }));
    await promise;
    expect(connected).toHaveBeenCalled();

    const routed = jest.fn();
    adapter.on('user-data-event', routed);
    socket.emit('message', JSON.stringify({
      subscriptionId: 7,
      event: { e: 'executionReport', E: 10, s: 'BTCUSDT', x: 'TRADE', i: 12, t: 99, S: 'BUY', q: '0.1', z: '0.1', p: '100' },
    }));
    expect(routed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fill', orderId: '12', exchangeTradeId: '99' }));
  });

  it('fails on unauthorized or malformed subscription responses', async () => {
    const unauthorized = new BinanceAdapter(account);
    const unauthorizedPromise = unauthorized.startUserDataStream();
    const unauthorizedSocket = MockWebSocket().instances[0];
    unauthorizedSocket.readyState = 1;
    unauthorizedSocket.emit('open');
    const unauthorizedRequest = JSON.parse(unauthorizedSocket.sent[0]);
    unauthorizedSocket.emit('message', JSON.stringify({ id: unauthorizedRequest.id, status: 401, error: { code: -2015 } }));
    await expect(unauthorizedPromise).rejects.toThrow(/subscription rejected/);

    const malformed = new BinanceAdapter(account);
    const malformedPromise = malformed.startUserDataStream();
    const malformedSocket = MockWebSocket().instances[1];
    malformedSocket.readyState = 1;
    malformedSocket.emit('open');
    malformedSocket.emit('message', '{');
    await expect(malformedPromise).rejects.toThrow(/Malformed/);
  });

  it('deduplicates repeated execution events and reconnects after close', async () => {
    const adapter = new BinanceAdapter(account);
    const routed = jest.fn();
    adapter.on('user-data-event', routed);
    const promise = adapter.startUserDataStream();
    const socket = MockWebSocket().instances[0];
    socket.readyState = 1;
    socket.emit('open');
    const request = JSON.parse(socket.sent[0]);
    socket.emit('message', JSON.stringify({ id: request.id, status: 200, result: { subscriptionId: 1 } }));
    await promise;
    const event = JSON.stringify({ e: 'executionReport', E: 11, s: 'BTCUSDT', x: 'TRADE', i: 9, t: 19, S: 'BUY', q: '0.1', z: '0.1', p: '100' });
    socket.emit('message', event);
    socket.emit('message', event);
    expect(routed).toHaveBeenCalledTimes(1);
    socket.emit('close');
    expect((adapter as any).userDataState).toBe('RECONNECTING');
  });
});
