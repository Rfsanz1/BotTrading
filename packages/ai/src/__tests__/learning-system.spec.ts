import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { LearningSystem } from '../trading-brain/learning-system';

describe('LearningSystem', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'learning-system-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records prediction and outcome, and keeps a bounded model weight', () => {
    const learning = new LearningSystem(path.join(tempDir, 'learning.json'));

    learning.recordPrediction({
      decisionId: 'd1',
      provider: 'openai',
      model: 'gpt-4o',
      symbol: 'BTCUSDT',
      regime: 'TREND_UP',
      setup: 'PULLBACK',
      action: 'BUY',
      rawConfidence: 0.9,
      predictedProbability: 0.9,
    });

    learning.recordTradeResult({
      decisionId: 'd1',
      symbol: 'BTCUSDT',
      provider: 'openai',
      model: 'gpt-4o',
      regime: 'TREND_UP',
      setup: 'PULLBACK',
      outcome: 'win',
      entryPrice: 100,
      exitPrice: 110,
      realizedPnL: 10,
      realizedR: 2,
      fees: 0.12,
      slippage: 0.04,
      holdingTimeMs: 60000,
      exitReason: 'target_hit',
      decision: 'BUY',
    });

    const performance = learning.getModelPerformance('openai', 'gpt-4o', 'BTCUSDT', 'TREND_UP', 'PULLBACK');
    expect(performance).toHaveLength(1);
    expect(performance[0].prediction_count).toBe(1);
    expect(performance[0].actual_win_rate).toBe(1);

    const weight = learning.getModelWeight('openai', 'gpt-4o', 'BTCUSDT', 'TREND_UP', 'PULLBACK');
    expect(weight).toBeGreaterThan(0.08);
    expect(weight).toBeLessThanOrEqual(1.4);
  });

  it('keeps small-sample weights conservative rather than treating 2/2 as dominant', () => {
    const learning = new LearningSystem(path.join(tempDir, 'learning.json'));

    for (let index = 0; index < 2; index += 1) {
      const decisionId = `small-${index}`;
      learning.recordPrediction({
        decisionId,
        provider: 'openai',
        model: 'gpt-4o',
        symbol: 'ETHUSDT',
        regime: 'RANGE',
        setup: 'BREAKOUT',
        action: 'BUY',
        rawConfidence: 0.9,
        predictedProbability: 0.9,
      });

      learning.recordTradeResult({
        decisionId,
        symbol: 'ETHUSDT',
        provider: 'openai',
        model: 'gpt-4o',
        regime: 'RANGE',
        setup: 'BREAKOUT',
        outcome: 'win',
        entryPrice: 100,
        exitPrice: 108,
        realizedPnL: 8,
        realizedR: 1.6,
        fees: 0.1,
        slippage: 0.02,
        holdingTimeMs: 60000,
        exitReason: 'target_hit',
        decision: 'BUY',
      });
    }

    const weight = learning.getModelWeight('openai', 'gpt-4o', 'ETHUSDT', 'RANGE', 'BREAKOUT');
    expect(weight).toBeLessThan(0.8);
  });

  it('marks calibration as insufficient before enough samples exist', () => {
    const learning = new LearningSystem(path.join(tempDir, 'learning.json'));

    learning.recordPrediction({
      decisionId: 'cal-1',
      provider: 'anthropic',
      model: 'claude-3',
      symbol: 'SOLUSDT',
      regime: 'TREND_UP',
      setup: 'PULLBACK',
      action: 'BUY',
      rawConfidence: 0.7,
      predictedProbability: 0.7,
    });

    learning.recordTradeResult({
      decisionId: 'cal-1',
      symbol: 'SOLUSDT',
      provider: 'anthropic',
      model: 'claude-3',
      regime: 'TREND_UP',
      setup: 'PULLBACK',
      outcome: 'win',
      entryPrice: 80,
      exitPrice: 86,
      realizedPnL: 6,
      realizedR: 1.5,
      fees: 0.1,
      slippage: 0.03,
      holdingTimeMs: 120000,
      exitReason: 'target_hit',
      decision: 'BUY',
    });

    const calibration = learning.getConfidenceCalibration();
    expect(calibration.status).toBe('INSUFFICIENT_DATA');
  });
});
