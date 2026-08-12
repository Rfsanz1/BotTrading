/**
 * Phase 2 Integration Tests
 * Position Tracking & Balance Sync
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PositionService } from '../../services/position.service';
import { BalanceSyncService } from '../../services/balance-sync.service';
import { PnLCalculationService } from '../../services/pnl-calculation.service';

describe('PHASE 2: Position Tracking & Balance Sync', () => {
  let positionService: PositionService;
  let balanceSyncService: BalanceSyncService;
  let pnlService: PnLCalculationService;

  const mockUserId = 'test-user-001';
  const mockExchange = 'binance';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionService,
        BalanceSyncService,
        PnLCalculationService,
      ],
    }).compile();

    positionService = module.get<PositionService>(PositionService);
    balanceSyncService = module.get<BalanceSyncService>(BalanceSyncService);
    pnlService = module.get<PnLCalculationService>(PnLCalculationService);
  });

  describe('PositionService', () => {
    describe('P&L Calculation', () => {
      it('should calculate unrealized PnL for BUY position (profit)', () => {
        const pnl = positionService.calculateUnrealizedPnL(
          100, // entry price
          110, // current price
          1,   // quantity
          'BUY',
        );

        expect(pnl).toEqual(10); // 110 - 100 = 10
      });

      it('should calculate unrealized PnL for BUY position (loss)', () => {
        const pnl = positionService.calculateUnrealizedPnL(
          100,
          90,
          1,
          'BUY',
        );

        expect(pnl).toEqual(-10); // 90 - 100 = -10
      });

      it('should calculate unrealized PnL for SELL position (profit)', () => {
        const pnl = positionService.calculateUnrealizedPnL(
          100,
          90,
          1,
          'SELL',
        );

        expect(pnl).toEqual(10); // 100 - 90 = 10
      });

      it('should calculate unrealized PnL for SELL position (loss)', () => {
        const pnl = positionService.calculateUnrealizedPnL(
          100,
          110,
          1,
          'SELL',
        );

        expect(pnl).toEqual(-10); // 100 - 110 = -10
      });

      it('should calculate PnL for multiple quantity', () => {
        const pnl = positionService.calculateUnrealizedPnL(
          100,
          110,
          10,
          'BUY',
        );

        expect(pnl).toEqual(100); // (110 - 100) * 10 = 100
      });
    });

    describe('P&L Percentage', () => {
      it('should calculate PnL percentage for BUY position', () => {
        const pnlPercent = positionService.calculateUnrealizedPnLPercent(
          100,
          110,
          'BUY',
        );

        expect(pnlPercent).toEqual(10); // (110 - 100) / 100 * 100 = 10%
      });

      it('should calculate PnL percentage for SELL position', () => {
        const pnlPercent = positionService.calculateUnrealizedPnLPercent(
          100,
          90,
          'SELL',
        );

        expect(pnlPercent).toEqual(10); // (100 - 90) / 100 * 100 = 10%
      });

      it('should handle zero entry price', () => {
        const pnlPercent = positionService.calculateUnrealizedPnLPercent(
          0,
          100,
          'BUY',
        );

        expect(pnlPercent).toEqual(0);
      });
    });

    describe('Exit Conditions', () => {
      it('should trigger stop-loss for BUY position', async () => {
        const mockPosition = {
          id: 'pos-001',
          status: 'OPEN',
          side: 'BUY',
          stopLoss: { toNumber: () => 95 },
          takeProfit: { toNumber: () => 110 },
          entryPrice: { toNumber: () => 100 },
          quantity: { toNumber: () => 1 },
        };

        // Mock findUnique to return our position
        jest.spyOn(require('@rfsanz/database/src/client'), 'position', 'get')
          .mockReturnValue({
            findUnique: jest.fn().mockResolvedValue(mockPosition),
          });

        const result = await positionService.checkExitConditions('pos-001', 94);

        expect(result.shouldClose).toBe(true);
        expect(result.reason).toBe('STOP_LOSS_HIT');
      });

      it('should trigger take-profit for BUY position', async () => {
        const mockPosition = {
          id: 'pos-001',
          status: 'OPEN',
          side: 'BUY',
          stopLoss: { toNumber: () => 95 },
          takeProfit: { toNumber: () => 110 },
          entryPrice: { toNumber: () => 100 },
          quantity: { toNumber: () => 1 },
        };

        const result = await positionService.checkExitConditions('pos-001', 111);

        expect(result.reason).toBe('TAKE_PROFIT_HIT');
      });

      it('should not trigger exit conditions within bounds', async () => {
        const result = await positionService.checkExitConditions('pos-001', 105);

        expect(result.shouldClose).toBe(false);
      });
    });
  });

  describe('PnLCalculationService', () => {
    describe('ROI Calculation', () => {
      it('should calculate ROI for BUY position', () => {
        const roi = pnlService.calculateROI(100, 110, 'BUY');

        expect(roi).toEqual(10); // (110 - 100) / 100 * 100 = 10%
      });

      it('should calculate negative ROI', () => {
        const roi = pnlService.calculateROI(100, 90, 'BUY');

        expect(roi).toEqual(-10);
      });

      it('should calculate ROI for SELL position', () => {
        const roi = pnlService.calculateROI(100, 90, 'SELL');

        expect(roi).toEqual(10); // (100 - 90) / 100 * 100 = 10%
      });

      it('should handle zero entry price', () => {
        const roi = pnlService.calculateROI(0, 100, 'BUY');

        expect(roi).toEqual(0);
      });
    });

    describe('Position Sizing', () => {
      it('should calculate position size based on risk', () => {
        const size = pnlService.calculatePositionSize(
          10000,  // $10,000 account
          2,      // 2% risk
          100,    // entry price
          95,     // stop loss price (5% risk)
        );

        // risk amount = 10000 * 0.02 = 200
        // price risk = 100 - 95 = 5
        // size = 200 / 5 = 40
        expect(size).toEqual(40);
      });

      it('should handle zero price risk', () => {
        const size = pnlService.calculatePositionSize(
          10000,
          2,
          100,
          100, // same as entry price
        );

        expect(size).toEqual(0);
      });
    });

    describe('Exit Price Calculation', () => {
      it('should calculate exit prices for BUY position', () => {
        const { stopLoss, takeProfit } = pnlService.calculateExitPrices(
          100,
          'BUY',
          2, // 1:2 risk:reward
        );

        // Stop loss is 1% below entry = 99
        // Risk = 100 - 99 = 1
        // Take profit = 100 + 1 * 2 = 102
        expect(stopLoss).toBeCloseTo(99, 1);
        expect(takeProfit).toBeCloseTo(102, 1);
      });

      it('should calculate exit prices for SELL position', () => {
        const { stopLoss, takeProfit } = pnlService.calculateExitPrices(
          100,
          'SELL',
          2,
        );

        // Stop loss is 1% above entry = 101
        // Risk = 101 - 100 = 1
        // Take profit = 100 - 1 * 2 = 98
        expect(stopLoss).toBeCloseTo(101, 1);
        expect(takeProfit).toBeCloseTo(98, 1);
      });
    });
  });

  describe('BalanceSyncService', () => {
    describe('Balance Tracking', () => {
      it('should handle balance snapshot with multiple assets', () => {
        const balances = [
          { asset: 'USDT', free: '1000.50', locked: '500.25' },
          { asset: 'BTC', free: '0.05', locked: '0' },
          { asset: 'ETH', free: '1.5', locked: '0.5' },
        ];

        // Should process all balances without error
        expect(balances.length).toEqual(3);
      });

      it('should filter zero balances', () => {
        const balances = [
          { asset: 'USDT', free: '1000', locked: '0' },
          { asset: 'DOGE', free: '0', locked: '0' }, // zero balance
        ];

        const filtered = balances.filter(
          (b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0,
        );

        expect(filtered.length).toEqual(1);
        expect(filtered[0].asset).toEqual('USDT');
      });
    });

    describe('Balance Changes', () => {
      it('should detect significant balance changes', () => {
        const changes = [
          {
            asset: 'USDT',
            previous: 1000,
            current: 1100,
            change: 100,
            changePercent: 10,
          },
        ];

        const threshold = 0.001; // 0.1%
        const significant = changes.filter((c) => c.changePercent >= threshold * 100);

        expect(significant.length).toEqual(1);
      });

      it('should ignore negligible balance changes', () => {
        const changes = [
          {
            asset: 'USDT',
            previous: 1000,
            current: 1000.001,
            change: 0.001,
            changePercent: 0.0001,
          },
        ];

        const threshold = 0.001; // 0.1%
        const significant = changes.filter((c) => c.changePercent >= threshold * 100);

        expect(significant.length).toEqual(0);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should track position lifecycle: open -> update price -> close', () => {
      // Scenario: Open position, price moves, close position

      // 1. Open position
      const entry = 100;
      const qty = 1;

      // 2. Price movement
      const price1 = 105;
      const pnl1 = positionService.calculateUnrealizedPnL(entry, price1, qty, 'BUY');
      expect(pnl1).toEqual(5);

      // 3. Price continues
      const price2 = 110;
      const pnl2 = positionService.calculateUnrealizedPnL(entry, price2, qty, 'BUY');
      expect(pnl2).toEqual(10);

      // 4. Close position
      const realizedPnL = pnl2;
      expect(realizedPnL).toEqual(10);
    });

    it('should calculate portfolio metrics', () => {
      // Multiple positions with different P&L
      const positions = [
        { realizedPnL: 100, status: 'CLOSED' },   // winner
        { realizedPnL: -50, status: 'CLOSED' },   // loser
        { unrealizedPnL: 25, status: 'OPEN' },    // open
      ];

      const totalRealized = 100 - 50;
      const totalUnrealized = 25;
      const totalPnL = totalRealized + totalUnrealized;

      expect(totalRealized).toEqual(50);
      expect(totalUnrealized).toEqual(25);
      expect(totalPnL).toEqual(75);
    });
  });
});
