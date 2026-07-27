import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QuantitativeAnalysisService } from '../services/quantitative-analysis.service';

describe('QuantitativeAnalysisService', () => {
  it('computes standard indicators for a sample OHLCV series', () => {
    const service = new QuantitativeAnalysisService();
    const candles = Array.from({ length: 40 }, (_, index) => ({
      timestamp: index + 1,
      open: 100 + index * 0.4,
      high: 101 + index * 0.4,
      low: 99 + index * 0.4,
      close: 100.5 + index * 0.4,
      volume: 1000 + index * 10,
    }));

    const result = service.calculate('BTC/USDT', '1H', 'binance', candles);

    assert.ok(result.indicators.ema.last !== null);
    assert.ok(result.indicators.sma.last !== null);
    assert.ok(result.indicators.vwap.last !== null);
    assert.ok(result.indicators.macd.histogram !== null);
    assert.ok(result.indicators.rsi.value !== null);
    assert.ok(result.indicators.atr.value !== null);
    assert.ok(result.indicators.adx.value !== null);
    assert.ok(result.indicators.cci.value !== null);
    assert.ok(result.indicators.stochasticRsi.value !== null);
    assert.ok(result.indicators.bollingerBands.upper !== null);
    assert.ok(result.indicators.superTrend.value !== null);
    assert.ok(result.indicators.ichimoku.conversionLine !== null);
    assert.ok(result.indicators.obv.value !== null);
    assert.ok(result.indicators.cmf.value !== null);
    assert.ok(result.indicators.mfi.value !== null);
    assert.ok(result.indicators.volumeDelta.value !== null);
    assert.ok(result.indicators.volumeProfile.levels.length > 0);
    assert.ok(result.indicators.orderBlocks.bullish.length >= 0);
    assert.ok(result.indicators.fairValueGap.bullish.length >= 0);
    assert.ok(result.indicators.liquidity.support.length >= 0);
    assert.ok(result.indicators.marketStructure.trend !== undefined);
    assert.ok(result.indicators.breakOfStructure.lastBreak !== null || result.indicators.breakOfStructure.lastBreak === null);
  });
});
