import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import WebSocket from 'ws';
import ExchangeBase from '../ExchangeBase';
import { ExchangeEventRouter } from '../services/exchange-event-router';
import { redactCredentialText } from '../services/credential-redaction';
import {
  ExchangeAccount,
  Balance,
  MarketTicker,
  OrderParams,
  Order,
  Position,
  MarketOrderBook,
  MarketKline,
  ProtectionOrder,
  ProtectionOrderParams,
} from '../types';
import { ExchangeSymbolInfo } from '../IExchange';

interface BinanceExchangeAccount extends ExchangeAccount {
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
  };
}

export class BinanceAdapter extends ExchangeBase {
  readonly supportsPositionReconciliation = false;

  name = 'binance';
  private client: AxiosInstance | null = null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private baseUrl: string;
  private userDataWebSocket: WebSocket | null = null;
  private userDataSubscriptionId: string | null = null;
  private userDataSubscriptionRequestId = 0;
  private userDataSubscriptionPromise: Promise<void> | null = null;
  private userDataState: 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'RECONNECTING' | 'HALTED' = 'CONNECTING';
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly seenUserDataEventIds = new Set<string>();
  private weightUsage: number = 0;
  private lastResetTime: number = Date.now();
  private readonly MAX_WEIGHT = 1200; // Binance 1 min weight limit
  private readonly WEIGHT_RESET_INTERVAL = 60000; // 1 minute

  constructor(account?: BinanceExchangeAccount) {
    super(account);
    if (!account?.tradingMode) {
      throw new Error('Binance execution requires explicit tradingMode');
    }
    if (account.isPaper === true) {
      throw new Error('Binance cannot be used with isPaper=true');
    }
    const useLiveEndpoint = account.tradingMode === 'LIVE';
    if (account.tradingMode !== 'TESTNET' && account.tradingMode !== 'LIVE') {
      throw new Error(`Binance does not support execution mode ${account.tradingMode}`);
    }
    this.baseUrl = useLiveEndpoint
      ? 'https://api.binance.com/api'
      : 'https://testnet.binance.vision/api';
    
    if (account?.credentials) {
      this.apiKey = account.credentials.apiKey ?? null;
      this.apiSecret = account.credentials.apiSecret ?? null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.userDataWebSocket) {
      this.userDataWebSocket.removeAllListeners();
      this.userDataWebSocket.close();
      this.userDataWebSocket = null;
    }
    this.userDataSubscriptionId = null;
    this.userDataSubscriptionPromise = null;
    this.userDataState = 'HALTED';
    await super.disconnect();
  }

