/**
 * PHASE 1 - Binance Adapter Tests
 * Tests order submission mapping and response handling
 */

import { BinanceAdapter } from '../binance.adapter';
import { ExchangeAccount, OrderParams } from '../../types';
import axios from 'axios';

jest.mock('axios');

describe('BinanceAdapter - Phase 1', () => {
  let adapter: BinanceAdapter;
  const mockAccount: ExchangeAccount = {
    id: 'acc-123',
    userId: 'user-123',
    exchange: 'binance',
    accountId: 'binance-123',
    credentials: {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    },
    isActive: true,
    isPaper: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new BinanceAdapter(mockAccount);
  });

  describe('Binance Adapter Initialization', () => {
    it('should use testnet URL by default', () => {
      const newAdapter = new BinanceAdapter(mockAccount);
      expect(newAdapter['baseUrl']).toContain('testnet');
    });

    it('should use mainnet URL when configured', () => {
      process.env.BINANCE_USE_TESTNET = 'false';
      const newAdapter = new BinanceAdapter(mockAccount);
      expect(newAdapter['baseUrl']).toContain('api.binance.com');
      delete process.env.BINANCE_USE_TESTNET;
    });
  });

  describe('Order Submission', () => {
    it('should format and submit order correctly', async () => {
      // Mock axios.create and post
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          orderId: 12345,
          clientOrderId: 'order-123-timestamp',
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'LIMIT',
          price: '45000.00',
          origQty: '0.5',
          executedQty: '0',
          status: 'NEW',
          time: Date.now(),
          updateTime: Date.now(),
        },
      });

      const mockGet = jest.fn().mockResolvedValue({
        data: {
          balances: [],
        },
      });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
        post: mockPost,
      });

      // Connect first
      await adapter.connect(mockAccount);

      // Prepare order params
      const orderParams: OrderParams = {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '0.5',
        price: '45000.00',
        clientOrderId: 'order-123-timestamp',
        timeInForce: 'GTC',
      };

      // Act
      const result = await adapter.placeOrder(orderParams);

      // Assert
      expect(result).toMatchObject({
        id: '12345',
        symbol: 'BTCUSDT',
        side: 'buy',
        quantity: '0.5',
        status: 'NEW',
      });

      expect(result.externalId).toBe('12345');
      expect(result.clientOrderId).toBe('order-123-timestamp');
    });

    it('should include clientOrderId for idempotency', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          orderId: 12345,
          clientOrderId: 'custom-client-id',
          symbol: 'BTCUSDT',
          side: 'BUY',
          price: '45000.00',
          origQty: '0.5',
          executedQty: '0',
          status: 'NEW',
          time: Date.now(),
          updateTime: Date.now(),
        },
      });

      const mockGet = jest.fn().mockResolvedValue({ data: { balances: [] } });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
        post: mockPost,
      });

      await adapter.connect(mockAccount);

      const orderParams: OrderParams = {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '0.5',
        price: '45000.00',
        clientOrderId: 'custom-client-id',
      };

      await adapter.placeOrder(orderParams);

      // Verify clientOrderId was included
      const callArgs = mockPost.mock.calls[0][0];
      expect(callArgs).toContain('newClientOrderId=custom-client-id');
    });

    it('should throw error if not connected', async () => {
      const orderParams: OrderParams = {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '0.5',
        price: '45000.00',
      };

      await expect(adapter.placeOrder(orderParams)).rejects.toThrow(
        'Not connected to Binance',
      );
    });
  });

  describe('Order Status', () => {
    it('should fetch and map order status correctly', async () => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } }) // connect
        .mockResolvedValueOnce({
          // getOrder
          data: {
            orderId: 12345,
            clientOrderId: 'order-123',
            symbol: 'BTCUSDT',
            side: 'BUY',
            price: '45000.00',
            origQty: '0.5',
            executedQty: '0.25', // Partially filled
            status: 'PARTIALLY_FILLED',
            time: Date.now(),
            updateTime: Date.now(),
          },
        });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await adapter.connect(mockAccount);
      const result = await adapter.getOrder('12345');

      expect(result).toMatchObject({
        id: '12345',
        symbol: 'BTCUSDT',
        filled: '0.25', // Partial fill
        status: 'PARTIALLY_FILLED',
      });
    });
  });

  describe('Order Cancellation', () => {
    it('should construct cancellation request correctly', async () => {
      const mockDelete = jest.fn().mockResolvedValue({ data: {} });
      const mockGet = jest.fn().mockResolvedValue({ data: { balances: [] } });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
        delete: mockDelete,
      });

      await adapter.connect(mockAccount);
      await adapter.cancelOrder('12345');

      expect(mockDelete).toHaveBeenCalled();
      const callArgs = mockDelete.mock.calls[0][0];
      expect(callArgs).toContain('orderId=12345');
    });
  });

  describe('Balance Fetching', () => {
    it('should fetch and filter balances', async () => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } }) // connect
        .mockResolvedValueOnce({
          // fetchBalances
          data: {
            balances: [
              { asset: 'BTC', free: '0.5', locked: '0.1' },
              { asset: 'ETH', free: '2.0', locked: '0' },
              { asset: 'USDT', free: '0', locked: '0' }, // Will be filtered out
            ],
          },
        });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await adapter.connect(mockAccount);
      const result = await adapter.fetchBalances();

      expect(result).toEqual([
        { asset: 'BTC', free: '0.5', locked: '0.1' },
        { asset: 'ETH', free: '2.0', locked: '0' },
      ]);
    });
  });

  describe('Open Orders Reconciliation', () => {
    it('should fetch all open orders for reconciliation', async () => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } }) // connect
        .mockResolvedValueOnce({
          // fetchOpenOrders
          data: [
            {
              orderId: 12345,
              clientOrderId: 'order-1',
              symbol: 'BTCUSDT',
              side: 'BUY',
              price: '45000',
              origQty: '0.5',
              executedQty: '0.5',
              status: 'FILLED',
              time: Date.now(),
              updateTime: Date.now(),
            },
            {
              orderId: 12346,
              clientOrderId: 'order-2',
              symbol: 'ETHUSDT',
              side: 'SELL',
              price: '2500',
              origQty: '1.0',
              executedQty: '0.5',
              status: 'PARTIALLY_FILLED',
              time: Date.now(),
              updateTime: Date.now(),
            },
          ],
        });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await adapter.connect(mockAccount);
      const result = await adapter.fetchOpenOrders();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('FILLED');
      expect(result[1].status).toBe('PARTIALLY_FILLED');
    });

    it('should filter open orders by symbol', async () => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } }) // connect
        .mockResolvedValueOnce({
          data: [
            {
              orderId: 12345,
              symbol: 'BTCUSDT',
              side: 'BUY',
              price: '45000',
              origQty: '0.5',
              executedQty: '0',
              status: 'NEW',
              time: Date.now(),
              updateTime: Date.now(),
            },
          ],
        });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await adapter.connect(mockAccount);
      await adapter.fetchOpenOrders('BTCUSDT');

      // Verify symbol parameter was included
      const callArgs = mockGet.mock.calls[1][0];
      expect(callArgs).toContain('symbol=BTCUSDT');
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors', async () => {
      const mockGet = jest.fn().mockRejectedValueOnce(
        new Error('Invalid API key'),
      );

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await expect(adapter.connect(mockAccount)).rejects.toThrow();
    });

    it('should handle network timeouts', async () => {
      const mockPost = jest.fn().mockRejectedValueOnce(
        new Error('Request timeout'),
      );

      (axios.create as jest.Mock).mockReturnValue({
        post: mockPost,
        get: jest.fn().mockResolvedValue({ data: { balances: [] } }),
      });

      await adapter.connect(mockAccount);

      const orderParams: OrderParams = {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '0.5',
        price: '45000.00',
      };

      await expect(adapter.placeOrder(orderParams)).rejects.toThrow();
    });
  });

  describe('HMAC Signature Generation', () => {
    it('should generate valid HMAC-SHA256 signatures', () => {
      const query = 'symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=1';
      const signature = adapter['generateSignature'](query);

      // Verify it's a valid hex string
      expect(signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
