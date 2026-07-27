import {
  CombinedStrategySignal,
  MarketBar,
  OptimizationResult,
  StrategyAction,
  StrategyEvaluation,
  StrategyInput,
  StrategyParameter,
  StrategySignal,
  StrategyTemplate,
  BacktestReport,
  BacktestTrade,
} from './types';

export class StrategyEngine {
  private templates: Map<string, StrategyTemplate> = new Map();
  private customStrategies: Map<string, StrategyTemplate> = new Map();

  constructor() {
    this.loadDefaultTemplates();
  }

  registerTemplate(template: StrategyTemplate): void {
    this.templates.set(template.id, template);
  }

  registerCustomStrategy(strategy: StrategyTemplate): void {
    strategy.createdAt = Date.now();
    strategy.updatedAt = Date.now();
    this.customStrategies.set(strategy.id, strategy);
  }

  getTemplate(id: string): StrategyTemplate | undefined {
    return this.templates.get(id) ?? this.customStrategies.get(id);
  }

  listTemplates(): StrategyTemplate[] {
    return Array.from(this.templates.values()).concat(Array.from(this.customStrategies.values()));
  }

  evaluateStrategy(template: StrategyTemplate, input: StrategyInput): StrategyEvaluation {
    const parameters = this.resolveParameters(template.parameters);
    const signals = template.rules.map((rule) => this.evaluateRule(rule, input, parameters));
    const buyScore = signals.filter((s) => s.action === 'BUY').reduce((acc, s) => acc + s.score * s.weight, 0);
    const sellScore = signals.filter((s) => s.action === 'SELL').reduce((acc, s) => acc + s.score * s.weight, 0);
    const holdScore = signals.filter((s) => s.action === 'HOLD').reduce((acc, s) => acc + s.score * s.weight, 0);

    const total = Math.max(buyScore + sellScore + holdScore, 1e-6);
    const normalizedBuy = buyScore / total;
    const normalizedSell = sellScore / total;
    const normalizedHold = holdScore / total;

    const action = this.resolveAction({ buy: normalizedBuy, sell: normalizedSell, hold: normalizedHold });
    const confidence = Math.min(1, 0.4 + Math.abs(normalizedBuy - normalizedSell) * 0.6);
    const reasons = signals.filter((s) => s.score > 0).map((s) => s.reason);

    return {
      action,
      score: Math.max(normalizedBuy, normalizedSell, normalizedHold),
      buyScore: normalizedBuy,
      sellScore: normalizedSell,
      holdScore: normalizedHold,
      confidence,
      reasons,
      strategyId: template.id,
      templateId: template.id,
    };
  }

  composeStrategies(templates: StrategyTemplate[], input: StrategyInput): CombinedStrategySignal {
    const signals = templates.map((template) => {
      const evaluation = this.evaluateStrategy(template, input);
      return {
        strategyId: template.id,
        action: evaluation.action,
        score: evaluation.score,
        reasons: evaluation.reasons,
        confidence: evaluation.confidence,
      } satisfies StrategySignal;
    });

    const totalWeight = signals.reduce((acc, signal) => acc + signal.score * 0.7 + signal.confidence * 0.3, 0);
    const buyScore = signals.filter((s) => s.action === 'BUY').reduce((acc, s) => acc + (s.score * 0.7 + s.confidence * 0.3), 0);
    const sellScore = signals.filter((s) => s.action === 'SELL').reduce((acc, s) => acc + (s.score * 0.7 + s.confidence * 0.3), 0);
    const holdScore = signals.filter((s) => s.action === 'HOLD').reduce((acc, s) => acc + (s.score * 0.7 + s.confidence * 0.3), 0);

    const normalizedBuy = buyScore / Math.max(totalWeight, 1e-6);
    const normalizedSell = sellScore / Math.max(totalWeight, 1e-6);
    const normalizedHold = holdScore / Math.max(totalWeight, 1e-6);
    const action = this.resolveAction({ buy: normalizedBuy, sell: normalizedSell, hold: normalizedHold });

    return {
      action,
      score: Math.max(normalizedBuy, normalizedSell, normalizedHold),
      buyScore: normalizedBuy,
      sellScore: normalizedSell,
      holdScore: normalizedHold,
      confidence: Math.min(1, 0.4 + Math.abs(normalizedBuy - normalizedSell) * 0.6),
      signals,
      reasons: signals.flatMap((signal) => signal.reasons),
    };
  }

