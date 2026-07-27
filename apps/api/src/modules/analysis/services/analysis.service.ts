import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IAnalysisRepository, IMarketDataProvider } from '../../../domain/interfaces';
import { AIAnalysisCompletedEvent } from '../../../domain/events';
import { AIProviderNotAvailableException } from '../../../domain/exceptions';
import { AnalysisRepository } from '../repositories/analysis.repository';
import {
  OpenAIProvider,
  ClaudeProvider,
  GeminiProvider,
  GroqProvider,
  DeepSeekProvider,
  OllamaProvider,
  BaseAIProvider,
} from '../providers/ai-providers';

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly repository: IAnalysisRepository;
  private readonly providers: Map<string, BaseAIProvider>;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    analysisRepository?: AnalysisRepository,
  ) {
    this.repository = analysisRepository || new AnalysisRepository();

    // Initialize all AI providers
    this.providers = new Map();
    this.registerProviders();
  }

  /**
   * Register all AI providers
   */
  private registerProviders(): void {
    const providers = [
      new OpenAIProvider(),
      new ClaudeProvider(),
      new GeminiProvider(),
      new GroqProvider(),
      new DeepSeekProvider(),
      new OllamaProvider(),
    ];

    providers.forEach(provider => {
      this.providers.set(provider.getName(), provider);
    });

    this.logger.log(`Registered ${this.providers.size} AI providers`);
  }

  /**
   * Perform AI analysis using all enabled providers
   */
  async analyzeAlert(alertId: string, userId: string, symbol: string, marketData: Record<string, any>): Promise<string> {
    try {
      this.logger.log(`Starting AI analysis for alert ${alertId}, symbol ${symbol}`);

      // Get all available providers
      const availableProviders = await this.getAvailableProviders();

      if (availableProviders.length === 0) {
        throw new AIProviderNotAvailableException('No AI providers available');
      }

      // Run analysis in parallel for all providers
      const analysisPromises = availableProviders.map(provider =>
        this.analyzeWithProvider(provider, alertId, symbol, marketData),
      );

      const analyses = await Promise.allSettled(analysisPromises);

      // Process results
      const successfulAnalyses = analyses
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);

      if (successfulAnalyses.length === 0) {
        throw new Error('All AI providers failed to provide analysis');
      }

      // Save analyses to database
      for (const analysis of successfulAnalyses) {
        await this.repository.create({
          alertId,
          symbol,
          provider: analysis.provider,
          analysis: analysis.analysis,
          confidence: analysis.confidence,
          riskLevel: analysis.riskLevel,
          sentiment: analysis.sentiment,
          keyPoints: analysis.keyPoints,
          metadata: {
            source: 'ai_analysis',
            timestamp: new Date(),
          },
        });
      }

      // Publish event
      const event = new AIAnalysisCompletedEvent(
        alertId,
        userId,
        symbol,
        successfulAnalyses.map(a => ({
          provider: a.provider,
          recommendation: a.recommendation,
          confidence: a.confidence,
          analysis: a.analysis,
          riskLevel: a.riskLevel,
        })),
      );

      await this.eventEmitter.emitAsync('trading.analysis.completed', event);

      this.logger.log(`AI analysis completed for alert ${alertId}: ${successfulAnalyses.length} providers analyzed`);

      return alertId;
    } catch (error) {
      this.logger.error(`Failed to analyze alert ${alertId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Analyze with a specific provider
   */
  private async analyzeWithProvider(
    provider: BaseAIProvider,
    alertId: string,
    symbol: string,
    marketData: Record<string, any>,
  ): Promise<any> {
    try {
      const result = await provider.analyzeMarket(symbol, marketData);
      return {
        provider: provider.getName(),
        recommendation: result.recommendation,
        confidence: result.confidence,
        analysis: result.analysis,
        riskLevel: result.riskLevel,
        sentiment: result.sentiment,
        keyPoints: result.keyPoints,
      };
    } catch (error) {
      this.logger.warn(`Provider ${provider.getName()} analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get available providers
   */
  private async getAvailableProviders(): Promise<BaseAIProvider[]> {
    const availableProviders: BaseAIProvider[] = [];

    for (const [name, provider] of this.providers.entries()) {
      try {
        const available = await provider.isAvailable();
        if (available) {
          availableProviders.push(provider);
        }
      } catch (error) {
        this.logger.warn(`Provider ${name} availability check failed: ${error.message}`);
      }
    }

    return availableProviders;
  }

  /**
   * Get analysis results for alert
   */
  async getAnalysisResults(alertId: string): Promise<any[]> {
    return this.repository.findByAlertId(alertId);
  }

  /**
   * Get provider performance
   */
  async getProviderStats(provider: string): Promise<any> {
    const analyses = await this.repository.findByProvider(provider, 100);

    if (analyses.length === 0) {
      return null;
    }

    const correctPredictions = analyses.filter((a: any) => a.sentiment).length;
    const accuracy = correctPredictions / analyses.length;

    return {
      provider,
      totalAnalyses: analyses.length,
      accuracy,
      avgConfidence: analyses.reduce((sum: number, a: any) => sum + Number(a.confidence), 0) / analyses.length,
    };
  }
}
