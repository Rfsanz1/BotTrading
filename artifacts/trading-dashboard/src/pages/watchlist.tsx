import React, { useEffect, useState, useCallback } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Star, Bell, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

type WatchItem = {
  symbol: string;
  favorite?: boolean;
  notify?: boolean;
};

const STORAGE_KEY = 'watchlist_v1';

export default function Watchlist() {
  const { data: remote = [], refetch } = useApiData<WatchItem[]>('/watchlist');
  const [list, setList] = useState<WatchItem[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    // prefer remote, fall back to localStorage
    if (remote && remote.length > 0) {
      setList(remote);
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setList(JSON.parse(raw));
      } catch (e) {
        setList([]);
      }
    }
  }, [remote]);

  const persist = useCallback(async (next: WatchItem[]) => {
    setList(next);
    try {
      await apiFetch('/watchlist', { method: 'PUT', body: JSON.stringify(next) });
    } catch (e) {
      // fallback to localStorage
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
    }
  }, []);

  const addSymbol = async () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    if (list.find((l) => l.symbol === sym)) { toast.error('Symbol already in watchlist'); return; }
    const next = [{ symbol: sym, favorite: false, notify: false }, ...list];
    await persist(next);
    setInput('');
    toast.success(`${sym} added to watchlist`);
    refetch();
  };

  const remove = async (symbol: string) => {
    const next = list.filter((l) => l.symbol !== symbol);
    await persist(next);
    toast.success(`${symbol} removed`);
  };

  const toggleFavorite = async (symbol: string) => {
    const next = list.map((l) => l.symbol === symbol ? { ...l, favorite: !l.favorite } : l);
    // reorder favorites first
    next.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    await persist(next);
  };

  const toggleNotify = async (symbol: string) => {
    const next = list.map((l) => l.symbol === symbol ? { ...l, notify: !l.notify } : l);
    setList(next);
    try {
      const item = next.find((i) => i.symbol === symbol);
      await apiFetch('/watchlist/notify', { method: 'POST', body: JSON.stringify({ symbol, enabled: item?.notify }) });
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
    }
  };

  const move = async (symbol: string, dir: 'up' | 'down') => {
    const idx = list.findIndex((l) => l.symbol === symbol);
    if (idx === -1) return;
    const next = [...list];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    await persist(next);
  };

  const subscribeAll = async (enable: boolean) => {
    const next = list.map((l) => ({ ...l, notify: enable }));
    setList(next);
    try {
      await apiFetch('/watchlist/notify/bulk', { method: 'POST', body: JSON.stringify({ symbols: next.map((s) => s.symbol), enabled: enable }) });
    } catch (e) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Watchlist</h2>
        <p className="text-muted-foreground">Add symbols to watch, mark favorites, and enable notifications.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>Manage Watchlist</CardTitle>
          <CardDescription className="hidden sm:block">You can persist your watchlist to the server or fallback to local storage.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Input placeholder="Add symbol (e.g. BTCUSD)" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSymbol(); }} />
            <Button onClick={addSymbol}>Add</Button>
            <Button variant="ghost" onClick={() => subscribeAll(true)}>Subscribe All</Button>
            <Button variant="ghost" onClick={() => subscribeAll(false)}>Unsubscribe All</Button>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-center">Fav</TableHead>
                  <TableHead className="text-center">Notify</TableHead>
                  <TableHead className="text-center">Order</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No symbols in watchlist</TableCell>
                  </TableRow>
                ) : (
                  list.map((item) => (
                    <TableRow key={item.symbol} className="hover:bg-muted/20">
                      <TableCell className="font-medium">{item.symbol}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => toggleFavorite(item.symbol)} title="Toggle favorite">
                          <Star className={`${item.favorite ? 'text-amber-400' : 'text-muted-foreground'} h-4 w-4`} />
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => toggleNotify(item.symbol)} title="Toggle notifications">
                          <Bell className={`${item.notify ? 'text-success' : 'text-muted-foreground'} h-4 w-4`} />
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => move(item.symbol, 'up')} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => move(item.symbol, 'down')} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="destructive" size="sm" onClick={() => remove(item.symbol)}>
                          <Trash2 className="h-4 w-4 mr-1" /> Remove
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
