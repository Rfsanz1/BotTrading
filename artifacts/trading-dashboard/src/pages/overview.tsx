import React from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Pause, XCircle, TrendingUp, TrendingDown, DollarSign, Activity, Briefcase } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { toast } from 'sonner';

export default function Overview() {
  const { data: status, refetch: refetchStatus } = useApiData<any>('/status', 30000);
  const { data: daily } = useApiData<any>('/daily', 30000);
  const { data: history } = useApiData<any>('/history', 60000);

  const togglePause = async () => {
    if (!status) return;
    try {
      if (status.paused) {
        await apiFetch('/bot/resume', { method: 'POST' });
        toast.success('Bot resumed');
      } else {
        await apiFetch('/bot/pause', { method: 'POST' });
        toast.warning('Bot paused');
      }
      refetchStatus();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const closeAll = async () => {
    if (!confirm('Are you sure you want to market close all open positions?')) return;
    try {
      await apiFetch('/bot/close-all', { method: 'POST' });
      toast.success('Close all initiated');
      refetchStatus();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const equityData = history?.equity_history || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">Real-time trading status and daily snapshot.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant={status?.paused ? "default" : "secondary"} 
            onClick={togglePause}
            className="w-32"
          >
            {status?.paused ? (
              <><Play className="mr-2 h-4 w-4" /> Resume</>
            ) : (
              <><Pause className="mr-2 h-4 w-4" /> Pause</>
            )}
          </Button>
          <Button variant="destructive" onClick={closeAll}>
            <XCircle className="mr-2 h-4 w-4" /> Close All
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily PnL</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${daily?.total_pnl >= 0 ? 'text-success' : 'text-destructive'}`}>
              {daily?.total_pnl >= 0 ? '+' : ''}{daily?.total_pnl?.toFixed(2) || '0.00'} USDT
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {daily?.wins || 0} Wins / {daily?.losses || 0} Losses
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(daily?.win_rate ?? 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Today's accuracy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Positions</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.open_positions || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Currently active trades
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pairs Scanned</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.pairs_scanned || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Monitored markets
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
          <CardDescription>Account balance over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] w-full">
          {equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(val) => new Date(val).toLocaleDateString()} 
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                />
                <YAxis 
                  domain={['auto', 'auto']}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  labelFormatter={(val) => new Date(val).toLocaleString()}
                />
                <Area 
                  type="monotone" 
                  dataKey="equity" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorEquity)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Not enough data for chart
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
