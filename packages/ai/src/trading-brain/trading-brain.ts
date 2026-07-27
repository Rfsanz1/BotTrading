/**
 * AI Trading Brain Main Orchestrator
 * Combines all analysis engines and providers for comprehensive trading decisions
 */

import { AIService } from '../ai.service';
import { Message, ProviderName } from '../types';
import {
  TradingBrainInput,
  TradingBrainOutput,
  BrainConfig,
  TradeRecommendation,
  ConsensusDetails,
  ProviderName as ProviderNameType,
} from './types';
import { TechnicalAnalysisEngine, TradingViewAlertAnalyzer, SentimentAnalysisEngine, MarketStructureAnalyzer, VolumeAnalysisEngine, LiquidityAnalyzer, RiskAnalysisEngine } from './analysis-engines';
import { ConsensusEngine, ConfidenceScorer, AnalysisAggregation } from './consensus-engine';
import { LearningSystem, TradeResultAnalyzer } from './learning-system';
import { ExplanationEngine } from './explanation-engine';
import { PromptTemplateManager, StrategyTemplateManager } from './template-manager';
import { TradingDecisionEngine } from '../decision-engine';

export class AITradingBrain {
  private technicalEngine: TechnicalAnalysisEngine;
  private tradingViewAnalyzer: TradingViewAlertAnalyzer;
  private sentimentEngine: SentimentAnalysisEngine;
  private structureAnalyzer: MarketStructureAnalyzer;
  private volumeEngine: VolumeAnalysisEngine;
  private liquidityAnalyzer: LiquidityAnalyzer;
  private riskEngine: RiskAnalysisEngine;

  private consensusEngine: ConsensusEngine;
  private confidenceScorer: ConfidenceScorer;

  private learningSystem: LearningSystem;
  private resultAnalyzer: TradeResultAnalyzer;

  private explanationEngine: ExplanationEngine;
  private promptTemplateManager: PromptTemplateManager;
  private strategyTemplateManager: StrategyTemplateManager;
  private decisionEngine: TradingDecisionEngine;

  private aiService: AIService;
  private config: BrainConfig;

  constructor(config: Partial<BrainConfig> = {}) {
    // Initialize engines
    this.technicalEngine = new TechnicalAnalysisEngine();
    this.tradingViewAnalyzer = new TradingViewAlertAnalyzer();
    this.sentimentEngine = new SentimentAnalysisEngine();
    this.structureAnalyzer = new MarketStructureAnalyzer();
    this.volumeEngine = new VolumeAnalysisEngine();
    this.liquidityAnalyzer = new LiquidityAnalyzer();
    this.riskEngine = new RiskAnalysisEngine();

    this.consensusEngine = new ConsensusEngine();
    this.confidenceScorer = new ConfidenceScorer();

    this.learningSystem = new LearningSystem();
    this.resultAnalyzer = new TradeResultAnalyzer();

    this.explanationEngine = new ExplanationEngine();
    this.promptTemplateManager = new PromptTemplateManager();
    this.strategyTemplateManager = new StrategyTemplateManager();
    this.decisionEngine = new TradingDecisionEngine();

    this.aiService = AIService;

    // Set configuration
    this.config = {
      providers: ['openai', 'claude', 'gemini'],
      analysisTypes: ['technical', 'sentiment', 'volume', 'liquidity', 'structure', 'risk'],
      minConfidenceThreshold: 0.5,
      useConsensus: true,
      learnFromTrades: true,
      riskManagementProfile: 'moderate',
      ...config,
    };
  }

  /**
   * Main entry point - analyze market and generate recommendation
   */
  async analyzeMarket(input: TradingBrainInput): Promise<TradingBrainOutput> {
    const startTime = Date.now();

    // Run all analyses in parallel
    const analysis = await Promise.all([
      this.analyzeTechnical(input),
      this.analyzeSentiment(input),
      this.analyzeStructure(input),
      this.analyzeVolume(input),
      this.analyzeLiquidity(input),
      this.analyzeOrderFlow(input),
      this.analyzeRisk(input),
    ]);

    const [technical, sentiment, structure, volume, liquidity, orderFlow, risk] = analysis;

    // Aggregate analyses
    const aggregation: AnalysisAggregation = {
      technical,
      sentiment,
      volume,
      liquidity,
      orderFlow,
      structure,
      risk,
    };

    // Generate recommendation
    const recommendation = await this.generateRecommendation(input, aggregation);

    // Calculate processing metrics
    const analysisCount = [technical, sentiment, volume, liquidity, orderFlow, structure, risk].filter((a) => a !== null).length;
    const processingTime = Date.now() - startTime;

    return {
      recommendation,
      analysis: {
        technical: technical ? technical : null,
        sentiment: sentiment ? sentiment : null,
        structure: structure ? structure : null,
        volume: volume ? volume : null,
        liquidity: liquidity ? liquidity : null,
        orderFlow: orderFlow ? orderFlow : null,
        risk: risk ? risk : null,
      },
      metadata: {
        processingTime,
        analysisCount,
        confidenceFactors: recommendation.explanations.map((e) => e.source),
      },
    };
  }