  backtest(strategy: StrategyTemplate, history: MarketBar[]): BacktestReport {
    const trades: BacktestTrade[] = [];
    let equity = 10000;
    let peak = equity;
    let maxDrawdown = 0;
    let returns: number[] = [];

    for (let index = 0; index < history.length - 1; index += 1) {
      const bar = history[index];
      const nextBar = history[index + 1];
      const input = this.buildInputFromBar(bar);
      const evaluation = this.evaluateStrategy(strategy, input);
      const nextReturn = (nextBar.close - bar.close) / bar.close;

      if (evaluation.action === 'BUY') {
        const pnlPercent = nextReturn;
        const pnl = equity * pnlPercent;
        equity += pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
        returns.push(pnlPercent);
        trades.push({ entryTimestamp: bar.timestamp, exitTimestamp: nextBar.timestamp, action: 'BUY', entryPrice: bar.close, exitPrice: nextBar.close, pnlPercent });
      } else if (evaluation.action === 'SELL') {
        const pnlPercent = -nextReturn;
        const pnl = equity * pnlPercent;
        equity += pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
        returns.push(pnlPercent);
        trades.push({ entryTimestamp: bar.timestamp, exitTimestamp: nextBar.timestamp, action: 'SELL', entryPrice: bar.close, exitPrice: nextBar.close, pnlPercent });
      }
    }

    const profitable = trades.filter((trade) => trade.pnlPercent > 0);
    const avgTradeReturn = returns.reduce((acc, value) => acc + value, 0) / Math.max(returns.length, 1);
    const totalReturn = (equity - 10000) / 10000;
    const totalPositive = profitable.reduce((acc, trade) => acc + trade.pnlPercent, 0);
    const totalNegative = Math.abs(trades.filter((trade) => trade.pnlPercent < 0).reduce((acc, trade) => acc + trade.pnlPercent, 0));
    const profitFactor = totalNegative > 0 ? totalPositive / totalNegative : totalPositive;
    const mean = returns.reduce((acc, value) => acc + value, 0) / Math.max(returns.length, 1);
    const variance = returns.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / Math.max(returns.length, 1);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? mean / stdDev : mean;

    return {
      strategyId: strategy.id,
      totalTrades: trades.length,
      winRate: trades.length > 0 ? profitable.length / trades.length : 0,
      avgTradeReturn,
      totalReturn,
      maxDrawdown,
      profitFactor,
      sharpeRatio,
      trades,
    };
  }

  optimize(strategy: StrategyTemplate, history: MarketBar[]): OptimizationResult {
    const parameterCandidates = this.generateParameterCandidates(strategy.parameters);
    const options = parameterCandidates.map((parameters) => {
      const candidate = this.cloneStrategy(strategy, parameters);
      return { parameters, report: this.backtest(candidate, history) };
    });

    const best = options.reduce((bestOption, current) => {
      const currentScore = current.report.sharpeRatio + current.report.totalReturn + current.report.winRate;
      const bestScore = bestOption.report.sharpeRatio + bestOption.report.totalReturn + bestOption.report.winRate;
      return currentScore > bestScore ? current : bestOption;
    }, options[0] ?? { parameters: {}, report: this.backtest(strategy, history) });

    return {
      strategyId: strategy.id,
      parameters: best.parameters,
      report: best.report,
    };
  }

