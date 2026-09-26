jest.mock('../ai.service', () => ({ AIService: {} }));
jest.mock('@rfsanz/database', () => ({ prisma: {} }));

const { AITradingBrain } = require('../trading-brain/trading-brain') as typeof import('../trading-brain/trading-brain');

describe('AI response safety boundary', () => {
  it('rejects empty and legacy text responses instead of creating zero-valued recommendations', () => {
    const brain = new AITradingBrain();
    const parse = (brain as unknown as { parseAIResponse: (value: string) => unknown }).parseAIResponse.bind(brain);
    expect(() => parse('')).toThrow('AI_UNAVAILABLE');
    expect(() => parse('BUY BTC at 100')).toThrow('AI_INVALID');
  });

  it('accepts only the structured validation schema', () => {
    const brain = new AITradingBrain();
    const parse = (brain as unknown as { parseAIResponse: (value: string) => unknown }).parseAIResponse.bind(brain);
    expect(parse(JSON.stringify({
      direction: 'LONG',
      setupType: 'BREAKOUT',
      confidenceRaw: 0.7,
      supportingFactors: ['higher timeframe trend'],
      conflictingFactors: [],
      riskWarnings: [],
      invalidation: 'below protected low',
      rationale: 'deterministic snapshot supports continuation',
    }))).toMatchObject({ recommendation: 'BUY', confidenceRaw: 0.7 });
  });
});
