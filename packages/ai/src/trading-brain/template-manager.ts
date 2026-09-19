/**
 * Prompt Templates and Strategy Templates
 * Customizable templates for analysis and strategies
 */

import { PromptTemplate, StrategyTemplate, Example } from './types';
import Mustache from 'mustache';

export class PromptTemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();

  constructor() {
    this.loadDefaultTemplates();
  }

  private loadDefaultTemplates(): void {
    // Technical Analysis Template
    this.templates.set(
      'technical-analysis',
      this.createTemplate(
        'technical-analysis',
        'Technical Analysis Prompt',
        'Analyze technical indicators for trading decisions',
        'analysis',
        `Analyze the following technical indicators for {{symbol}}:
- RSI: {{rsi}}
- MACD: Line {{macd.line}}, Signal {{macd.signal}}
- Moving Averages: MA20 {{ma20}}, MA50 {{ma50}}, MA200 {{ma200}}
- Bollinger Bands: Upper {{bb.upper}}, Lower {{bb.lower}}
- Price: {{price}}

Generate a recommendation (BUY/SELL/HOLD) with confidence score.`,
      ),
    );

    // Sentiment Analysis Template
    this.templates.set(
      'sentiment-analysis',
      this.createTemplate(
        'sentiment-analysis',
        'Sentiment Analysis Prompt',
        'Analyze market sentiment from news and social data',
        'analysis',
        `Analyze sentiment for {{symbol}}:
News Score: {{newScore}}
Social Score: {{socialScore}}
Recent Headlines:
{{#headlines}}
- {{.}}
{{/headlines}}

Provide sentiment assessment (Bullish/Neutral/Bearish) with reasoning.`,
      ),
    );

    // Risk Assessment Template
    this.templates.set(
      'risk-assessment',
      this.createTemplate(
        'risk-assessment',
        'Risk Assessment Prompt',
        'Assess trading risks and position sizing',
        'analysis',
        `Assess risk for {{symbol}} position:
- Portfolio Heat: {{portfolioHeat}}%
- Volatility: {{volatility}}
- Position Size: {{positionSize}}
- Entry Price: {{entryPrice}}
- Stop Loss: {{stopLoss}}
- Take Profit: {{takeProfit}}

Evaluate risk level and recommend position adjustments.`,
      ),
    );

    // Recommendation Generation Template
    this.templates.set(
      'recommendation',
      this.createTemplate(
        'recommendation',
        'Generate Trading Recommendation',
        'Synthesize analysis into actionable recommendation',
        'recommendation',
        `Based on the following analysis for {{symbol}}:
Technical: {{technicalView}}
Sentiment: {{sentimentView}}
Volume: {{volumeView}}
Risk Level: {{riskLevel}}

Generate a comprehensive trade recommendation including:
1. Action (BUY/SELL/HOLD)
2. Entry Price
3. Stop Loss
4. Take Profit
5. Confidence Score (0-1)
6. Key Reasoning`,
      ),
    );

    // Explanation Template
    this.templates.set(
      'explanation',
      this.createTemplate(
        'explanation',
        'Generate Explanation',
        'Create human-readable explanation for recommendation',
        'explanation',
        `Explain the following trade recommendation in clear, concise terms for a {{audience}} trader:
- Symbol: {{symbol}}
- Action: {{action}}
- Entry: {{entry}}
- SL: {{stopLoss}}
- TP: {{takeProfit}}
- Confidence: {{confidence}}%

Make the explanation easy to understand and actionable.`,
      ),
    );

    // Learning Template
    this.templates.set(
      'learning',
      this.createTemplate(
        'learning',
        'Extract Learning from Trade',
        'Analyze trade outcome and extract learning',
        'learning',
        `Analyze this completed trade for learning:
Recommendation: {{recommendation}}
Outcome: {{outcome}} (Win/Loss/Neutral)
P&L: {{pnl}}%
Duration: {{duration}} hours
Exit Reason: {{exitReason}}

Extract 3-5 key learnings and improvement suggestions.`,
      ),
    );
  }

  private createTemplate(
    id: string,
    name: string,
    description: string,
    category: 'analysis' | 'recommendation' | 'explanation' | 'learning',
    template: string,
  ): PromptTemplate {
    return {
      id,
      name,
      description,
      category,
      template,
      variables: this.extractVariables(template),
      examples: [],
      isCustom: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private extractVariables(template: string): Array<{ name: string; type: string; description: string; required: boolean }> {
    const variableRegex = /\{\{#?(\w+)/g;
    const variables = new Set<string>();
    let match;

    while ((match = variableRegex.exec(template)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables).map((name) => ({
      name,
      type: 'string',
      description: `Variable: ${name}`,
      required: true,
    }));
  }

  /**
   * Render template with provided data
   */
  render(templateId: string, data: Record<string, any>): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return Mustache.render(template.template, data);
  }

  /**
   * Add custom template
   */
  addCustomTemplate(template: PromptTemplate): void {
    template.isCustom = true;
    template.createdAt = Date.now();
    template.updatedAt = Date.now();
    this.templates.set(template.id, template);
  }

  /**
   * Update template
   */
  updateTemplate(id: string, updates: Partial<PromptTemplate>): void {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template not found: ${id}`);
    }

    Object.assign(template, updates, { updatedAt: Date.now() });
  }

  /**
   * Get all templates by category
   */
  getTemplatesByCategory(category: string): PromptTemplate[] {
    return Array.from(this.templates.values()).filter((t) => t.category === category);
  }

  /**
   * Get template
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * List all templates
   */
  listTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }
}

export class StrategyTemplateManager {
  private strategies: Map<string, StrategyTemplate> = new Map();

  constructor() {
    this.loadDefaultStrategies();
  }

  private loadDefaultStrategies(): void {
    // Moving Average Crossover Strategy
    this.strategies.set(
      'ma-crossover',
      this.createStrategy(
        'ma-crossover',
        'Moving Average Crossover',
        'Simple but effective MA crossover strategy',
        [
          { condition: 'MA20 > MA50 > MA200', action: 'BUY signal', weight: 0.4 },
          { condition: 'MA20 < MA50 < MA200', action: 'SELL signal', weight: 0.4 },
          { condition: 'Price crosses above MA50', action: 'BUY signal', weight: 0.3 },
          { condition: 'Price crosses below MA50', action: 'SELL signal', weight: 0.3 },
        ],
        [
          { name: 'MA20', value: 20, type: 'number', min: 5, max: 50, description: 'Short MA period' },
          { name: 'MA50', value: 50, type: 'number', min: 20, max: 100, description: 'Medium MA period' },
          { name: 'MA200', value: 200, type: 'number', min: 100, max: 300, description: 'Long MA period' },
        ],
      ),
    );

    // RSI Overbought/Oversold Strategy
    this.strategies.set(
      'rsi-extremes',
      this.createStrategy(
        'rsi-extremes',
        'RSI Extremes',
        'Trade RSI overbought and oversold levels',
        [
          { condition: 'RSI < 30 AND Price above MA50', action: 'BUY signal', weight: 0.5 },
          { condition: 'RSI > 70 AND Price below MA50', action: 'SELL signal', weight: 0.5 },
          { condition: 'RSI divergence detected', action: 'Reversal signal', weight: 0.6 },
        ],
        [
          { name: 'RSI_PERIOD', value: 14, type: 'number', min: 7, max: 28, description: 'RSI calculation period' },
          { name: 'RSI_OVERBOUGHT', value: 70, type: 'number', min: 60, max: 90, description: 'Overbought threshold' },
          { name: 'RSI_OVERSOLD', value: 30, type: 'number', min: 10, max: 40, description: 'Oversold threshold' },
        ],
      ),
    );

    // MACD Strategy
    this.strategies.set(
      'macd-crossover',
      this.createStrategy(
        'macd-crossover',
        'MACD Crossover',
        'Classic MACD line and signal crossover',
        [
          { condition: 'MACD line crosses above signal line', action: 'BUY signal', weight: 0.5 },
          { condition: 'MACD line crosses below signal line', action: 'SELL signal', weight: 0.5 },
          { condition: 'MACD histogram turns positive', action: 'Bullish momentum', weight: 0.3 },
        ],
        [
          { name: 'FAST_PERIOD', value: 12, type: 'number', description: 'Fast EMA for MACD' },
          { name: 'SLOW_PERIOD', value: 26, type: 'number', description: 'Slow EMA for MACD' },
          { name: 'SIGNAL_PERIOD', value: 9, type: 'number', description: 'Signal line EMA' },
        ],
      ),
    );

    // Bollinger Bands Squeeze Strategy
    this.strategies.set(
      'bb-squeeze',
      this.createStrategy(
        'bb-squeeze',
        'Bollinger Bands Squeeze',
        'Trade breakouts from BB squeeze',
        [
          { condition: 'Price breaks above upper BB with volume', action: 'BUY signal', weight: 0.6 },
          { condition: 'Price breaks below lower BB with volume', action: 'SELL signal', weight: 0.6 },
          { condition: 'BB width < 0.5 ATR', action: 'Squeeze detected', weight: 0.2 },
        ],
        [
          { name: 'BB_PERIOD', value: 20, type: 'number', description: 'BB calculation period' },
          { name: 'BB_STDDEV', value: 2, type: 'number', description: 'Standard deviations' },
        ],
      ),
    );

    // Volume Breakout Strategy
    this.strategies.set(
      'volume-breakout',
      this.createStrategy(
        'volume-breakout',
        'Volume Breakout',
        'Trade on volume surges at support/resistance',
        [
          { condition: 'Volume > 2x average AND price breaks resistance', action: 'BUY signal', weight: 0.7 },
          { condition: 'Volume > 2x average AND price breaks support', action: 'SELL signal', weight: 0.7 },
          { condition: 'OBV trend aligns with price', action: 'Confirm signal', weight: 0.4 },
        ],
        [
          { name: 'VOLUME_MULTIPLIER', value: 2, type: 'number', description: 'Volume spike threshold' },
          { name: 'MA_VOLUME', value: 20, type: 'number', description: 'Average volume period' },
        ],
      ),
    );
  }

  private createStrategy(
    id: string,
    name: string,
    description: string,
    rules: any[],
    parameters: any[],
  ): StrategyTemplate {
    return {
      id,
      name,
      description,
      rules,
      parameters,
      indicators: this.extractIndicators(rules),
      riskManagement: [
        { type: 'max_position', threshold: 0.05, action: 'Limit to 5% of portfolio per trade' },
        { type: 'stop_loss', threshold: 0.02, action: 'Set SL at 2% below entry' },
        { type: 'take_profit', threshold: 0.05, action: 'Target 5% profit' },
      ],
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private extractIndicators(rules: any[]): string[] {
    const indicators = new Set<string>();

    for (const rule of rules) {
      const condition = rule.condition.toUpperCase();

      if (condition.includes('MA')) indicators.add('Moving Averages');
      if (condition.includes('RSI')) indicators.add('RSI');
      if (condition.includes('MACD')) indicators.add('MACD');
      if (condition.includes('BB')) indicators.add('Bollinger Bands');
      if (condition.includes('VOLUME') || condition.includes('OBV')) indicators.add('Volume');
      if (condition.includes('ATR')) indicators.add('ATR');
    }

    return Array.from(indicators);
  }

  /**
   * Get strategy by ID
   */
  getStrategy(id: string): StrategyTemplate | undefined {
    return this.strategies.get(id);
  }

  /**
   * List all strategies
   */
  listStrategies(): StrategyTemplate[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Add custom strategy
   */
  addCustomStrategy(strategy: StrategyTemplate): void {
    strategy.createdAt = Date.now();
    strategy.updatedAt = Date.now();
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Update strategy
   */
  updateStrategy(id: string, updates: Partial<StrategyTemplate>): void {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`Strategy not found: ${id}`);
    }

    Object.assign(strategy, updates, { updatedAt: Date.now() });
  }

  /**
   * Activate/deactivate strategy
   */
  toggleStrategy(id: string, isActive: boolean): void {
    const strategy = this.strategies.get(id);
    if (strategy) {
      strategy.isActive = isActive;
      strategy.updatedAt = Date.now();
    }
  }

  /**
   * Evaluate strategy against recent trades
   */
  evaluatePerformance(
    strategyId: string,
    trades: Array<{ recommended: boolean; profitable: boolean }>,
  ): {
    winRate: number;
    totalTrades: number;
    profitability: number;
  } {
    const signalTrades = trades.filter((t) => t.recommended);
    const wins = signalTrades.filter((t) => t.profitable).length;

    return {
      winRate: signalTrades.length > 0 ? wins / signalTrades.length : 0,
      totalTrades: signalTrades.length,
      profitability: wins - (signalTrades.length - wins),
    };
  }
}