  async connect(account: ExchangeAccount): Promise<void> {
    if (!account.tradingMode || (account.tradingMode !== 'TESTNET' && account.tradingMode !== 'LIVE')) {
      throw new Error('Binance execution requires explicit TESTNET or LIVE tradingMode');
    }
    const expectedBaseUrl = account.tradingMode === 'LIVE'
      ? 'https://api.binance.com/api'
      : 'https://testnet.binance.vision/api';
    if (this.baseUrl !== expectedBaseUrl) {
      throw new Error('Binance endpoint does not match explicit tradingMode');
    }
    await super.connect(account);
    
    const binanceAccount = account as BinanceExchangeAccount;
    if (binanceAccount.credentials) {
      this.apiKey = binanceAccount.credentials.apiKey ?? null;
      this.apiSecret = binanceAccount.credentials.apiSecret ?? null;
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Binance API key and secret are required');
    }

    // Initialize axios client with Binance headers
    const httpClient = (axios as any).create ? (axios as any).create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
      },
    }) : {
      interceptors: { response: { use: () => undefined } },
    };

    if (!httpClient.interceptors) {
      httpClient.interceptors = { response: { use: () => undefined } };
    }

    if (typeof httpClient.request !== 'function') {
      httpClient.request = async (config: any) => {
        const method = (config.method || 'GET').toUpperCase();
        const params = config.params || {};
        const queryString = method === 'POST' && typeof config.data === 'string'
          ? config.data
          : new URLSearchParams(params).toString();
        const requestUrl = queryString ? `${config.url}?${queryString}` : config.url;

        if (method === 'GET') {
          if (typeof httpClient.get === 'function') {
            return httpClient.get(requestUrl);
          }
          return { data: {} };
        }

        if (method === 'DELETE') {
          if (typeof httpClient.delete === 'function') {
            return httpClient.delete(requestUrl);
          }
          return { data: {} };
        }

        if (typeof httpClient.post === 'function') {
          return httpClient.post(requestUrl);
        }

        return { data: {} };
      };
    }

    this.client = httpClient;

    // Add response interceptor for rate limit handling
    const activeClient = this.client;
    if (activeClient?.interceptors?.response) {
      activeClient.interceptors.response.use(
        (response: any) => {
          const usedWeight = parseInt(
            response.headers?.['x-mbx-used-weight-1m'] || '0',
            10,
          );
          this.weightUsage = usedWeight;

          if (usedWeight > this.MAX_WEIGHT * 0.8) {
            console.warn(`Binance API weight high: ${usedWeight}/${this.MAX_WEIGHT}`);
          }

          return response;
        },
        (error: any) => {
          if (error.response?.status === 429) {
            const retryAfter = parseInt(
              error.response.headers['retry-after'] || '1',
              10,
            );
            error.retryAfter = retryAfter * 1000;
            error.isRateLimit = true;
          }
          return Promise.reject(error);
        },
      );
    }

    // Test connection
    try {
      const timestamp = Date.now();
      const query = `timestamp=${timestamp}&recvWindow=5000`;
      const signature = this.generateSignature(query);
      await this.makeRequest('GET', '/v3/account', { timestamp, recvWindow: 5000, signature });
      this.emit('connected', { accountId: account.id });
    } catch (error: any) {
      throw new Error(`Failed to connect to Binance: ${this.safeErrorMessage(error)}`);
    }
  }

  /**
   * Make API request with rate limit retry
   * PHASE 1: Rate limiting with exponential backoff
   */
  private async makeRequest<T>(
    method: string,
    endpoint: string,
    params: any,
    maxRetries = 3,
  ): Promise<any> {
    const client = this.client!;
    if (!client) throw new Error('Not connected to Binance');

    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const config: any = { method };

        if (method === 'GET' || method === 'DELETE') {
          config.url = endpoint;
          config.params = params;
        } else {
          config.url = endpoint;
          config.data = new URLSearchParams(params).toString();
          config.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        }

        const response = await client.request(config);
        return response;
      } catch (error: any) {
        lastError = error;

        // Handle rate limiting with exponential backoff
        if (error.isRateLimit) {
          const waitTime = error.retryAfter || Math.pow(2, attempt) * 1000;

          if (attempt < maxRetries - 1) {
            console.warn(
              `Rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`,
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          }
        }

        // Don't retry on 4xx errors (except 429)
        if (
          error.response?.status &&
          error.response.status < 500 &&
          error.response.status !== 429
        ) {
          throw error;
        }

        // Retry on 5xx errors with exponential backoff
        if (error.response?.status >= 500 && attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.warn(
            `Server error ${error.response.status}. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Generate Binance request signature
   */
  private generateSignature(query: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret!)
      .update(query)
      .digest('hex');
  }

  private getUserDataApiUrl(): string {
    return this.account?.tradingMode === 'TESTNET'
      ? 'wss://ws-api.testnet.binance.vision/ws-api/v3'
      : 'wss://ws-api.binance.com:443/ws-api/v3';
  }

  private safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return redactCredentialText(message, [this.apiKey ?? '', this.apiSecret ?? '']);
  }

  private buildUserDataSubscriptionRequest(): { id: string; method: string; params: Record<string, string | number> } {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Binance API key and secret are required for user-data stream');
    }
    const timestamp = Date.now();
    const query = `apiKey=${this.apiKey}&timestamp=${timestamp}`;
    return {
      id: `user-data-${++this.userDataSubscriptionRequestId}`,
      method: 'userDataStream.subscribe.signature',
      params: {
        apiKey: this.apiKey,
        timestamp,
        signature: this.generateSignature(query),
      },
    };
  }

  async keepUserDataStreamAlive(): Promise<void> {
    // Spot WebSocket API user-data subscriptions do not use REST listen-key keepalives.
  }

  async startUserDataStream(): Promise<void> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Binance API key and secret are required for user-data stream');
    }

    if (this.userDataWebSocket && this.userDataWebSocket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.userDataSubscriptionPromise) return this.userDataSubscriptionPromise;

    this.userDataState = 'CONNECTING';
    const request = this.buildUserDataSubscriptionRequest();
    this.userDataSubscriptionPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getUserDataApiUrl());
      this.userDataWebSocket = socket;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        this.userDataState = 'DEGRADED';
        this.userDataSubscriptionPromise = null;
        reject(error);
      };
      socket.on('open', () => {
        socket.send(JSON.stringify(request));
      });
      socket.on('message', (message: any) => {
        let payload: any;
        try {
          payload = JSON.parse(typeof message === 'string' ? message : message?.toString());
        } catch {
          fail(new Error('Malformed Binance user-data websocket message'));
          return;
        }
        if (payload?.id === request.id) {
          if (payload.status !== 200 || payload.result?.subscriptionId === undefined) {
            fail(new Error(`Binance user-data subscription rejected (status=${String(payload?.status)})`));
            return;
          }
          this.userDataSubscriptionId = String(payload.result.subscriptionId);
          settled = true;
          this.userDataSubscriptionPromise = null;
          this.userDataState = 'CONNECTED';
          this.reconnectAttempts = 0;
          this.emit('websocket.connected', { type: 'user-data' });
          resolve();
          return;
        }
        this.handleUserDataMessage(typeof payload?.event === 'object' ? JSON.stringify(payload.event) : JSON.stringify(payload));
      });
      socket.on('close', () => {
        this.userDataSubscriptionId = null;
        if (!settled) fail(new Error('Binance user-data websocket closed before subscription'));
        if (this.userDataState === 'HALTED') return;
        this.userDataState = 'RECONNECTING';
        this.scheduleUserDataReconnect();
        this.emit('websocket.disconnected', { type: 'user-data' });
      });
      socket.on('error', (error: any) => {
        this.userDataState = 'DEGRADED';
        this.emit('websocket.error', { type: 'user-data', error: error?.message || String(error) });
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return this.userDataSubscriptionPromise;
  }

  private scheduleUserDataReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.userDataState = 'HALTED';
      return;
    }

    const backoffMs = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (!this.apiKey || !this.apiSecret) return;
      void this.startUserDataStream().catch(() => {
        this.userDataState = 'DEGRADED';
      });
    }, backoffMs);
  }

  bindRouter(router: ExchangeEventRouter): () => void {
    const listener = (event: any) => {
      router.handle({ ...event, source: 'binance' });
    };
    this.on('user-data-event', listener);
    return () => this.off('user-data-event', listener);
  }

  private handleUserDataMessage(raw: string): void {
    try {
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const eventId = `${payload.e ?? 'event'}:${payload.E ?? payload.u ?? payload.T ?? 0}`;
      if (this.seenUserDataEventIds.has(eventId)) {
        return;
      }
      this.seenUserDataEventIds.add(eventId);

      const normalized = this.normalizeUserDataEvent(payload);
      if (normalized) {
        const eventEnvelope = {
          ...normalized,
          source: 'binance',
          eventId,
          type: 'user-data-event',
        };
        this.emit('user-data-event', eventEnvelope);
      }
    } catch (_error) {
      this.userDataState = 'DEGRADED';
      this.emit('websocket.degraded', { type: 'user-data', reason: 'malformed-message' });
    }
  }

  normalizeUserDataEvent(payload: any):
    | { kind: 'order'; symbol: string; status: string; orderId?: string; side?: string; quantity?: number; filledQuantity?: number; price?: number; }
    | { kind: 'fill'; symbol: string; orderId?: string; clientOrderId?: string; exchangeTradeId?: string; side?: string; quantity?: number; filledQuantity?: number; fillQuantity?: number; averagePrice?: number; price?: number; fee?: number; timestamp?: number; }
    | { kind: 'account'; asset?: string; balance?: string; }
    | { kind: 'position'; symbol: string; side?: string; quantity?: number; entryPrice?: number; }
    | null {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.e === 'executionReport') {
      if (payload.x === 'TRADE' && payload.t !== undefined) {
        return {
          kind: 'fill',
          symbol: payload.s,
          orderId: String(payload.i),
          clientOrderId: payload.c,
          exchangeTradeId: String(payload.t),
          side: payload.S,
          quantity: Number(payload.q ?? 0),
          filledQuantity: Number(payload.z ?? 0),
          fillQuantity: Number(payload.l ?? 0),
          averagePrice: Number(payload.L ?? payload.p ?? 0),
          price: Number(payload.L ?? payload.p ?? 0),
          fee: Number(payload.n ?? 0),
          timestamp: Number(payload.T ?? payload.E ?? Date.now()),
        };
      }
      return {
        kind: 'order',
        symbol: payload.s,
        status: payload.x,
        orderId: String(payload.i),
        side: payload.S,
        quantity: Number(payload.q ?? 0),
        filledQuantity: Number(payload.z ?? 0),
        price: Number(payload.p ?? 0),
      };
    }

    if (payload.e === 'outboundAccountInfo' || payload.e === 'balanceUpdate') {
      return {
        kind: 'account',
        asset: payload.a ?? payload.asset,
        balance: payload.b ?? payload.balance,
      };
    }

    if (payload.e === 'outboundAccountPosition') {
      const positions = payload.B ?? [];
      const first = Array.isArray(positions) ? positions[0] : null;
      return {
        kind: 'position',
        symbol: payload.s ?? first?.a ?? 'UNKNOWN',
        side: payload.ps ?? 'LONG',
        quantity: Number(payload.q ?? first?.f ?? 0),
        entryPrice: Number(payload.p ?? 0),
      };
    }

    return null;
  }

  /**
   * Fetch account balances
   */
  async fetchBalances(): Promise<Balance[]> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const query = `timestamp=${timestamp}&recvWindow=5000`;
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('GET', '/v3/account', {
        timestamp,
        recvWindow: 5000,
        signature,
      });

      return response.data.balances
        .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map((b: any) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
        }));
    } catch (error: any) {
      throw new Error(`Failed to fetch Binance balances: ${this.safeErrorMessage(error)}`);
    }
  }

  /**
   * Fetch market ticker
   */
  async fetchTicker(symbol: string): Promise<MarketTicker> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const response = await this.makeRequest('GET', '/v3/ticker/bookTicker', {
        symbol,
      });
      return {
        symbol: response.data.symbol,
        bid: response.data.bidPrice,
        ask: response.data.askPrice,
        last: response.data.bidPrice, // Use bid as last for simplicity
        timestamp: Number(response.headers?.date ? Date.parse(response.headers.date) : Date.now()),
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch ticker for ${symbol}: ${this.safeErrorMessage(error)}`);
    }
  }

  async fetchOrderBook(symbol: string, limit = 20): Promise<MarketOrderBook> {
      if (!this.client) throw new Error('Not connected to Binance');
      const response = await this.makeRequest('GET', '/v3/depth', { symbol, limit });
      return {
        symbol,
        bids: Array.isArray(response.data?.bids) ? response.data.bids : [],
        asks: Array.isArray(response.data?.asks) ? response.data.asks : [],
        timestamp: Date.now(),
      };
    }

  async fetchRecentKlines(symbol: string, interval = '1m', limit = 30): Promise<MarketKline[]> {
      if (!this.client) throw new Error('Not connected to Binance');
      const response = await this.makeRequest('GET', '/v3/klines', { symbol, interval, limit });
      return (Array.isArray(response.data) ? response.data : []).map((row: any[]) => ({
        symbol,
        close: String(row[4]),
        timestamp: Number(row[6] ?? row[0]),
      }));
  }

  async fetchSymbolInfo(symbol: string): Promise<ExchangeSymbolInfo> {
    if (!this.client) throw new Error('Not connected to Binance');
    const response = await this.makeRequest('GET', '/v3/exchangeInfo', { symbol });
    const info = response.data?.symbols?.[0];
    if (!info || info.symbol !== symbol) {
      throw new Error(`Binance symbol metadata unavailable for ${symbol}`);
    }
    return {
      symbol: info.symbol,
      status: info.status,
      filters: info.filters,
    };
  }

  /**
   * Place order on Binance
   * With rate limit retry (429 handling)
   */
  async placeOrder(params: OrderParams): Promise<Order> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const clientOrderId = params.clientOrderId || `${this.account?.id}-${timestamp}`;

      const orderParams: any = {
        symbol: params.symbol,
        side: params.side.toUpperCase(),
        type: (params.type || 'LIMIT').toUpperCase(),
        quantity: params.quantity,
        newClientOrderId: clientOrderId,
        timestamp,
        recvWindow: 5000,
      };

      if (orderParams.type !== 'MARKET') {
        orderParams.timeInForce = params.timeInForce || 'GTC';
      }

      if (params.price) {
        orderParams.price = params.price;
      }
      if (params.triggerPrice) {
        orderParams.stopPrice = params.triggerPrice;
      }

      const query = new URLSearchParams(orderParams).toString();
      const signature = this.generateSignature(query);

      // An ambiguous order POST must be reconciled by clientOrderId before retrying.
      const response = await this.makeRequest('POST', '/v3/order', {
        ...orderParams,
        signature,
      }, 1);

      return {
        id: response.data.orderId.toString(),
        clientOrderId: response.data.clientOrderId,
        externalId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side: response.data.side.toLowerCase() as 'buy' | 'sell',
        price: response.data.price,
        quantity: response.data.origQty,
        filled: response.data.executedQty,
        status: response.data.status,
        createdAt: new Date(response.data.time),
        updatedAt: new Date(response.data.updateTime),
        meta: {
          externalOrderId: response.data.orderId,
          clientOrderId: response.data.clientOrderId,
          triggerPrice: params.triggerPrice,
          protectionKind: params.type === 'take_profit_limit' ? 'TAKE_PROFIT' : params.type === 'stop_loss_limit' ? 'STOP_LOSS' : undefined,
        },
      };
    } catch (error: any) {
      const response = error?.response;
      const responseData = response?.data;
      const metadata = {
        symbol: params.symbol,
        side: params.side.toUpperCase(),
        type: (params.type || 'LIMIT').toUpperCase(),
        quantity: params.quantity,
        price: params.price,
        timeInForce: params.timeInForce || 'GTC',
        hasClientOrderId: Boolean(params.clientOrderId),
      };
      const diagnostic = response
        ? `HTTP ${response.status}; Binance code=${String(responseData?.code ?? 'unknown')}; message=${String(responseData?.msg ?? responseData?.message ?? 'unknown')}; method=POST; endpoint=/v3/order; metadata=${JSON.stringify(metadata)}`
        : this.safeErrorMessage(error);
      throw new Error(
        `Failed to place order on Binance: ${diagnostic}`,
      );
    }
  }

  /**
   * Get order status
   * With rate limit retry
   */
  async getOrder(orderId: string, symbol?: string): Promise<Order | null> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        timestamp,
        recvWindow: 5000,
      };
      if (symbol) params.symbol = symbol;
      if (/^\d+$/.test(orderId)) {
        params.orderId = orderId;
      } else {
        params.origClientOrderId = orderId;
      }

      const query = new URLSearchParams(params as Record<string, string>).toString();
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('GET', '/v3/order', {
        ...params,
        signature,
      });

      const order: Order = {
        id: response.data.orderId.toString(),
        clientOrderId: response.data.clientOrderId,
        externalId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side: response.data.side.toLowerCase() as 'buy' | 'sell',
        price: response.data.price,
        quantity: response.data.origQty,
        filled: response.data.executedQty,
        status: response.data.status,
        createdAt: new Date(response.data.time),
        updatedAt: new Date(response.data.updateTime),
        meta: {
          triggerPrice: response.data.stopPrice,
          protectionKind: response.data.type === 'TAKE_PROFIT_LIMIT' ? 'TAKE_PROFIT' : response.data.type === 'STOP_LOSS_LIMIT' ? 'STOP_LOSS' : undefined,
        },
      };
      if (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED') {
        const tradeParams = {
          symbol: response.data.symbol,
          orderId: response.data.orderId,
          timestamp: Date.now(),
          recvWindow: 5000,
        };
        const tradeQuery = new URLSearchParams(tradeParams as unknown as Record<string, string>).toString();
        const tradeSignature = this.generateSignature(tradeQuery);
        const tradesResponse = await this.makeRequest('GET', '/v3/myTrades', {
          ...tradeParams,
          signature: tradeSignature,
        });
        const fills = Array.isArray(tradesResponse.data) ? tradesResponse.data : [];
        const totalQuote = fills.reduce((sum: number, fill: any) => sum + Number(fill.quoteQty || 0), 0);
        const totalQuantity = fills.reduce((sum: number, fill: any) => sum + Number(fill.qty || 0), 0);
        const latestFill = fills[fills.length - 1];
        order.meta = {
          exchangeOrderId: String(response.data.orderId),
          exchangeTradeId: latestFill?.id != null ? String(latestFill.id) : undefined,
          averagePrice: totalQuantity > 0 ? totalQuote / totalQuantity : Number(response.data.price),
          fee: fills.reduce((sum: number, fill: any) => sum + Number(fill.commission || 0), 0),
          fills: fills.map((fill: any) => ({
            id: String(fill.id),
            price: String(fill.price),
            quantity: String(fill.qty),
            quoteQuantity: String(fill.quoteQty),
            fee: String(fill.commission || 0),
            feeAsset: fill.commissionAsset,
            timestamp: fill.time,
          })),
        };
      }
      return order;
    } catch (error: any) {
      const response = error?.response;
      const responseData = response?.data;
      const metadata = {
        symbol: symbol ?? null,
        lookup: /^\d+$/.test(orderId) ? 'orderId' : 'origClientOrderId',
        hasOrderId: /^\d+$/.test(orderId),
        hasClientOrderId: !/^\d+$/.test(orderId),
        recvWindow: 5000,
      };
      const diagnostic = response
        ? `HTTP ${response.status}; Binance code=${String(responseData?.code ?? 'unknown')}; message=${String(responseData?.msg ?? responseData?.message ?? 'unknown')}; method=GET; endpoint=/v3/order; metadata=${JSON.stringify(metadata)}`
        : this.safeErrorMessage(error);
      throw new Error(`Failed to get order status: ${diagnostic}`);
    }
  }

  async createProtectionOrder(params: ProtectionOrderParams): Promise<ProtectionOrder> {
    const type = params.kind === 'STOP_LOSS' ? 'stop_loss_limit' : 'take_profit_limit';
    const order = await this.placeOrder({
      symbol: params.symbol,
      side: params.side,
      type,
      quantity: params.quantity,
      price: params.limitPrice,
      triggerPrice: params.triggerPrice,
      clientOrderId: params.clientOrderId,
      timeInForce: params.timeInForce ?? 'GTC',
    });
    if (!order.externalId && !order.id) {
      throw new Error('Binance protection order acknowledgement is missing exchange identity');
    }
    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      externalId: order.externalId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      triggerPrice: params.triggerPrice,
      limitPrice: params.limitPrice,
      kind: params.kind,
      status: order.status,
      state: 'CONFIRMED',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt ?? order.createdAt,
    };
  }

  async amendProtectionOrder(orderId: string, params: Partial<ProtectionOrderParams>): Promise<ProtectionOrder> {
    if (!this.client) throw new Error('Not connected to Binance');
    if (!params.symbol || !params.kind || !params.triggerPrice || !params.limitPrice || !params.quantity) {
      throw new Error('Protection amendment requires symbol, kind, triggerPrice, limitPrice, and quantity');
    }
    const orderParams: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side?.toUpperCase() ?? 'SELL',
      quantity: params.quantity,
      price: params.limitPrice,
      stopPrice: params.triggerPrice,
      timeInForce: params.timeInForce ?? 'GTC',
      timestamp: Date.now(),
      recvWindow: 5000,
    };
    const query = new URLSearchParams(orderParams as Record<string, string>).toString();
    const response = await this.makeRequest('PUT', '/v3/order', {
      ...orderParams,
      orderId: /^\d+$/.test(orderId) ? orderId : undefined,
      origClientOrderId: /^\d+$/.test(orderId) ? undefined : orderId,
      signature: this.generateSignature(query),
    });
    const data = response.data;
    if (!data?.orderId) throw new Error('Binance protection amendment acknowledgement is missing exchange identity');
    return {
      id: String(data.orderId),
      clientOrderId: data.clientOrderId,
      externalId: String(data.orderId),
      symbol: data.symbol,
      side: String(data.side).toLowerCase() as 'buy' | 'sell',
      quantity: data.origQty,
      triggerPrice: params.triggerPrice,
      limitPrice: params.limitPrice,
      kind: params.kind,
      status: data.status,
      state: 'CONFIRMED',
      createdAt: new Date(data.transactTime ?? Date.now()),
      updatedAt: new Date(data.updateTime ?? Date.now()),
    };
  }

  async cancelProtectionOrder(orderId: string, symbol?: string): Promise<void> {
    if (!this.client) throw new Error('Not connected to Binance');
    const params: Record<string, string | number> = {
      timestamp: Date.now(),
      recvWindow: 5000,
    };
    if (/^\d+$/.test(orderId)) params.orderId = orderId;
    else params.origClientOrderId = orderId;
    if (symbol) params.symbol = symbol;
    const query = new URLSearchParams(params as Record<string, string>).toString();
    await this.makeRequest('DELETE', '/v3/order', {
      ...params,
      signature: this.generateSignature(query),
    });
  }

  async getProtectionOrder(orderId: string, symbol?: string): Promise<ProtectionOrder | null> {
    const order = await this.getOrder(orderId, symbol);
    if (!order) return null;
    const meta = order.meta ?? {};
    const triggerPrice = String(meta.triggerPrice ?? order.price ?? '');
    if (!triggerPrice) throw new Error('Protection order response is missing trigger price');
    return {
      id: order.id,
      clientOrderId: order.clientOrderId,
      externalId: order.externalId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      triggerPrice,
      limitPrice: String(order.price ?? ''),
      kind: meta.protectionKind === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'STOP_LOSS',
      status: order.status,
      state: 'CONFIRMED',
      createdAt: order.createdAt,
      updatedAt: order.updatedAt ?? order.createdAt,
    };
  }

  /**
   * Fetch all open orders for reconciliation
   * With rate limit retry
   */
  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const params: any = { timestamp, recvWindow: 5000 };
      if (symbol) params.symbol = symbol;

      const query = new URLSearchParams(params).toString();
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('GET', '/v3/openOrders', {
        ...params,
        signature,
      });

      return response.data.map((order: any) => ({
        id: order.orderId.toString(),
        clientOrderId: order.clientOrderId,
        externalId: order.orderId.toString(),
        symbol: order.symbol,
        side: order.side.toLowerCase() as 'buy' | 'sell',
        price: order.price,
        quantity: order.origQty,
        filled: order.executedQty,
        status: order.status,
        createdAt: new Date(order.time),
        updatedAt: new Date(order.updateTime),
      }));
    } catch (error) {
      throw new Error(
        `Failed to fetch open orders: ${this.safeErrorMessage(error)}`,
      );
    }
  }

  /**
   * Cancel order
   * With rate limit retry
   */
  async cancelOrder(orderId: string): Promise<void> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const params: any = {
        orderId: orderId.split('-')[0],
        timestamp,
        recvWindow: 5000,
      };

      const query = new URLSearchParams(params).toString();
      const signature = this.generateSignature(query);

      await this.makeRequest('DELETE', '/v3/order', {
        ...params,
        signature,
      });
    } catch (error) {
      throw new Error(
        `Failed to cancel order: ${this.safeErrorMessage(error)}`,
      );
    }
  }

  /**
   * Fetch open positions (for futures)
   * Note: Spot trading doesn't have "positions", only balances
   */
  async fetchOpenPositions(): Promise<Position[]> {
    // Spot trading doesn't use positions like futures do
    // Return empty array as positions are tracked via balances in spot trading
    return [];
  }

  /**
   * Subscribe to ticker updates (WebSocket - TODO)
   */
  subscribeTicker(symbol: string): void {
    // TODO: Implement WebSocket subscription
    this.emit('ticker', { symbol });
  }

  /**
   * Unsubscribe from ticker updates
   */
  unsubscribeTicker(symbol: string): void {
    // TODO: Implement WebSocket unsubscription
  }
}

export default BinanceAdapter;
