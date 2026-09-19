export class AIAnalysisResultDto {
  provider: string;
  recommendation: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  analysis: string;
  riskLevel: string;
  sentiment?: string;
  keyPoints?: string[];
  createdAt: Date;

  constructor(analysis: any) {
    this.provider = analysis.provider;
    this.recommendation = analysis.recommendation || 'HOLD';
    this.confidence = Number(analysis.confidence);
    this.analysis = analysis.analysis;
    this.riskLevel = analysis.riskLevel;
    this.sentiment = analysis.sentiment;
    this.keyPoints = analysis.keyPoints || [];
    this.createdAt = analysis.createdAt;
  }
}

export class AnalysisResponseDto {
  id: string;
  alertId: string;
  symbol: string;
  analyses: AIAnalysisResultDto[];
  completedAt: Date;

  constructor(alertId: string, symbol: string, analyses: any[]) {
    this.id = `analysis-${Date.now()}`;
    this.alertId = alertId;
    this.symbol = symbol;
    this.analyses = analyses.map(a => new AIAnalysisResultDto(a));
    this.completedAt = new Date();
  }
}

export class MarketDataDto {
  symbol: string;
  currentPrice: number;
  change24h?: number;
  changePercent24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
  marketCap?: number;
  technicalIndicators?: Record<string, any>;
}
