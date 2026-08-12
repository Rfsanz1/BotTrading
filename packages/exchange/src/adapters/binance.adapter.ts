import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import ExchangeBase from '../ExchangeBase';
import { ExchangeAccount, Balance, MarketTicker, OrderParams, Order, Position } from '../types';

interface BinanceExchangeAccount extends ExchangeAccount {
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
  };
}

export class BinanceAdapter extends ExchangeBase {
  name = 'binance';
  private client: AxiosInstance | null = null;
  private apiKey: string | null = null;
  private apiSecret: string | null = null;
  private baseUrl: string;
  private weightUsage: number = 0;
  private lastResetTime: number = Date.now();
  private readonly MAX_WEIGHT = 1200; // Binance 1 min weight limit
  private readonly WEIGHT_RESET_INTERVAL = 60000; // 1 minute

  constructor(account?: BinanceExchangeAccount) {
    super(account);
    // Use testnet by default for safety
    this.baseUrl = process.env.BINANCE_USE_TESTNET !== 'false' 
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api';
    
    if (account?.credentials) {
      this.apiKey = account.credentials.apiKey;
      this.apiSecret = account.credentials.apiSecret;
    }
  }

  async connect(account: ExchangeAccount): Promise<void> {
    await super.connect(account);
    
    const binanceAccount = account as BinanceExchangeAccount;
    if (binanceAccount.credentials) {
      this.apiKey = binanceAccount.credentials.apiKey;
      this.apiSecret = binanceAccount.credentials.apiSecret;
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Binance API key and secret are required');
    }

    // Initialize axios client with Binance headers
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
      },
    });

    // Add response interceptor for rate limit handling
    this.client.interceptors.response.use(
      (response) => {
        // Track API weight usage
        const usedWeight = parseInt(
          response.headers['x-mbx-used-weight-1m'] || '0',
          10,
        );
        this.weightUsage = usedWeight;

        if (usedWeight > this.MAX_WEIGHT * 0.8) {
          console.warn(`Binance API weight high: ${usedWeight}/${this.MAX_WEIGHT}`);
        }

        return response;
      },
      (error) => {
        // Handle rate limit errors
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

    // Test connection
    try {
      await this.makeRequest('GET', '/v3/account', {});
      this.emit('connected', { accountId: account.id });
    } catch (error) {
      throw new Error(`Failed to connect to Binance: ${error.message}`);
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
    if (!this.client) throw new Error('Not connected to Binance');

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

        const response = await this.client.request(config);
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

  /**
   * Fetch account balances
   */
  async fetchBalances(): Promise<Balance[]> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const query = `timestamp=${timestamp}`;
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('GET', '/v3/account', {
        timestamp,
        signature,
      });

      return response.data.balances
        .filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map((b: any) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
        }));
    } catch (error) {
      throw new Error(`Failed to fetch Binance balances: ${error.message}`);
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
        timestamp: Date.now(),
      };
    } catch (error) {
      throw new Error(`Failed to fetch ticker for ${symbol}: ${error.message}`);
    }
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
        timeInForce: params.timeInForce || 'GTC',
        quantity: params.quantity,
        newClientOrderId: clientOrderId,
        timestamp,
      };

      if (params.price) {
        orderParams.price = params.price;
      }

      const query = new URLSearchParams(orderParams).toString();
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('POST', '/v3/order', {
        ...orderParams,
        signature,
      });

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
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to place order on Binance: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get order status
   * With rate limit retry
   */
  async getOrder(orderId: string): Promise<Order | null> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const params: any = {
        orderId: orderId.split('-')[0], // Extract numeric order ID
        timestamp,
      };

      const query = new URLSearchParams(params).toString();
      const signature = this.generateSignature(query);

      const response = await this.makeRequest('GET', '/v3/order', {
        ...params,
        signature,
      });

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
      };
    } catch (error) {
      throw new Error(
        `Failed to get order status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Fetch all open orders for reconciliation
   * With rate limit retry
   */
  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    if (!this.client) throw new Error('Not connected to Binance');

    try {
      const timestamp = Date.now();
      const params: any = { timestamp };
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
        `Failed to fetch open orders: ${error instanceof Error ? error.message : String(error)}`,
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
      };

      const query = new URLSearchParams(params).toString();
      const signature = this.generateSignature(query);

      await this.makeRequest('DELETE', '/v3/order', {
        ...params,
        signature,
      });
    } catch (error) {
      throw new Error(
        `Failed to cancel order: ${error instanceof Error ? error.message : String(error)}`,
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
