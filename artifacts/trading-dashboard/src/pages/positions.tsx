import React from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { XCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

export default function Positions() {
  const { data: positions, loading, refetch } = useApiData<any[]>('/positions', 30000);

  const closePosition = async (symbol: string) => {
    if (!confirm(`Are you sure you want to close position for ${symbol}?`)) return;
    try {
      await apiFetch(`/position/close`, { 
        method: 'POST', 
        body: JSON.stringify({ symbol }) 
      });
      toast.success(`Closing ${symbol}`);
      refetch();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Open Positions</h2>
        <p className="text-muted-foreground">Manage currently active trades.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Trades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Entry Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Target / Stop</TableHead>
                  <TableHead className="text-right">Unrealized PnL</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!positions || positions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No open positions
                    </TableCell>
                  </TableRow>
                ) : (
                  positions.map((pos, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium flex items-center gap-2">
                        {pos.symbol}
                        {pos.asset_group && (
                          <Badge variant="outline" className="text-[10px] py-0">{pos.asset_group}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">${pos.entry_price?.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{pos.qty}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className="text-success">${pos.tp_price?.toFixed(4)}</span>
                        <br/>
                        <span className="text-destructive">${pos.sl_price?.toFixed(4)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold ${pos.unrealized_pct >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {pos.unrealized_pct >= 0 ? '+' : ''}{(pos.unrealized_pct ?? 0).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {pos.trailing_active && <Badge className="bg-primary/20 text-primary hover:bg-primary/30 mr-1">Trailing</Badge>}
                        {pos.breakeven_done && <Badge variant="secondary" className="mr-1">Breakeven</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => closePosition(pos.symbol)}>
                          <XCircle className="h-4 w-4 mr-2" />
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
