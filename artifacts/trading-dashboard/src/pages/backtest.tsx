import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Play, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type BacktestForm = {
  symbol: string;
  days: number;
  initial_capital: number;
  tp_pct: number;
  sl_pct: number;
  rsi_threshold: number;
};

export default function Backtest() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);
  const { register, handleSubmit } = useForm<BacktestForm>({
    defaultValues: {
      symbol: 'BTCUSDT',
      days: 30,
      initial_capital: 1000,
      tp_pct: 2.0,
      sl_pct: 1.0,
      rsi_threshold: 30
    }
  });

  const onSubmit = async (data: BacktestForm) => {
    setRunning(true);
    setResults(null);
    try {
      const res = await apiFetch('/backtest/run', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          days: Number(data.days),
          initial_capital: Number(data.initial_capital),
          tp_pct: Number(data.tp_pct),
          sl_pct: Number(data.sl_pct),
          rsi_threshold: Number(data.rsi_threshold)
        })
      });
      setResults(res);
      toast.success('Backtest complete');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Strategy Backtest</h2>
        <p className="text-muted-foreground">Simulate trading performance on historical data.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-12">
        <Card className="md:col-span-4">
          <CardHeader>
            <CardTitle>Parameters</CardTitle>
            <CardDescription>Configure strategy settings</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>Symbol</Label>
                <Input {...register('symbol')} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Days History</Label>
                  <Input type="number" {...register('days')} />
                </div>
                <div className="space-y-2">
                  <Label>Capital (USDT)</Label>
                  <Input type="number" {...register('initial_capital')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Take Profit %</Label>
                  <Input type="number" step="0.1" {...register('tp_pct')} />
                </div>
                <div className="space-y-2">
                  <Label>Stop Loss %</Label>
                  <Input type="number" step="0.1" {...register('sl_pct')} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>RSI Oversold Threshold</Label>
                <Input type="number" {...register('rsi_threshold')} />
              </div>
              <Button type="submit" className="w-full" disabled={running}>
                {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Run Backtest
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-8 flex flex-col">
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {!results && !running && (
              <div className="h-full min-h-[300px] flex items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-lg">
                Submit parameters to run backtest
              </div>
            )}
            
            {running && (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-primary gap-4">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>Simulating trades...</p>
              </div>
            )}

            {results && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <ResultMetric title="Total Return" value={`${results.total_return_pct.toFixed(2)}%`} valClass={results.total_return_pct >= 0 ? 'text-success' : 'text-destructive'} />
                  <ResultMetric title="Net Profit" value={`$${results.total_pnl.toFixed(2)}`} valClass={results.total_pnl >= 0 ? 'text-success' : 'text-destructive'} />
                  <ResultMetric title="Win Rate" value={`${(results.win_rate ?? 0).toFixed(1)}%`} />
                  <ResultMetric title="Trades" value={results.trades_count} />
                  <ResultMetric title="Profit Factor" value={results.profit_factor?.toFixed(2) || '0'} />
                  <ResultMetric title="Max Drawdown" value={`$${results.max_drawdown_usdt?.toFixed(2)}`} valClass="text-destructive" />
                  <ResultMetric title="Final Equity" value={`$${results.final_capital.toFixed(2)}`} />
                  <ResultMetric title="Processed Candles" value={results.candles} />
                </div>

                <div className="h-[250px] mt-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={results.equity_curve} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorBT" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="idx" hide />
                      <YAxis domain={['auto', 'auto']} tickFormatter={(v) => `$${v}`} width={80} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                        labelFormatter={() => 'Equity'}
                      />
                      <Area type="step" dataKey="equity" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorBT)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResultMetric({ title, value, valClass = '' }: { title: string, value: string|number, valClass?: string }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <div className={`text-lg font-bold ${valClass}`}>{value}</div>
    </div>
  );
}
