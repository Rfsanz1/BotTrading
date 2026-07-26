import React, { useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

type Signal = {
  id: string;
  timestamp: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | string;
  entry_price?: number;
  sl_price?: number;
  tp_price?: number;
  confidence?: number; // 0-100
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | string;
  consensus?: Record<string, number> | null; // e.g. {modelA:70,modelB:60}
};

export default function Signals() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const { data: signals = [], loading, refetch } = useApiData<Signal[]>(`/signals?type=${typeFilter !== 'ALL' ? typeFilter : ''}&symbol=${symbolFilter}`);

  const [selected, setSelected] = useState<Signal | null>(null);

  const avgConsensus = (c?: Record<string, number> | null) => {
    if (!c) return null;
    const vals = Object.values(c);
    if (vals.length === 0) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const getRiskBadge = (risk?: string) => {
    if (!risk) return <Badge>—</Badge>;
    if (risk === 'HIGH') return <Badge className="bg-destructive/10 text-destructive">HIGH</Badge>;
    if (risk === 'MEDIUM') return <Badge className="bg-amber-100 text-amber-700">MED</Badge>;
    return <Badge className="bg-success/10 text-success">LOW</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Signals</h2>
        <p className="text-muted-foreground">Realtime trading signals from AI ensemble.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>Signals</CardTitle>
          <div className="flex gap-2 w-full sm:w-auto">
            <Input placeholder="Filter symbol..." value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} className="max-w-[150px]" />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="BUY">Buy</SelectItem>
                <SelectItem value="SELL">Sell</SelectItem>
                <SelectItem value="HOLD">Hold</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">SL</TableHead>
                  <TableHead className="text-right">TP</TableHead>
                  <TableHead className="text-center">Confidence</TableHead>
                  <TableHead className="text-center">Risk</TableHead>
                  <TableHead className="text-center">AI Consensus</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!signals || signals.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No signals</TableCell>
                  </TableRow>
                ) : (
                  signals.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/20">
                      <TableCell className="text-muted-foreground text-sm">{new Date(s.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{s.symbol}</TableCell>
                      <TableCell>
                        <Badge className={`text-sm ${s.signal === 'BUY' ? 'bg-success/10 text-success' : s.signal === 'SELL' ? 'bg-destructive/10 text-destructive' : 'bg-muted/10 text-muted-foreground'}`}>{s.signal}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.entry_price ? `$${s.entry_price.toFixed(4)}` : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.sl_price ? `$${s.sl_price.toFixed(4)}` : '-'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.tp_price ? `$${s.tp_price.toFixed(4)}` : '-'}</TableCell>
                      <TableCell className="text-center">
                        <div className="text-sm font-semibold">{typeof s.confidence === 'number' ? `${s.confidence.toFixed(1)}%` : '-'}</div>
                      </TableCell>
                      <TableCell className="text-center">{getRiskBadge(s.risk_level)}</TableCell>
                      <TableCell className="text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">
                              {typeof avgConsensus(s.consensus) === 'number' ? `${avgConsensus(s.consensus)!.toFixed(1)}%` : '-'}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {s.consensus ? (
                              <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(s.consensus, null, 2)}</pre>
                            ) : (
                              <div className="text-sm">No consensus data</div>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog open={selected?.id === s.id} onOpenChange={(v) => { if (!v) setSelected(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" onClick={() => setSelected(s)}>Details</Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[600px]">
                            <DialogHeader>
                              <DialogTitle>Signal Details</DialogTitle>
                            </DialogHeader>
                            <div className="mt-2">
                              <div className="text-sm"><strong>Symbol:</strong> {selected?.symbol}</div>
                              <div className="text-sm"><strong>Signal:</strong> {selected?.signal}</div>
                              <div className="text-sm"><strong>Confidence:</strong> {selected?.confidence ?? '-'}%</div>
                              <div className="text-sm mt-2"><strong>Consensus:</strong></div>
                              <pre className="rounded bg-muted p-3 text-sm overflow-auto">{selected?.consensus ? JSON.stringify(selected.consensus, null, 2) : '—'}</pre>
                            </div>
                            <div className="mt-4 flex justify-end">
                              <DialogClose asChild>
                                <Button variant="ghost">Close</Button>
                              </DialogClose>
                            </div>
                          </DialogContent>
                        </Dialog>
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
