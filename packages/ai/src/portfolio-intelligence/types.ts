export interface PortfolioAsset {
  symbol: string;
  sector: string;
  allocation: number;
  avgReturn: number;
  volatility: number;
  beta?: number;
  correlation?: number;
  trades?: Array<{ pnl: number; win: boolean }>;
}

export interface PortfolioSnapshot {
  totalValue: number;
  assets: PortfolioAsset[];
  period: '1D' | '1W' | '1M' | '3M' | '1Y';
}

export interface PortfolioMetrics {
  allocation: Array<{ symbol: string; allocation: number; sector: string }>;
  riskExposure: {
    totalRisk: number;
    concentrationRisk: number;
    sectorRisk: Array<{ sector: string; exposure: number }>;
  };
  sectorAllocation: Array<{ sector: string; allocation: number }>;
  correlations: Array<{ symbol: string; correlation: number }>;
  performance: {
    totalReturn: number;
    dailyReturn: number;
    weeklyReturn: number;
    monthlyReturn: number;
    drawdown: number;
    sharpeRatio: number;
    sortinoRatio: number;
    winRate: number;
    lossRate: number;
    averageProfit: number;
    averageLoss: number;
  };
  reports: {
    monthly: string;
    weekly: string;
    daily: string;
  };
  recommendations: string[];
}

export interface DashboardCard {
  title: string;
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface PortfolioDashboard {
  summary: DashboardCard[];
  charts: Array<{ title: string; series: Array<{ label: string; value: number }> }>;
  recommendations: string[];
}