  /**
   * Analyze technical indicators
   */
  private async analyzeTechnical(input: TradingBrainInput) {
    if (!input.technical) return null;

    return this.technicalEngine.analyze({
      price: 0, // Would come from price input
      rsi: input.technical.rsi,
      macd: input.technical.macd,
      ma20: input.technical.movingAverages?.ma20,
      ma50: input.technical.movingAverages?.ma50,
      ma200: input.technical.movingAverages?.ma200,
      bollingerBands: input.technical.bollingerBands,
      atr: input.technical.atr,
      stochastic: input.technical.stochastic,
      obv: input.technical.obv,
      adx: input.technical.adx,
    });
  }

  /**
   * Analyze news sentiment
   */
  private async analyzeSentiment(input: TradingBrainInput) {
    if (!input.newsSentiment) return null;

    const analysis = this.sentimentEngine.analyze(input.newsSentiment.score, input.newsSentiment.sources);

    return {
      confidence: Math.abs(input.newsSentiment.score),
      signals: [
        `Overall sentiment: ${input.newsSentiment.sentiment}`,
        `Trend: ${analysis.trend}`,
        `Impact: ${analysis.impact}`,
        ...input.newsSentiment.sources.slice(0, 2).map((s) => `${s.source}: ${s.sentiment}`),
      ],
    };
  }

  /**
   * Analyze market structure
   */
  private async analyzeStructure(input: TradingBrainInput) {
    if (!input.marketStructure) return null;

    const structure = input.marketStructure;

    return {
      confidence: structure.strength,
      signals: [
        `Trend: ${structure.trend}`,
        `Pattern: ${structure.pattern || 'none detected'}`,
        `Support levels: ${structure.support.length}`,
        `Resistance levels: ${structure.resistance.length}`,
        ...structure.signals,
      ],
    };
  }

  /**
   * Analyze volume
   */
  private async analyzeVolume(input: TradingBrainInput) {
    if (!input.volume) return null;

    const volume = input.volume;

    return {
      confidence: Math.abs(volume.priceVolumeCorrelation),
      signals: [
        `Volume trend: ${volume.volumeTrend}`,
        `Change: ${(volume.volumeChange * 100).toFixed(1)}%`,
        `PVC: ${(volume.priceVolumeCorrelation * 100).toFixed(1)}`,
        ...volume.signals,
      ],
    };
  }

  /**
   * Analyze liquidity
   */
  private async analyzeLiquidity(input: TradingBrainInput) {
    if (!input.liquidity) return null;

    const liquidity = input.liquidity;

    return {
      confidence: liquidity.liquidityScore,
      signals: [
        `Spread: ${liquidity.spreadPercentage.toFixed(3)}%`,
        `Impact: ${liquidity.impact}`,
        `Liquidity score: ${(liquidity.liquidityScore * 100).toFixed(0)}%`,
        ...liquidity.signals,
      ],
    };
  }

  /**
   * Analyze order flow
   */
  private async analyzeOrderFlow(input: TradingBrainInput) {
    if (!input.orderFlow) return null;

    const orderFlow = input.orderFlow;

    return {
      confidence: Math.max(orderFlow.buyPressure, orderFlow.sellPressure),
      signals: [
        `Flow trend: ${orderFlow.flowTrend}`,
        `Buy pressure: ${(orderFlow.buyPressure * 100).toFixed(0)}%`,
        `Sell pressure: ${(orderFlow.sellPressure * 100).toFixed(0)}%`,
        `Accumulation: ${orderFlow.accumulation}`,
        ...orderFlow.signals,
      ],
    };
  }

  /**
   * Analyze risk
   */
  private async analyzeRisk(input: TradingBrainInput) {
    if (!input.risk) return null;

    const risk = input.risk;

    return {
      confidence: 1 - risk.riskScore, // Invert - high risk = low confidence in the analysis
      signals: [
        `Risk level: ${risk.overallRisk}`,
        `Heat: ${(risk.portfolioHeat * 100).toFixed(0)}%`,
        `Concentration: ${(risk.concentration * 100).toFixed(0)}%`,
        ...risk.signals,
      ],
    };
  }

