import React from 'react';
import { useApiData } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from 'recharts';

export default function Analytics() {
  const { data: analytics, loading } = useApiData<any>('/analytics?days=30', 60000);

  if (!analytics) return null;

  const symbolData = analytics.by_symbol || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="text-muted-foreground">30-day performance metrics and attribution.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard title="Sharpe Ratio" value={analytics.sharpe_ratio?.toFixed(2)} desc="Risk-adjusted return" />
        <MetricCard title="Sortino Ratio" value={analytics.sortino_ratio?.toFixed(2)} desc="Downside risk" />
        <MetricCard title="Calmar Ratio" value={analytics.calmar_ratio?.toFixed(2)} desc="Return vs Drawdown" />
        <MetricCard title="Max Drawdown" value={`${(analytics.max_drawdown_pct ?? 0).toFixed(1)}%`} desc={`${analytics.max_drawdown_usdt?.toFixed(0)}`} />
        <MetricCard title="Profit Factor" value={analytics.profit_factor?.toFixed(2)} desc="Gross Profit / Gross Loss" />
        <MetricCard title="Expectancy" value={`$${analytics.expectancy?.toFixed(2)}`} desc="Avg PnL per trade" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trade Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Total Trades</span>
              <span className="font-bold">{analytics.trades_count}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Win Rate</span>
              <span className="font-bold">{(analytics.win_rate ?? 0).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Gross Profit</span>
              <span className="font-bold text-success">${analytics.gross_profit?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Gross Loss</span>
              <span className="font-bold text-destructive">-${Math.abs(analytics.gross_loss || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Max Consecutive Wins</span>
              <span className="font-bold text-success">{analytics.consecutive_wins}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Max Consecutive Losses</span>
              <span className="font-bold text-destructive">{analytics.consecutive_losses}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Performance by Symbol</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {symbolData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={symbolData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <XAxis dataKey="symbol" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" />
                  <YAxis tick={{fontSize: 12}} tickFormatter={(v) => `$${v}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                    formatter={(val: number) => [`$${val.toFixed(2)}`, 'PnL']}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {symbolData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">No data available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, desc }: { title: string, value: string, desc: string }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-2xl font-bold">{value || '-'}</div>
        <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      </CardContent>
    </Card>
  );
}
