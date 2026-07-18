import React from 'react';
import { useApiData } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Cpu, HardDrive, Network, Server, Clock, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function System() {
  const { data: sys, loading } = useApiData<any>('/system', 10000);
  const { data: health } = useApiData<any>('/healthz/detail', 30000);

  const formatUptime = (seconds: number) => {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return `${d}d ${h}h ${m}m`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">System Resources</h2>
        <p className="text-muted-foreground">Monitor server vitals and bot health.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sys?.cpu_pct?.toFixed(1) || 0}%</div>
            <Progress value={sys?.cpu_pct || 0} className="h-2 mt-3" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sys?.mem_pct?.toFixed(1) || 0}%</div>
            <div className="text-xs text-muted-foreground mt-1 mb-2">
              {sys?.mem_used_gb?.toFixed(2)} GB / {sys?.mem_total_gb?.toFixed(2)} GB
            </div>
            <Progress value={sys?.mem_pct || 0} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Disk Space</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sys?.disk_pct?.toFixed(1) || 0}%</div>
            <div className="text-xs text-muted-foreground mt-1 mb-2">
              {sys?.disk_used_gb?.toFixed(2)} GB / {sys?.disk_total_gb?.toFixed(2)} GB
            </div>
            <Progress value={sys?.disk_pct || 0} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Network I/O</CardTitle>
            <Network className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-baseline gap-1">
              <span className="text-sm text-muted-foreground">In</span>
              {sys?.net_recv_mb?.toFixed(0) || 0} <span className="text-sm font-normal">MB</span>
            </div>
            <div className="text-2xl font-bold flex items-baseline gap-1 mt-1">
              <span className="text-sm text-muted-foreground">Out</span>
              {sys?.net_sent_mb?.toFixed(0) || 0} <span className="text-sm font-normal">MB</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> Runtime Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Bot Uptime</span>
              <span className="font-medium">{formatUptime(sys?.bot_uptime_sec)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Last Signal Processed</span>
              <span className="font-medium">{sys?.last_signal_ago_sec ? `${sys.last_signal_ago_sec}s ago` : 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">API Weight (1m)</span>
              <span className="font-medium">{health?.api_weight_1m || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" /> Health Checks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Bot Process</span>
              <StatusDot ok={health?.checks?.bot_running} />
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Database Access</span>
              <StatusDot ok={health?.checks?.db_accessible} />
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Pairs Loaded</span>
              <StatusDot ok={health?.checks?.pairs_loaded} />
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">API Limits Ok</span>
              <StatusDot ok={health?.checks?.api_weight_ok} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok?: boolean }) {
  if (ok === undefined) return <span className="w-3 h-3 rounded-full bg-muted animate-pulse" />;
  return (
    <span className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full ${ok ? 'bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
      <span className="text-sm font-medium">{ok ? 'OK' : 'FAIL'}</span>
    </span>
  );
}
