import React, { useContext } from 'react';
import { LiveDataContext } from '@/components/layout/AppLayout';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { XCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type Position = {
  symbol: string;
  entry_price: number;
  qty: number;
  tp_price: number;
  sl_price: number;
  unrealized_pct: number;
  trailing_active: boolean;
  breakeven_done: boolean;
  asset_group?: string;
};

export default function Positions() {
  // Live via SSE; HTTP polling as cold fallback
  const live = useContext(LiveDataContext);
  const { data: posHttp, loading, refetch } = useApiData<Position[]>('/positions', 30_000);

  const positions: Position[] = (live?.positions as Position[] | undefined) ?? posHttp ?? [];
  const isLoading = !live && loading;

  const closePosition = async (symbol: string) => {
    if (!confirm(`Close position for ${symbol}?`)) return;
    try {
      await apiFetch(`/position/close`, { method: 'POST', body: JSON.stringify({ symbol }) });
      toast.success(`Closing ${symbol}…`);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Open Positions</h2>
          <p className="text-muted-foreground">Manage currently active trades.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={refetch} title="Force refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Trades</CardTitle>
          <CardDescription>
            {positions.length === 0
              ? 'No open positions'
              : `${positions.length} position${positions.length > 1 ? 's' : ''} open`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">TP / SL</TableHead>
                  <TableHead className="text-right">Unrealized</TableHead>
                  <TableHead className="text-center">Flags</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : positions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      No open positions right now
                    </TableCell>
                  </TableRow>
                ) : (
                  positions.map((pos, i) => (
                    <TableRow key={i} className="hover:bg-muted/20">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {pos.symbol}
                          {pos.asset_group && (
                            <Badge variant="outline" className="text-[10px] py-0">
                              {pos.asset_group}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${pos.entry_price?.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {pos.qty}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono leading-5">
                        <span className="text-success">${pos.tp_price?.toFixed(4)}</span>
                        <br />
                        <span className="text-destructive">${pos.sl_price?.toFixed(4)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`font-semibold text-sm ${
                            (pos.unrealized_pct ?? 0) >= 0 ? 'text-success' : 'text-destructive'
                          }`}
                        >
                          {(pos.unrealized_pct ?? 0) >= 0 ? '+' : ''}
                          {(pos.unrealized_pct ?? 0).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex gap-1 justify-center flex-wrap">
                          {pos.trailing_active && (
                            <Badge className="bg-primary/20 text-primary hover:bg-primary/30 text-[10px]">
                              Trailing
                            </Badge>
                          )}
                          {pos.breakeven_done && (
                            <Badge variant="secondary" className="text-[10px]">
                              Breakeven
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => closePosition(pos.symbol)}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Close
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
