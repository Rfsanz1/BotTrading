import React, { useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Trash2, TrendingUp, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export default function DCAManager() {
  const { data: dcaList, refetch } = useApiData<any[]>('/dca', 30000);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ symbol: '', amount_usdt: 50, interval_hours: 24 });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/dca/add', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      toast.success(`DCA added for ${form.symbol}`);
      setOpen(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRemove = async (symbol: string) => {
    if (!confirm(`Remove DCA for ${symbol}?`)) return;
    try {
      await apiFetch('/dca/remove', {
        method: 'POST',
        body: JSON.stringify({ symbol })
      });
      toast.success(`Removed ${symbol}`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const triggerBuy = async (symbol: string, amount: number) => {
    try {
      const res = await apiFetch<any>('/dca/trigger', {
        method: 'POST',
        body: JSON.stringify({ symbol, amount_usdt: amount })
      });
      toast.success(`Bought ${res.qty} ${symbol} for $${res.spent.toFixed(2)}`);
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">DCA Manager</h2>
          <p className="text-muted-foreground">Dollar-cost average into long-term holdings.</p>
        </div>
        
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add DCA Plan</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>New DCA Plan</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Symbol (e.g. BTCUSDT)</Label>
                <Input 
                  value={form.symbol} 
                  onChange={(e) => setForm({...form, symbol: e.target.value.toUpperCase()})} 
                  placeholder="ETHUSDT" required 
                />
              </div>
              <div className="space-y-2">
                <Label>Buy Amount (USDT)</Label>
                <Input 
                  type="number" 
                  value={form.amount_usdt} 
                  onChange={(e) => setForm({...form, amount_usdt: Number(e.target.value)})} 
                  min={10} required 
                />
              </div>
              <div className="space-y-2">
                <Label>Interval (Hours)</Label>
                <Input 
                  type="number" 
                  value={form.interval_hours} 
                  onChange={(e) => setForm({...form, interval_hours: Number(e.target.value)})} 
                  min={1} required 
                />
              </div>
              <Button type="submit" className="w-full mt-4">Create Plan</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Symbol</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">Accumulated</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead>Next Buy</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!dcaList || dcaList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No active DCA plans. Set one up to auto-accumulate assets.
                  </TableCell>
                </TableRow>
              ) : (
                dcaList.map((dca) => (
                  <TableRow key={dca.symbol}>
                    <TableCell className="font-bold pl-6 flex items-center gap-2">
                      {dca.symbol}
                      {!dca.enabled && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">${dca.amount_usdt} every {dca.interval_hours}h</div>
                      <div className="text-xs text-muted-foreground">{dca.buy_count} buys executed</div>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {dca.total_qty.toFixed(6)}
                    </TableCell>
                    <TableCell className="text-right">
                      ${dca.total_invested.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(dca.next_buy_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => triggerBuy(dca.symbol, dca.amount_usdt)}>
                          <TrendingUp className="h-4 w-4 mr-1" /> Buy Now
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => handleRemove(dca.symbol)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
