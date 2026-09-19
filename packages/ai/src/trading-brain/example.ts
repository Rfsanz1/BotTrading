import { AITradingBrain } from './trading-brain';

async function runExample() {
  const brain = new AITradingBrain({ providers: ['openai'], useConsensus: false });

  const input = {
    symbol: 'BTC/USD',
    portfolio: {
      symbol: 'BTC',
      currentWeight: 0.25,
      maxAllowedWeight: 0.5,
      correlationWithPortfolio: 0.1,
      concentrationRisk: 0.2,
      diversificationScore: 0.75,
    },
    technical: {
      rsi: 58,
      macd: { line: 0.002, signal: 0.0015, histogram: 0.0005 },
      movingAverages: { ma20: 42000, ma50: 41500, ma200: 40000 },
      bollingerBands: { upper: 42500, middle: 42000, lower: 41500 },
      atr: 120,
      stochastic: { k: 65, d: 60 },
      obv: 1234567,
      adx: 28,
      trend: 'bullish',
      strength: 0.7,
      signals: ['MA20>MA50', 'MACD positive']
    },
    newsSentiment: {
      symbol: 'BTC',
      sentiment: 'positive',
      score: 0.45,
      sources: [{ source: 'ExampleNews', sentiment: 'positive', score: 0.5, headline: 'Example headline', timestamp: Date.now() }],
      overallScore: 0.45,
      trend: 'improving',
      impact: 'medium'
    },
    marketStructure: {
      trend: 'uptrend',
      support: [41000, 40000],
      resistance: [43000, 44000],
      pattern: 'channel',
      strength: 0.7,
      signals: ['channel breakout watch']
    },
    volume: {
      volume24h: 100000,
      volumeChange: 0.12,
      volumeTrend: 'increasing',
      onBalanceVolume: 2345678,
      priceVolumeCorrelation: 0.8,
      signals: ['bullish volume']
    },
    liquidity: {
      bidAskSpread: 5,
      spreadPercentage: 0.01,
      liquidityScore: 0.9,
      impact: 'low',
      signals: ['tight spread']
    },
    orderFlow: {
      buyVolume: 60000,
      sellVolume: 40000,
      buyPressure: 0.6,
      sellPressure: 0.4,
      netFlow: 20000,
      flowTrend: 'buy',
      accumulation: 'up',
      signals: ['buy pressure']
    },
    historical: {
      symbol: 'BTC',
      period: '1d',
      return: 3.2,
      volatility: 0.04,
      maxDrawdown: 0.08,
      sharpeRatio: 1.2,
      winRate: 0.55,
      signals: []
    },
    openPositions: [],
    risk: {
      overallRisk: 'medium',
      riskScore: 0.4,
      var95: 0.05,
      maxDrawdown: 0.12,
      portfolioHeat: 0.3,
      concentration: 0.2,
      correlationRisk: 0.15,
      liquidityRisk: 0.1,
      signals: []
    }
  } as any;

  const output = await brain.analyzeMarket(input);

  console.log('=== Recommendation ===');
  console.log(JSON.stringify(output.recommendation, null, 2));

  console.log('\n=== Explanation ===');
  console.log(brain.getExplanation(output.recommendation));
}

runExample().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