  /**
   * Generate recommendation using AI providers
   */
  private async generateRecommendation(
    input: TradingBrainInput,
    aggregation: AnalysisAggregation,
  ): Promise<TradeRecommendation> {
    // Aggregate analysis sources
    const aggregated = this.consensusEngine.aggregateAnalyses(aggregation);

    // Use prompt template to generate AI analysis
    const analysisPrompt = this.promptTemplateManager.render('technical-analysis', {
      symbol: input.symbol,
      rsi: input.technical?.rsi,
      macd: input.technical?.macd,
      ma20: input.technical?.movingAverages?.ma20,
      ma50: input.technical?.movingAverages?.ma50,
      ma200: input.technical?.movingAverages?.ma200,
      bb: input.technical?.bollingerBands,
      price: 0,
    });

    // Get AI consensus
    const consensusResult = this.config.useConsensus
      ? await this.getAIConsensus(analysisPrompt)
      : await this.getSingleAIAnalysis(analysisPrompt);

    const decision = this.decisionEngine.evaluate({
      marketData: {
        symbol: input.symbol,
        price: (input.customContext?.price as number) || 0,
        changePercent: input.customContext?.changePercent as number | undefined,
        volume: input.customContext?.volume as number | undefined,
      },
      aiConsensus: {
        recommendation: consensusResult.recommendation,
        confidence: consensusResult.confidence ?? aggregated.confidence,
        agreementScore: consensusResult.consensusDetails?.agreementScore ?? aggregated.confidence,
        reasons: consensusResult.reasoning ? [consensusResult.reasoning] : undefined,
      },
      technical: {
        rsi: input.technical?.rsi,
        macd: typeof input.technical?.macd === 'object' && input.technical?.macd !== null ? input.technical.macd.histogram : undefined,
        ma20: input.technical?.movingAverages?.ma20,
        ma50: input.technical?.movingAverages?.ma50,
        ma200: input.technical?.movingAverages?.ma200,
        atr: input.technical?.atr,
        volatility: input.customContext?.volatility as number | undefined,
      },
      news: input.newsSentiment
        ? {
            score: input.newsSentiment.score,
            sentiment: input.newsSentiment.sentiment,
            impact: input.newsSentiment.impact,
          }
        : undefined,
      alerts: (input.tradingViewAlerts || []).map((alert) => ({
        type: alert.type,
        confidence: alert.confidence,
        message: alert.message,
      })),
      portfolio: {
        currentWeight: input.portfolio?.currentWeight,
        concentrationRisk: input.portfolio?.concentrationRisk,
        totalValue: input.customContext?.portfolioValue as number | undefined,
        openPositions: input.openPositions?.map((position) => ({ symbol: position.symbol, size: position.size })),
      },
      riskSettings: {
        maxPositionSizePct: input.customContext?.maxPositionSizePct as number | undefined,
        maxDrawdownPct: input.risk?.maxDrawdown ? input.risk.maxDrawdown / 100 : undefined,
        maxRiskPct: input.risk?.riskScore,
        riskRewardMin: 2,
        confidenceThreshold: this.config.minConfidenceThreshold,
      },
    });

    const baseConfidence = Math.min(1, (aggregated.confidence + decision.confidence) / 2);
    const risks = this.identifyRisks(input, aggregated);
    if (decision.risk === 'high') {
      risks.push({ level: 'high' as const, message: 'Decision engine flagged a high-risk setup', mitigation: 'Reduce size or wait for better confirmation' });
    }

    // Build recommendation
    const recommendation: TradeRecommendation = {
      id: `rec-${Date.now()}`,
      timestamp: Date.now(),
      symbol: input.symbol,
      action: decision.action,
      entryPrice: decision.entry || consensusResult.entryPrice || 0,
      exitPrice: consensusResult.targetPrice || 0,
      stopLoss: decision.stopLoss || consensusResult.stopLoss,
      takeProfit: decision.takeProfit || consensusResult.takeProfit,
      position: input.openPositions?.[0] || null,
      confidence: this.confidenceScorer.adjustForRisk(
        baseConfidence,
        input.risk?.overallRisk || 'medium',
        input.portfolio?.concentrationRisk || 0,
      ),
      riskRewardRatio: decision.metadata.riskReward || consensusResult.riskRewardRatio || 2,
      reasoning: decision.explanation,
      explanations: [
        ...this.buildExplanations(consensusResult, aggregated),
        {
          source: 'Decision Engine',
          explanation: decision.explanation,
          confidence: decision.confidence,
          keyFactors: decision.reasons,
        },
      ],
      sources: aggregated.sources,
      consensusDetails: consensusResult.consensusDetails,
      risks,
      alternativeActions: [],
    };

    return recommendation;
  }

