import React, { useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Trades() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('ALL');
  const { data: trades, loading } = useApiData<any[]>(`/trades?days=30&limit=200&result=${resultFilter !== 'ALL' ? resultFilter : ''}&symbol=${symbolFilter}`);

  const getResultColor = (res: string) => {
    if (res.includes('TP')) return 'bg-success/20 text-success border-success/30';
    if (res.includes('SL')) return 'bg-destructive/20 text-destructive border-destructive/30';
    return 'bg-muted text-muted-foreground border-muted';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Trade History</h2>
        <p className="text-muted-foreground">Log of all completed trades.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>History</CardTitle>
          <div className="flex gap-2 w-full sm:w-auto">
            <Input 
              placeholder="Filter symbol..." 
              value={symbolFilter} 
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="max-w-[150px]"
            />
            <Select value={resultFilter} onValueChange={setResultFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Result Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Results</SelectItem>
                <SelectItem value="CLOSED_TP">Take Profit</SelectItem>
                <SelectItem value="CLOSED_SL">Stop Loss</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-center">Signal Conf.</TableHead>
                  <TableHead className="text-center">Result</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!trades || trades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No trades found matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  trades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(trade.timestamp).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{trade.symbol}</TableCell>
                      <TableCell>
                        <span className={trade.side === 'BUY' ? 'text-success font-semibold' : 'text-destructive font-semibold'}>
                          {trade.side}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">${trade.price.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{trade.qty}</TableCell>
                      <TableCell className="text-center text-sm">{trade.confidence}%</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={getResultColor(trade.result)}>
                          {trade.result.replace('CLOSED_', '')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <span className={trade.pnl >= 0 ? 'text-success' : 'text-destructive'}>
                          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} 
                          <span className="text-xs ml-1 font-normal opacity-70">
                            ({(trade.pnl_pct ?? 0).toFixed(2)}%)
                          </span>
                        </span>
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
