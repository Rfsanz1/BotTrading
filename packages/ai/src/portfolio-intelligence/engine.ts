import { DashboardCard, PortfolioAsset, PortfolioDashboard, PortfolioMetrics, PortfolioSnapshot } from './types';

export class PortfolioIntelligenceEngine {
  analyze(snapshot: PortfolioSnapshot): PortfolioMetrics {
    const assets = snapshot.assets || [];
    const total = Math.max(snapshot.totalValue, 1);
    const allocation = assets.map((asset) => ({ symbol: asset.symbol, allocation: asset.allocation, sector: asset.sector }));
    const sectorAllocation = this.aggregateBySector(assets);
    const concentrationRisk = Math.max(...assets.map((asset) => asset.allocation), 0);
    const totalRisk = assets.reduce((acc, asset) => acc + asset.allocation * Math.max(asset.volatility, 0.01), 0);
    const sectorRisk = sectorAllocation.map((value) => ({ sector: value.sector, exposure: value.allocation }));
    const correlations = assets.map((asset) => ({ symbol: asset.symbol, correlation: asset.correlation ?? 0 }));

    const trades = assets.flatMap((asset) => asset.trades || []);
    const wins = trades.filter((trade) => trade.win).length;
    const losses = trades.filter((trade) => !trade.win).length;
    const winRate = trades.length > 0 ? wins / trades.length : 0;
    const lossRate = trades.length > 0 ? losses / trades.length : 0;
    const averageProfit = trades.filter((trade) => trade.pnl > 0).reduce((acc, trade) => acc + trade.pnl, 0) / Math.max(1, trades.filter((trade) => trade.pnl > 0).length);
    const averageLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((acc, trade) => acc + trade.pnl, 0)) / Math.max(1, trades.filter((trade) => trade.pnl < 0).length);
    const totalReturn = assets.reduce((acc, asset) => acc + asset.avgReturn * asset.allocation, 0);
    const dailyReturn = totalReturn / Math.max(assets.length, 1);
    const weeklyReturn = dailyReturn * 5;
    const monthlyReturn = dailyReturn * 22;
    const drawdown = Math.min(0.2, Math.max(0.01, concentrationRisk * 0.2));
    const sharpeRatio = this.clamp(totalReturn / Math.max(totalRisk, 0.01), -3, 3);
    const sortinoRatio = this.clamp(totalReturn / Math.max(averageLoss || 0.01, 0.01), -3, 3);

    const recommendations = this.buildRecommendations(allocation, sectorAllocation, correlations, { totalReturn, drawdown, sharpeRatio, sortinoRatio });

    return {
      allocation,
      riskExposure: {
        totalRisk,
        concentrationRisk,
        sectorRisk,
      },
      sectorAllocation,
      correlations,
      performance: {
        totalReturn,
        dailyReturn,
        weeklyReturn,
        monthlyReturn,
        drawdown,
        sharpeRatio,
        sortinoRatio,
        winRate,
        lossRate,
        averageProfit,
        averageLoss,
      },
      reports: {
        monthly: this.renderReport('Monthly', totalReturn, drawdown, sharpeRatio),
        weekly: this.renderReport('Weekly', weeklyReturn, drawdown, sharpeRatio),
        daily: this.renderReport('Daily', dailyReturn, drawdown, sharpeRatio),
      },
      recommendations,
    };
  }

  buildDashboard(metrics: PortfolioMetrics): PortfolioDashboard {
    const summary: DashboardCard[] = [
      { title: 'Portfolio Value', value: `$${(metrics.allocation.reduce((acc, item) => acc + item.allocation, 0) * 1000).toFixed(0)}`, subtitle: 'Estimated value', trend: 'up' },
      { title: 'Risk Exposure', value: `${(metrics.riskExposure.concentrationRisk * 100).toFixed(0)}%`, subtitle: 'Concentration risk', trend: 'neutral' },
      { title: 'Sharpe Ratio', value: metrics.performance.sharpeRatio.toFixed(2), subtitle: 'Risk-adjusted return', trend: 'up' },
      { title: 'Win Rate', value: `${(metrics.performance.winRate * 100).toFixed(0)}%`, subtitle: 'Trade quality', trend: 'up' },
    ];

    const charts = [
      { title: 'Sector Allocation', series: metrics.sectorAllocation.map((item) => ({ label: item.sector, value: item.allocation })) },
      { title: 'Asset Allocation', series: metrics.allocation.map((item) => ({ label: item.symbol, value: item.allocation })) },
      { title: 'Correlation Profile', series: metrics.correlations.map((item) => ({ label: item.symbol, value: item.correlation })) },
    ];

    return { summary, charts, recommendations: metrics.recommendations };
  }

  private aggregateBySector(assets: PortfolioAsset[]) {
    const grouped = new Map<string, number>();
    assets.forEach((asset) => {
      grouped.set(asset.sector, (grouped.get(asset.sector) || 0) + asset.allocation);
    });
    return Array.from(grouped.entries()).map(([sector, allocation]) => ({ sector, allocation }));
  }

  private buildRecommendations(allocation: Array<{ symbol: string; allocation: number; sector: string }>, sectorAllocation: Array<{ sector: string; allocation: number }>, correlations: Array<{ symbol: string; correlation: number }>, metrics: { totalReturn: number; drawdown: number; sharpeRatio: number; sortinoRatio: number }) {
    const recommendations: string[] = [];
    const highExposure = allocation.filter((item) => item.allocation > 0.25);
    if (highExposure.length > 0) recommendations.push(`Reduce concentration in ${highExposure.map((item) => item.symbol).join(', ')}.`);
    const highSector = sectorAllocation.filter((item) => item.allocation > 0.4);
    if (highSector.length > 0) recommendations.push(`Diversify the heavily weighted ${highSector.map((item) => item.sector).join(', ')} sector(s).`);
    const overcrowded = correlations.filter((item) => item.correlation > 0.7);
    if (overcrowded.length > 0) recommendations.push(`Monitor correlation risk in ${overcrowded.map((item) => item.symbol).join(', ')}.`);
    if (metrics.sharpeRatio < 1) recommendations.push('Consider rebalancing toward better risk-adjusted opportunities.');
    if (metrics.drawdown > 0.1) recommendations.push('Reduce downside exposure and tighten stop-loss discipline.');
    return recommendations;
  }

  private renderReport(label: string, returnValue: number, drawdown: number, sharpeRatio: number): string {
    return `${label} report: return ${returnValue.toFixed(2)}%, drawdown ${drawdown.toFixed(2)}%, sharpe ${sharpeRatio.toFixed(2)}.`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

export default PortfolioIntelligenceEngine;
