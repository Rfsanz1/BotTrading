import React, { useContext } from 'react';
import { LiveDataContext } from '@/components/layout/AppLayout';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Pause, XCircle, TrendingUp, TrendingDown, DollarSign, Activity, Briefcase } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { toast } from 'sonner';

export default function Overview() {
  // Primary: live SSE data (3 s updates); fallback: HTTP polling (30 s)
  const live = useContext(LiveDataContext);
  const { data: statusHttp, refetch: refetchStatus } = useApiData<any>('/status', 30_000);
  const { data: history } = useApiData<any>('/history', 120_000);

  const status = live?.status ?? statusHttp;
  const daily = {
    total_pnl:  status?.daily_pnl  ?? 0,
    wins:        status?.daily_wins  ?? 0,
    losses:      status?.daily_losses ?? 0,
    win_rate:    status?.daily_win_rate ?? 0,
  };
  const equityData: any[] = history?.equity_history ?? [];

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <p className="text-muted-foreground">Live trading status and daily snapshot.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={status?.paused ? 'default' : 'secondary'}
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

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Daily PnL"
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          value={
            <span className={daily.total_pnl >= 0 ? 'text-success' : 'text-destructive'}>
              {daily.total_pnl >= 0 ? '+' : ''}{daily.total_pnl.toFixed(2)} USDT
            </span>
          }
          sub={`${daily.wins} Wins / ${daily.losses} Losses`}
          loading={!status}
        />
        <StatCard
          title="Win Rate"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          value={`${(daily.win_rate ?? 0).toFixed(1)}%`}
          sub="Today's accuracy"
          loading={!status}
        />
        <StatCard
          title="Open Positions"
          icon={<Briefcase className="h-4 w-4 text-muted-foreground" />}
          value={`${status?.open_positions ?? 0} / ${status?.max_positions ?? '–'}`}
          sub="Active trades"
          loading={!status}
        />
        <StatCard
          title="Pairs Scanned"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          value={status?.pairs_scanned ?? 0}
          sub={status?.testnet ? '🧪 Testnet mode' : '🔴 Live mode'}
          loading={!status}
        />
      </div>

      {/* Equity curve */}
      <Card>
        <CardHeader>
          <CardTitle>Equity Curve</CardTitle>
          <CardDescription>Account balance over time</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] w-full">
          {equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(v) => new Date(v).toLocaleDateString()}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(v) => new Date(v).toLocaleString()}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, 'Equity']}
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
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Not enough equity data yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  icon,
  value,
  sub,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  sub: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-7 w-24 mb-1" />
            <Skeleton className="h-3 w-32" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground mt-1">{sub}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
