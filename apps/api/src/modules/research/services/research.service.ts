import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ResearchResult, ResearchJob, ResearchSourcePayload } from '../interfaces/research.interface';
import { ResearchRepository } from '../repositories/research.repository';
import { ResearchCacheService } from './research-cache.service';

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    private readonly repository: ResearchRepository,
    private readonly cache: ResearchCacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async runResearch(symbol: string, timeframe: string, exchange: string): Promise<ResearchResult> {
    const cached = await this.cache.get(symbol, timeframe, exchange);
    if (cached) {
      return cached;
    }

    const job: ResearchJob = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      timeframe,
      exchange,
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.repository.saveJob(job);
    const sources = await this.collectSources(symbol, timeframe, exchange);
    const result = this.buildResult(symbol, timeframe, exchange, sources);

    await this.repository.saveResult(result);
    await this.cache.set(symbol, timeframe, exchange, result);
    await this.eventEmitter.emitAsync('research.completed', result);

    await this.repository.updateJobStatus(job.id, 'completed', result);
    return result;
  }

  async getHistory(symbol: string): Promise<ResearchResult[]> {
    return this.repository.listHistory(symbol);
  }

  async getLatest(symbol: string, timeframe: string, exchange: string): Promise<ResearchResult | null> {
    return this.repository.getLatest(symbol, timeframe, exchange);
  }

  private async collectSources(symbol: string, timeframe: string, exchange: string): Promise<ResearchSourcePayload[]> {
    const sources = [
      { source: 'TradingView', category: 'technical', score: 0.84, confidence: 0.82, summary: 'Momentum and structure align for continuation' },
      { source: 'Binance', category: 'volume', score: 0.79, confidence: 0.8, summary: 'Volume remains elevated and price action confirms participation' },
      { source: 'Bybit', category: 'liquidity', score: 0.74, confidence: 0.76, summary: 'Liquidity pockets remain active near current levels' },
      { source: 'OKX', category: 'sentiment', score: 0.7, confidence: 0.73, summary: 'Sentiment is constructive with moderate risk' },
      { source: 'MEXC', category: 'correlation', score: 0.68, confidence: 0.7, summary: 'Cross-exchange correlation remains high' },
      { source: 'CoinGecko', category: 'fundamental', score: 0.75, confidence: 0.77, summary: 'On-chain and market cap trend remain supportive' },
      { source: 'CoinMarketCap', category: 'fundamental', score: 0.71, confidence: 0.72, summary: 'Macro market capitalization remains stable' },
      { source: 'Economic Calendar', category: 'fundamental', score: 0.65, confidence: 0.69, summary: 'Upcoming data events may add volatility' },
      { source: 'Fear & Greed Index', category: 'sentiment', score: 0.67, confidence: 0.71, summary: 'Sentiment is neutral-to-bullish' },
      { source: 'CryptoPanic News', category: 'sentiment', score: 0.66, confidence: 0.68, summary: 'News flow is mixed but not disruptive' },
      { source: 'RSS Feeds', category: 'fundamental', score: 0.63, confidence: 0.66, summary: 'Narrative remains mixed across outlets' },
      { source: 'Reddit', category: 'sentiment', score: 0.62, confidence: 0.65, summary: 'Community chatter is constructive' },
      { source: 'X (Twitter)', category: 'sentiment', score: 0.6, confidence: 0.64, summary: 'Social sentiment is mildly bullish' },
      { source: 'GitHub', category: 'fundamental', score: 0.58, confidence: 0.6, summary: 'Developer activity is steady' },
      { source: 'Official Exchange Announcements', category: 'fundamental', score: 0.72, confidence: 0.74, summary: 'Exchange updates are broadly neutral' },
    ];

    return sources.map((source) => ({
      ...source,
      metadata: { symbol, timeframe, exchange },
    }));
  }

  private buildResult(symbol: string, timeframe: string, exchange: string, sources: ResearchSourcePayload[]): ResearchResult {
    const researchScore = this.calculateResearchScore(sources);
    const researchConfidence = this.calculateResearchConfidence(sources);

    return {
      symbol,
      timeframe,
      exchange,
      sources,
      technical: {
        trend: 'bullish',
        supports: [symbol],
        resistance: [symbol],
      },
      fundamental: {
        macroBias: 'neutral',
        marketCapTrend: 'stable',
      },
      sentiment: {
        overall: 'constructive',
        bias: 'bullish',
      },
      onChain: {
        activity: 'elevated',
        flow: 'positive',
      },
      liquidity: {
        depth: 'healthy',
        concentration: 'moderate',
      },
      volume: {
        participation: 'high',
        surprise: 'normal',
      },
      volatility: {
        regime: 'normal',
        expectedRange: 'medium',
      },
      correlation: {
        marketBeta: 0.8,
        crossExchange: 'high',
      },
      researchScore,
      researchConfidence,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private calculateResearchScore(sources: ResearchSourcePayload[]): number {
    const mean = sources.reduce((sum, source) => sum + source.score, 0) / sources.length;
    return Number((mean * 100).toFixed(2));
  }

  private calculateResearchConfidence(sources: ResearchSourcePayload[]): number {
    const mean = sources.reduce((sum, source) => sum + source.confidence, 0) / sources.length;
    return Number((mean * 100).toFixed(2));
  }
}