  private loadDefaultTemplates(): void {
    const builtInTemplates: StrategyTemplate[] = [
      {
        id: 'ema-crossover',
        name: 'EMA Crossover',
        description: 'Trade trend changes using EMA crossovers.',
        indicators: ['EMA'],
        rules: [
          { condition: 'EMA_SHORT > EMA_LONG', action: 'BUY', weight: 0.7 },
          { condition: 'EMA_SHORT < EMA_LONG', action: 'SELL', weight: 0.7 },
        ],
        parameters: [
          { name: 'EMA_SHORT', value: 9, type: 'number', min: 5, max: 21, description: 'Short EMA period' },
          { name: 'EMA_LONG', value: 21, type: 'number', min: 10, max: 50, description: 'Long EMA period' },
        ],
        riskManagement: [
          { type: 'stop_loss', threshold: 0.02, action: 'Use a 2% stop loss' },
          { type: 'take_profit', threshold: 0.04, action: 'Use a 4% take profit' },
        ],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'rsi-extremes',
        name: 'RSI Extremes',
        description: 'Trade overbought and oversold RSI conditions.',
        indicators: ['RSI'],
        rules: [
          { condition: 'RSI < 30', action: 'BUY', weight: 0.6 },
          { condition: 'RSI > 70', action: 'SELL', weight: 0.6 },
        ],
        parameters: [
          { name: 'RSI_PERIOD', value: 14, type: 'number', min: 7, max: 21, description: 'RSI lookback period' },
        ],
        riskManagement: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'macd-trend',
        name: 'MACD Trend',
        description: 'Trade MACD line and signal crossover.',
        indicators: ['MACD'],
        rules: [
          { condition: 'MACD_LINE > MACD_SIGNAL', action: 'BUY', weight: 0.7 },
          { condition: 'MACD_LINE < MACD_SIGNAL', action: 'SELL', weight: 0.7 },
        ],
        parameters: [
          { name: 'FAST_PERIOD', value: 12, type: 'number', min: 8, max: 20, description: 'Fast MACD period' },
          { name: 'SLOW_PERIOD', value: 26, type: 'number', min: 18, max: 34, description: 'Slow MACD period' },
        ],
        riskManagement: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'smart-money',
        name: 'Smart Money Concept',
        description: 'Trade on SMC structure, order blocks and fair value gaps.',
        indicators: ['Smart Money Concept', 'ICT', 'Order Blocks', 'Fair Value Gap'],
        rules: [
          { condition: 'SMC_ORDER_BLOCK', action: 'BUY', weight: 0.6 },
          { condition: 'SMC_FVG', action: 'BUY', weight: 0.6 },
          { condition: 'SMC_LIQUIDITY_SWEEP', action: 'SELL', weight: 0.6 },
          { condition: 'ICT_BREAKER_BLOCK', action: 'SELL', weight: 0.5 },
        ],
        parameters: [],
        riskManagement: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'volume-profile',
        name: 'Volume Profile',
        description: 'Trade on volume profile bias and price acceptance zones.',
        indicators: ['Volume Profile', 'Price Action'],
        rules: [
          { condition: 'VOLUME_PROFILE_BIAS = BUY', action: 'BUY', weight: 0.6 },
          { condition: 'VOLUME_PROFILE_BIAS = SELL', action: 'SELL', weight: 0.6 },
          { condition: 'PRICE_ACTION_BREAKOUT', action: 'BUY', weight: 0.5 },
        ],
        parameters: [],
        riskManagement: [],
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    builtInTemplates.forEach((template) => this.registerTemplate(template));
  }

  private evaluateRule(rule: { condition: string; action: StrategyAction; weight: number }, input: StrategyInput, parameters: Record<string, number | string | boolean>) {
    const condition = rule.condition.toUpperCase();
    let score = 0;
    let reason = rule.condition;

    if (condition.includes('EMA_SHORT > EMA_LONG')) {
      const short = parameters.EMA_SHORT as number; const long = parameters.EMA_LONG as number;
      const shortValue = input.ema?.short ?? 0; const longValue = input.ema?.long ?? 0;
      score = shortValue > longValue ? 1 : 0;
      reason = `EMA ${shortValue.toFixed(2)} vs ${longValue.toFixed(2)}`;
    } else if (condition.includes('EMA_SHORT < EMA_LONG')) {
      const shortValue = input.ema?.short ?? 0; const longValue = input.ema?.long ?? 0;
      score = shortValue < longValue ? 1 : 0;
      reason = `EMA ${shortValue.toFixed(2)} vs ${longValue.toFixed(2)}`;
    } else if (condition.includes('RSI < 30')) {
      const rsi = input.rsi ?? 50;
      score = rsi < 30 ? 1 : 0;
      reason = `RSI ${rsi.toFixed(1)}`;
    } else if (condition.includes('RSI > 70')) {
      const rsi = input.rsi ?? 50;
      score = rsi > 70 ? 1 : 0;
      reason = `RSI ${rsi.toFixed(1)}`;
    } else if (condition.includes('MACD_LINE > MACD_SIGNAL')) {
      const line = input.macd?.line ?? 0; const signal = input.macd?.signal ?? 0;
      score = line > signal ? 1 : 0;
      reason = `MACD ${line.toFixed(2)} > ${signal.toFixed(2)}`;
    } else if (condition.includes('MACD_LINE < MACD_SIGNAL')) {
      const line = input.macd?.line ?? 0; const signal = input.macd?.signal ?? 0;
      score = line < signal ? 1 : 0;
      reason = `MACD ${line.toFixed(2)} < ${signal.toFixed(2)}`;
    } else if (condition.includes('SMC_ORDER_BLOCK')) {
      score = input.smc?.orderBlock ? 1 : 0;
      reason = input.smc?.orderBlock ? 'Order block is active' : 'No order block';
    } else if (condition.includes('SMC_FVG')) {
      score = input.smc?.fairValueGap ? 1 : 0;
      reason = input.smc?.fairValueGap ? 'Fair value gap detected' : 'No fair value gap';
    } else if (condition.includes('SMC_LIQUIDITY_SWEEP')) {
      score = input.smc?.liquiditySweep ? 1 : 0;
      reason = input.smc?.liquiditySweep ? 'Liquidity sweep observed' : 'No liquidity sweep';
    } else if (condition.includes('ICT_BREAKER_BLOCK')) {
      score = input.ict?.breakerBlock ? 1 : 0;
      reason = input.ict?.breakerBlock ? 'Breaker block active' : 'No breaker block';
    } else if (condition.includes('VOLUME_PROFILE_BIAS = BUY')) {
      score = input.volumeProfile?.bias === 'buy' ? 1 : 0;
      reason = input.volumeProfile?.bias === 'buy' ? 'Volume profile supports buying' : 'Volume profile is neutral or bearish';
    } else if (condition.includes('VOLUME_PROFILE_BIAS = SELL')) {
      score = input.volumeProfile?.bias === 'sell' ? 1 : 0;
      reason = input.volumeProfile?.bias === 'sell' ? 'Volume profile supports selling' : 'Volume profile is neutral or bullish';
    } else if (condition.includes('PRICE_ACTION_BREAKOUT')) {
      score = input.priceAction?.breakout ? 1 : 0;
      reason = input.priceAction?.breakout ? 'Price action breakout detected' : 'No breakout';
    } else if (condition.includes('PRICE > VWAP')) {
      const price = input.price; const vwap = input.vwap ?? 0;
      score = price > vwap ? 1 : 0;
      reason = `Price ${price.toFixed(2)} > VWAP ${vwap.toFixed(2)}`;
    } else if (condition.includes('PRICE < VWAP')) {
      const price = input.price; const vwap = input.vwap ?? 0;
      score = price < vwap ? 1 : 0;
      reason = `Price ${price.toFixed(2)} < VWAP ${vwap.toFixed(2)}`;
    } else if (condition.includes('ADX >')) {
      const adx = input.adx ?? 0;
      score = adx > 25 ? 1 : 0;
      reason = `ADX ${adx.toFixed(1)}`;
    } else if (condition.includes('SUPERTREND_DIRECTION = UP')) {
      score = input.superTrend?.direction === 'up' ? 1 : 0;
      reason = input.superTrend?.direction === 'up' ? 'SuperTrend bullish' : 'SuperTrend not bullish';
    } else if (condition.includes('SUPERTREND_DIRECTION = DOWN')) {
      score = input.superTrend?.direction === 'down' ? 1 : 0;
      reason = input.superTrend?.direction === 'down' ? 'SuperTrend bearish' : 'SuperTrend not bearish';
    } else if (condition.includes('PRICE > BOLLINGER_UPPER')) {
      const upper = input.bollinger?.upper ?? input.price; const price = input.price;
      score = price > upper ? 1 : 0;
      reason = `Price ${price.toFixed(2)} > upper band ${upper.toFixed(2)}`;
    } else {
      score = 0;
      reason = `Condition not recognized: ${rule.condition}`;
    }

    return { score, action: rule.action, weight: rule.weight, reason };
  }

  private resolveAction(scores: { buy: number; sell: number; hold: number }): StrategyAction {
    const max = Math.max(scores.buy, scores.sell, scores.hold);
    if (max === scores.buy && scores.buy >= scores.sell && scores.buy >= scores.hold) return 'BUY';
    if (max === scores.sell && scores.sell >= scores.buy && scores.sell >= scores.hold) return 'SELL';
    return 'HOLD';
  }

  private resolveParameters(parameters: StrategyParameter[]): Record<string, number | string | boolean> {
    return Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.value]));
  }

  private buildInputFromBar(bar: MarketBar): StrategyInput {
    const indicators = bar.indicators || {};
    return {
      symbol: indicators.symbol || 'UNKNOWN',
      price: bar.close,
      previousClose: indicators.previousClose ?? bar.open,
      ema: indicators.ema,
      sma: indicators.sma,
      vwap: indicators.vwap,
      macd: indicators.macd,
      rsi: indicators.rsi,
      bollinger: indicators.bollinger,
      atr: indicators.atr,
      adx: indicators.adx,
      ichimoku: indicators.ichimoku,
      superTrend: indicators.superTrend,
      smc: indicators.smc,
      ict: indicators.ict,
      wyckoff: indicators.wyckoff,
      priceAction: indicators.priceAction,
      volumeProfile: indicators.volumeProfile,
      orderBlocks: indicators.orderBlocks,
      fairValueGap: indicators.fairValueGap,
      liquiditySweep: indicators.liquiditySweep,
      breakerBlock: indicators.breakerBlock,
      mitigationBlock: indicators.mitigationBlock,
      volume: bar.volume,
      volumeAverage: indicators.volumeAverage,
      volatility: indicators.volatility,
      marketBias: indicators.marketBias,
      custom: indicators.custom,
    };
  }

  private generateParameterCandidates(parameters: StrategyParameter[]) {
    return parameters.length === 0
      ? [{}]
      : parameters.reduce<Record<string, number | string | boolean>[]>((accumulator, parameter) => {
          const values = this.expandParameter(parameter);
          const next = accumulator.flatMap((previous) => values.map((value) => ({ ...previous, [parameter.name]: value })));
          return next;
        }, [{}]);
  }

  private expandParameter(parameter: StrategyParameter): Array<number | string | boolean> {
    if (parameter.type === 'boolean') {
      return [true, false];
    }

    if (parameter.type === 'string') {
      return [parameter.value];
    }

    const min = typeof parameter.min === 'number' ? parameter.min : Number(parameter.value);
    const max = typeof parameter.max === 'number' ? parameter.max : Number(parameter.value);
    const step = Math.max((max - min) / 4, 1);
    const values = [] as Array<number | string | boolean>;
    for (let value = min; value <= max; value += step) {
      values.push(Math.round(value * 10) / 10);
    }
    values.push(Number(parameter.value));
    return Array.from(new Set(values));
  }

  private cloneStrategy(strategy: StrategyTemplate, parameters: Record<string, number | string | boolean>): StrategyTemplate {
    const clonedParameters = strategy.parameters.map((parameter) => ({
      ...parameter,
      value: parameters[parameter.name] ?? parameter.value,
    }));
    return {
      ...strategy,
      parameters: clonedParameters,
    };
  }
}

export default StrategyEngine;