  /**
   * Get consensus from multiple AI providers
   */
  private async getAIConsensus(prompt: string): Promise<any> {
    // Implementation would use AIService.streamConsensus
    // This is a simplified version
    const providers = (this.config.providers as ProviderName[]) || ['openai'];

    const messages: Message[] = [
      { id: `m-1`, role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const result = await this.aiService.consensus(`consensus-${Date.now()}`, messages, providers);

    return this.parseAIResponse(result.content);
  }

  /**
   * Get single AI analysis
   */
  private async getSingleAIAnalysis(prompt: string): Promise<any> {
    const provider = (this.config.providers[0] as ProviderName) || 'openai';

    const messages: Message[] = [
      { id: `m-1`, role: 'user', content: prompt, timestamp: Date.now() },
    ];

    const result = await this.aiService.sendMessage(`analysis-${Date.now()}`, provider, messages);

    return this.parseAIResponse(result.content);
  }

  /**
   * Parse action from text
   */
  private parseAction(text: string): 'BUY' | 'SELL' | 'HOLD' | 'CLOSE' {
    const upper = text?.toUpperCase() || '';
    if (upper.includes('BUY')) return 'BUY';
    if (upper.includes('SELL')) return 'SELL';
    if (upper.includes('CLOSE')) return 'CLOSE';
    return 'HOLD';
  }

  /**
   * Parse AI response
   */
  private parseAIResponse(response: string): any {
    // Simplified parsing - in production would use structured outputs
    return {
      recommendation: response.includes('BUY') ? 'BUY' : response.includes('SELL') ? 'SELL' : 'HOLD',
      entryPrice: this.extractNumber(response, /Entry[:\s]*\$?([\d.]+)/) || 0,
      targetPrice: this.extractNumber(response, /Target[:\s]*\$?([\d.]+)/) || 0,
      stopLoss: this.extractNumber(response, /Stop[:\s]*\$?([\d.]+)/),
      takeProfit: this.extractNumber(response, /Take.*Profit[:\s]*\$?([\d.]+)/),
      riskRewardRatio: this.extractNumber(response, /R[:/\s]*R[:\s]*([\d.]+)/) || 2,
      consensusDetails: { providers: [], aggregationMethod: 'ai', agreementScore: 0 },
    };
  }

  /**
   * Extract number from text
   */
  private extractNumber(text: string, pattern: RegExp): number | undefined {
    const match = text.match(pattern);
    return match ? parseFloat(match[1]) : undefined;
  }

  /**
   * Build explanation array
   */
  private buildExplanations(aiResult: any, aggregated: any): any[] {
    return [
      {
        source: 'AI Analysis',
        explanation: aiResult.reasoning || 'Based on multiple analysis types',
        confidence: aggregated.confidence,
        keyFactors: aggregated.keyFactors,
      },
    ];
  }

  /**
   * Identify risks
   */
  private identifyRisks(input: TradingBrainInput, aggregated: any): any[] {
    const risks: any[] = [];

    if (input.risk?.overallRisk === 'high') {
      risks.push({
        level: 'high',
        message: 'Portfolio risk level is high',
        mitigation: 'Reduce position size or skip this trade',
      });
    }

    if (input.portfolio?.concentrationRisk > 0.5) {
      risks.push({
        level: 'medium',
        message: 'High concentration risk detected',
        mitigation: 'Diversify portfolio or reduce position',
      });
    }

    if (aggregated.confidence < 0.5) {
      risks.push({
        level: 'medium',
        message: 'Low confidence in analysis',
        mitigation: 'Wait for clearer signals',
      });
    }

    return risks;
  }

  /**
   * Get recommendation explanation
   */
  getExplanation(recommendation: TradeRecommendation): string {
    return this.explanationEngine.generateExplanation(recommendation);
  }

  /**
   * Learn from completed trade
   */
  recordTradeResult(tradeHistory: any): void {
    // Would store in database
  }

  /**
   * Get learning insights
   */
  async getLearningInsights(symbol: string): Promise<any> {
    // Would fetch from database
    return {};
  }

  /**
   * Add custom prompt template
   */
  addCustomPrompt(template: any): void {
    this.promptTemplateManager.addCustomTemplate(template);
  }

  /**
   * Add custom strategy
   */
  addCustomStrategy(strategy: any): void {
    this.strategyTemplateManager.addCustomStrategy(strategy);
  }

  /**
   * Get brain config
   */
  getConfig(): BrainConfig {
    return this.config;
  }

  /**
   * Update brain config
   */
  updateConfig(updates: Partial<BrainConfig>): void {
    Object.assign(this.config, updates);
  }
}

export { AITradingBrain as default };
