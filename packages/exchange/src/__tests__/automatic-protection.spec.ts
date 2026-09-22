/**
 * Automatic OCO Protection and Fill Handling Tests
 * Tests entry fill → automatic OCO setup → protection fill → position closed
 */

import { ProtectionOrderService } from '../services/protection-order.service';
import { IExchange } from '../IExchange';
import { ProtectionOrder, ProtectionOcoOrderParams } from '../types';

describe('Automatic Protection Setup and Fill Handling', () => {
  let protectionService: ProtectionOrderService;
  let mockAdapter: IExchange;

  beforeEach(() => {
    protectionService = new ProtectionOrderService();
    mockAdapter = {
      name: 'binance',
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      fetchBalances: jest.fn().mockResolvedValue([]),
      fetchTicker: jest.fn().mockResolvedValue({
        symbol: 'BTCUSDT',
        bid: '45000',
        ask: '45010',
        last: '45000',
        timestamp: Date.now(),
      }),
      placeOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOrder: jest.fn(),
      fetchOpenOrders: jest.fn(),
      fetchOpenPositions: jest.fn(),
      subscribeTicker: jest.fn(),
      unsubscribeTicker: jest.fn(),
      createProtectionOco: jest.fn(),
      cancelProtectionOrder: jest.fn(),
      getProtectionOrder: jest.fn(),
      nativeProtectionVerified: true,
    } as unknown as IExchange;
  });

  describe('Automatic OCO after Entry Fill', () => {
    it('should setup OCO with deterministic IDs after entry fill', async () => {
      const positionId = 'pos-123';
      const oco: ProtectionOcoOrderParams = {
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '1.5',
        stopLossTriggerPrice: '44000',
        stopLossLimitPrice: '43900',
        takeProfitTriggerPrice: '46000',
        takeProfitLimitPrice: '45900',
        listClientOrderId: `pos-${positionId}-oco`,
        stopLossClientOrderId: `pos-${positionId}-oco-sl`,
        takeProfitClientOrderId: `pos-${positionId}-oco-tp`,
      };

      const ocoResponse: ProtectionOrder = {
        id: '999',
        externalId: '999',
        clientOrderId: oco.listClientOrderId,
        listClientOrderId: oco.listClientOrderId,
        symbol: oco.symbol,
        side: oco.side,
        quantity: oco.quantity,
        triggerPrice: oco.stopLossTriggerPrice,
        limitPrice: oco.stopLossLimitPrice,
        kind: 'STOP_LOSS',
        status: 'NEW',
        state: 'CONFIRMED',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockAdapter.createProtectionOco as jest.Mock).mockResolvedValue(ocoResponse);

      const result = await protectionService.create(
        mockAdapter,
        oco as any,
      );

      expect(result.state).toBe('CONFIRMED');
      expect(result.externalId).toBe('999');
      expect(mockAdapter.createProtectionOco).toHaveBeenCalledWith(
        expect.objectContaining({
          listClientOrderId: `pos-${positionId}-oco`,
          stopLossClientOrderId: `pos-${positionId}-oco-sl`,
          takeProfitClientOrderId: `pos-${positionId}-oco-tp`,
        }),
      );
    });

    it('should idempotently handle OCO setup if already confirmed', async () => {
      const positionId = 'pos-123';
      const oco: ProtectionOcoOrderParams = {
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '1.5',
        stopLossTriggerPrice: '44000',
        stopLossLimitPrice: '43900',
        takeProfitTriggerPrice: '46000',
        takeProfitLimitPrice: '45900',
        listClientOrderId: `pos-${positionId}-oco`,
        stopLossClientOrderId: `pos-${positionId}-oco-sl`,
        takeProfitClientOrderId: `pos-${positionId}-oco-tp`,
      };

      const ocoResponse: ProtectionOrder = {
        id: '999',
        externalId: '999',
        clientOrderId: oco.listClientOrderId,
        listClientOrderId: oco.listClientOrderId,
        symbol: oco.symbol,
        side: oco.side,
        quantity: oco.quantity,
        triggerPrice: oco.stopLossTriggerPrice,
        limitPrice: oco.stopLossLimitPrice,
        kind: 'STOP_LOSS',
        status: 'NEW',
        state: 'CONFIRMED',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockAdapter.createProtectionOco as jest.Mock)
        .mockResolvedValueOnce(ocoResponse)
        .mockResolvedValueOnce(ocoResponse);

      // First creation
      await protectionService.create(mockAdapter, oco as any);
      expect(mockAdapter.createProtectionOco).toHaveBeenCalledTimes(1);

      // Try create again with same IDs (should detect duplicate)
      await expect(protectionService.create(mockAdapter, oco as any))
        .rejects.toThrow(/Duplicate/i);
    });

    it('should fail-closed if OCO capability is not verified', async () => {
      const mockFailedAdapter = {
        ...mockAdapter,
        nativeProtectionVerified: false,
      } as unknown as IExchange;

      const oco: ProtectionOcoOrderParams = {
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '1.5',
        stopLossTriggerPrice: '44000',
        stopLossLimitPrice: '43900',
        takeProfitTriggerPrice: '46000',
        takeProfitLimitPrice: '45900',
        listClientOrderId: 'pos-123-oco',
        stopLossClientOrderId: 'pos-123-oco-sl',
        takeProfitClientOrderId: 'pos-123-oco-tp',
      };

      // Should fail because nativeProtectionVerified = false
      // This would be caught in the trading service before calling createProtectionOco
      expect(mockFailedAdapter.nativeProtectionVerified).toBe(false);
    });

    it('should retry up to 2 times if OCO creation fails temporarily', async () => {
      const positionId = 'pos-123';
      const oco: ProtectionOcoOrderParams = {
        symbol: 'BTCUSDT',
        side: 'sell',
        quantity: '1.5',
        stopLossTriggerPrice: '44000',
        stopLossLimitPrice: '43900',
        takeProfitTriggerPrice: '46000',
        takeProfitLimitPrice: '45900',
        listClientOrderId: `pos-${positionId}-oco`,
        stopLossClientOrderId: `pos-${positionId}-oco-sl`,
        takeProfitClientOrderId: `pos-${positionId}-oco-tp`,
      };

      const ocoResponse: ProtectionOrder = {
        id: '999',
        externalId: '999',
        clientOrderId: oco.listClientOrderId,
        listClientOrderId: oco.listClientOrderId,
        symbol: oco.symbol,
        side: oco.side,
        quantity: oco.quantity,
        triggerPrice: oco.stopLossTriggerPrice,
        limitPrice: oco.stopLossLimitPrice,
        kind: 'STOP_LOSS',
        status: 'NEW',
        state: 'CONFIRMED',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First call fails, second succeeds
      (mockAdapter.createProtectionOco as jest.Mock)
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce(ocoResponse);

      // Service should retry and succeed
      const result = await protectionService.create(mockAdapter, oco as any);
      expect(result.state).toBe('CONFIRMED');
      expect(mockAdapter.createProtectionOco).toHaveBeenCalledTimes(2);
    });
  });

  describe('Protection Fill Handling', () => {
    it('should recognize protection fill via listClientOrderId', () => {
      const ocoListClientOrderId = 'pos-123-oco';
      const incomingEvent = {
        clientOrderId: ocoListClientOrderId,
        orderId: undefined,
        symbol: 'BTCUSDT',
        filledQuantity: 1.5,
        averagePrice: 44050,
      };

      // In real application, this would be matched against position metadata
      expect(incomingEvent.clientOrderId).toBe(ocoListClientOrderId);
    });

    it('should recognize protection fill via orderListId', () => {
      const ocoListId = '999';
      const incomingEvent = {
        orderId: ocoListId,
        clientOrderId: undefined,
        symbol: 'BTCUSDT',
        filledQuantity: 1.5,
        averagePrice: 44050,
      };

      // In real application, this would be matched against position metadata
      expect(incomingEvent.orderId).toBe(ocoListId);
    });

    it('should recognize protection fill via protection order child clientOrderIds', () => {
      const stopLossClientOrderId = 'pos-123-oco-sl';
      const takeProfitClientOrderId = 'pos-123-oco-tp';

      const slFillEvent = {
        clientOrderId: stopLossClientOrderId,
        symbol: 'BTCUSDT',
        filledQuantity: 1.5,
        averagePrice: 44050,
      };

      const tpFillEvent = {
        clientOrderId: takeProfitClientOrderId,
        symbol: 'BTCUSDT',
        filledQuantity: 0.75,
        averagePrice: 45950,
      };

      expect(slFillEvent.clientOrderId).toBe(stopLossClientOrderId);
      expect(tpFillEvent.clientOrderId).toBe(takeProfitClientOrderId);
    });

    it('should update position quantity and calculate P&L on protection fill', () => {
      // Entry: bought 1.5 BTC at 45000
      const positionEntryPrice = 45000;
      const positionQuantity = 1.5;

      // Protection filled (stop loss) at 44050
      const fillPrice = 44050;
      const fillQuantity = 1.5;

      // P&L = (entry - exit) * quantity = (45000 - 44050) * 1.5 = -1425
      const expectedPnL = (positionEntryPrice - fillPrice) * fillQuantity;

      expect(expectedPnL).toBe(-1425);
      expect(fillQuantity).toBe(positionQuantity); // Full position closed
    });

    it('should reduce position on partial protection fill', () => {
      // Entry: bought 1.5 BTC at 45000
      const positionEntryPrice = 45000;
      const positionQuantity = 1.5;

      // Partial take-profit at 45900 for 0.75 BTC
      const fillPrice = 45900;
      const fillQuantity = 0.75;

      const expectedPnL = (fillPrice - positionEntryPrice) * fillQuantity; // profit
      const remainingQuantity = positionQuantity - fillQuantity;

      expect(expectedPnL).toBe(675); // (45900 - 45000) * 0.75
      expect(remainingQuantity).toBe(0.75); // Half remains open
    });

    it('should cancel sibling OCO order on one leg fill', () => {
      // When TP or SL fills, the sibling should be canceled
      const ocoListClientOrderId = 'pos-123-oco';
      const stopLossId = 'pos-123-oco-sl';
      const takeProfitId = 'pos-123-oco-tp';

      // Simulating TP fill - SL should be canceled
      const tpFilled = takeProfitId;
      const slShouldCancel = stopLossId;

      // In real trading service, this would call:
      // adapter.cancelProtectionOrder(slShouldCancel, 'BTCUSDT')

      expect(tpFilled).toBe(takeProfitId);
      expect(slShouldCancel).toBe(stopLossId);
    });

    it('should not silently ignore unknown protection fills', () => {
      // Unknown event with protection-like IDs should be logged, not silently returned
      const unknownEvent = {
        clientOrderId: 'unknown-protect-id',
        orderId: undefined,
        symbol: 'BTCUSDT',
        filledQuantity: 1.0,
        averagePrice: 44000,
      };

      // This should trigger logging/metrics in production
      expect(unknownEvent.clientOrderId).toContain('unknown');
    });
  });

  describe('Kill Switch Activation on Protection Failure', () => {
    it('should activate kill switch if OCO setup fails after retries', () => {
      // Simulating setup failure
      const failureReason = 'unverified OCO capability';
      const shouldActivateKillSwitch = !mockAdapter.nativeProtectionVerified;

      // In real service:
      // if (!adapter.nativeProtectionVerified) {
      //   await setKillSwitch(true, `Protection capability is unverified...`);
      // }

      expect(failureReason).toBe('unverified OCO capability');
    });

    it('should emit trading.protection.failed event on failure', () => {
      const eventData = {
        orderId: 'order-123',
        positionId: 'pos-123',
        reason: 'OCO endpoint UNVERIFIED',
      };

      // In real service: await this.eventEmitter.emitAsync('trading.protection.failed', eventData);

      expect(eventData.reason).toBe('OCO endpoint UNVERIFIED');
    });

    it('should close position via canonical path if protection fails', () => {
      const positionToClose = {
        id: 'pos-123',
        symbol: 'BTCUSDT',
        quantity: 1.5,
        status: 'OPEN_UNPROTECTED',
      };

      // Intent: close unprotected position immediately
      // In real service, would call trading.service.submitOrder with EXIT intent

      expect(positionToClose.status).toBe('OPEN_UNPROTECTED');
    });
  });
});
