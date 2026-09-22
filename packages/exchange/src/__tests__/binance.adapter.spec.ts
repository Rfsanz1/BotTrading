/**
 * PHASE 1 - Binance Adapter Tests
 * Tests order submission mapping and response handling
 */

import { BinanceAdapter } from '../adapters/binance.adapter';
import { ExchangeAccount, OrderParams } from '../types';
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
    isPaper: false,
    tradingMode: 'TESTNET',
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

    it('uses mainnet URL only for explicit LIVE mode', () => {
      process.env.BINANCE_USE_TESTNET = 'false';
      const newAdapter = new BinanceAdapter({ ...mockAccount, tradingMode: 'LIVE', isPaper: false });
      expect(newAdapter['baseUrl']).toContain('api.binance.com');
      delete process.env.BINANCE_USE_TESTNET;
    });

    it('rejects missing tradingMode', () => {
      expect(() => new BinanceAdapter({ ...mockAccount, tradingMode: undefined })).toThrow(/explicit tradingMode/);
    });

    it('does not let BINANCE_USE_TESTNET select the endpoint', () => {
      process.env.BINANCE_USE_TESTNET = 'false';
      expect(new BinanceAdapter(mockAccount)['baseUrl']).toContain('testnet');
      process.env.BINANCE_USE_TESTNET = 'true';
      expect(new BinanceAdapter({ ...mockAccount, tradingMode: 'LIVE', isPaper: false })['baseUrl']).toContain('api.binance.com');
      delete process.env.BINANCE_USE_TESTNET;
    });
  });

  describe('Order Submission', () => {
    it('submits native OCO protection as one order list with deterministic client IDs', async () => {
      const mockPost = jest.fn().mockResolvedValue({
        data: { orderListId: 99, listStatusType: 'EXEC_STARTED', transactionTime: Date.now() },
      });
      const mockGet = jest.fn().mockResolvedValue({ data: { balances: [] } });
      (axios.create as jest.Mock).mockReturnValue({ get: mockGet, post: mockPost });
      await adapter.connect(mockAccount);
      const result = await adapter.createProtectionOco({
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '0.5',
        stopLossTriggerPrice: '44000',
        stopLossLimitPrice: '43900',
        takeProfitTriggerPrice: '46000',
        takeProfitLimitPrice: '45900',
        listClientOrderId: 'pos-p1-oco',
        stopLossClientOrderId: 'pos-p1-oco-sl',
        takeProfitClientOrderId: 'pos-p1-oco-tp',
      });
      expect(result.externalId).toBe('99');
      expect(mockPost.mock.calls.some(([url]) => String(url).includes('/v3/orderList/oco'))).toBe(true);
    });

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

    it('captures sanitized Binance 400 diagnostics without secret material', async () => {
      const mockPost = jest.fn().mockRejectedValue({
        response: {
          status: 400,
          data: {
            code: -1013,
            msg: 'Filter failure: MIN_NOTIONAL',
            apiKey: 'should-not-be-exposed',
          },
        },
      });
      const mockGet = jest.fn().mockResolvedValue({ data: { balances: [] } });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
        post: mockPost,
      });

      await adapter.connect(mockAccount);

      await expect(adapter.placeOrder({
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '0.00007',
        price: '78419.31',
        clientOrderId: 'safe-client-id',
        timeInForce: 'GTC',
      })).rejects.toThrow(
        /HTTP 400.*Binance code=-1013.*message=Filter failure: MIN_NOTIONAL.*endpoint=\/v3\/order/,
      );

      try {
        await adapter.placeOrder({
          symbol: 'BTCUSDT',
          side: 'buy',
          type: 'limit',
          quantity: '0.00007',
          price: '78419.31',
          clientOrderId: 'safe-client-id',
          timeInForce: 'GTC',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain('test-secret');
        expect(message).not.toContain('should-not-be-exposed');
        expect(message).not.toContain('signature');
        expect(message).toContain('hasClientOrderId');
      }
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
        })
        .mockResolvedValueOnce({
          data: [{
            id: 71936,
            orderId: 12345,
            price: '44950.00',
            qty: '0.25',
            quoteQty: '11237.50',
            commission: '0.0001',
            commissionAsset: 'BTC',
            time: Date.now(),
          }],
        });

      (axios.create as jest.Mock).mockReturnValue({
        get: mockGet,
      });

      await adapter.connect(mockAccount);
      const result = await adapter.getOrder('12345', 'BTCUSDT');

      expect(result).toMatchObject({
        id: '12345',
        symbol: 'BTCUSDT',
        filled: '0.25', // Partial fill
        status: 'PARTIALLY_FILLED',
      });
      expect(result?.meta).toMatchObject({
        exchangeTradeId: '71936',
        averagePrice: 44950,
        fee: 0.0001,
      });
      expect(mockGet.mock.calls[1][0]).toContain('symbol=BTCUSDT');
      expect(mockGet.mock.calls[1][0]).toContain('orderId=12345');
      expect(mockGet.mock.calls[1][0]).toContain('recvWindow=5000');
    });

    it('looks up by client order ID and surfaces Binance 400 diagnostics safely', async () => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } })
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: {
              code: -1102,
              msg: "Mandatory parameter 'symbol' was not sent, was empty/null, or malformed.",
            },
          },
        });
      (axios.create as jest.Mock).mockReturnValue({ get: mockGet });

      await adapter.connect(mockAccount);
      let errorMessage = '';
      try {
        await adapter.getOrder('bt-client-id', 'BTCUSDT');
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).toMatch(
        /HTTP 400.*Binance code=-1102.*Mandatory parameter 'symbol'.*endpoint=\/v3\/order/,
      );
      expect(mockGet.mock.calls[1][0]).toContain('symbol=BTCUSDT');
      expect(mockGet.mock.calls[1][0]).toContain('origClientOrderId=bt-client-id');
      expect(errorMessage).not.toContain('test-secret');
      expect(errorMessage).not.toContain('signature');
    });

    it.each([
      [-1022, 'Signature for this request is not valid.'],
      [-2015, 'Invalid API-key, IP, or permissions for action.'],
    ])('surfaces authoritative lookup rejection code %s without secrets', async (code, msg) => {
      const mockGet = jest.fn()
        .mockResolvedValueOnce({ data: { balances: [] } })
        .mockRejectedValueOnce({ response: { status: 400, data: { code, msg } } });
      (axios.create as jest.Mock).mockReturnValue({ get: mockGet });
      await adapter.connect(mockAccount);

      await expect(adapter.getOrder('367647', 'BTCUSDT')).rejects.toThrow(
        new RegExp(`HTTP 400.*Binance code=${code}.*${msg}`),
      );
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
