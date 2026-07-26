import React, { useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { List, ListItem } from '@/components/ui/list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';

type NewsItem = {
  id: string;
  title: string;
  source?: string;
  summary?: string;
  url?: string;
  timestamp?: string;
  category?: string;
  impact?: 'low' | 'medium' | 'high' | string;
};

export default function News() {
  const [q, setQ] = useState('');
  const { data: crypto = [], refetch: refetchCrypto } = useApiData<NewsItem[]>(`/news?source=crypto&limit=20&q=${encodeURIComponent(q)}`);
  const { data: forex = [], refetch: refetchForex } = useApiData<NewsItem[]>(`/news?source=forex&limit=20&q=${encodeURIComponent(q)}`);
  const { data: stocks = [], refetch: refetchStocks } = useApiData<NewsItem[]>(`/news?source=stocks&limit=20&q=${encodeURIComponent(q)}`);
  const { data: calendar = [] } = useApiData<any[]>('/calendar?days=7');
  const { data: alerts = [] } = useApiData<any[]>('/alerts');

  const [selected, setSelected] = useState<NewsItem | null>(null);

  const refreshAll = () => {
    refetchCrypto(); refetchForex(); refetchStocks();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Market News & Calendar</h2>
        <p className="text-muted-foreground">Crypto, Forex, Stocks, and economic events aggregated in one place.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>News Feed</CardTitle>
          <div className="flex gap-2 w-full sm:w-auto">
            <Input placeholder="Search headlines..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-[300px]" />
            <Button onClick={refreshAll}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Crypto News</h3>
              <List>
                {(crypto || []).map((n) => (
                  <ListItem key={n.id} className="py-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{n.title}</div>
                        <div className="text-xs text-muted-foreground">{n.source} • {n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</div>
                      </div>
                      <div className="ml-2">
                        <Dialog open={selected?.id === n.id} onOpenChange={(v) => { if (!v) setSelected(null); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" onClick={() => setSelected(n)}>Open</Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[700px]">
                            <DialogHeader>
                              <DialogTitle>{n.title}</DialogTitle>
                            </DialogHeader>
                            <div className="mt-2">
                              <p className="text-sm text-muted-foreground">{n.source} • {n.timestamp}</p>
                              <div className="mt-3 text-sm">{n.summary}</div>
                              {n.url && <div className="mt-3"><a href={n.url} target="_blank" rel="noreferrer" className="text-primary">Read original</a></div>}
                            </div>
                            <div className="mt-4 flex justify-end">
                              <DialogClose asChild>
                                <Button variant="ghost">Close</Button>
                              </DialogClose>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </ListItem>
                ))}
              </List>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Forex News</h3>
              <List>
                {(forex || []).map((n) => (
                  <ListItem key={n.id} className="py-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{n.title}</div>
                        <div className="text-xs text-muted-foreground">{n.source} • {n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</div>
                      </div>
                      <div className="ml-2">
                        <Button size="sm" onClick={() => setSelected(n)}>Open</Button>
                      </div>
                    </div>
                  </ListItem>
                ))}
              </List>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Stock News</h3>
              <List>
                {(stocks || []).map((n) => (
                  <ListItem key={n.id} className="py-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{n.title}</div>
                        <div className="text-xs text-muted-foreground">{n.source} • {n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</div>
                      </div>
                      <div className="ml-2">
                        <Button size="sm" onClick={() => setSelected(n)}>Open</Button>
                      </div>
                    </div>
                  </ListItem>
                ))}
              </List>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Economic Calendar</CardTitle>
            <CardDescription>Upcoming economic events for the next 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <List>
              {(calendar || []).map((ev: any, i: number) => (
                <ListItem key={i} className="py-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{ev.title}</div>
                      <div className="text-xs text-muted-foreground">{ev.country} • {new Date(ev.time).toLocaleString()}</div>
                    </div>
                    <div className={`ml-2 text-sm ${ev.impact === 'high' ? 'text-destructive' : ev.impact === 'medium' ? 'text-amber-600' : 'text-muted-foreground'}`}>{ev.impact?.toUpperCase()}</div>
                  </div>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Market Alerts</CardTitle>
            <CardDescription>Ad-hoc alerts and high-impact market messages.</CardDescription>
          </CardHeader>
          <CardContent>
            <List>
              {(alerts || []).map((a: any, i: number) => (
                <ListItem key={i} className="py-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground">{a.source} • {a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</div>
                      <div className="text-sm mt-1 text-muted-foreground">{a.summary}</div>
                    </div>
                    <div className={`ml-2 text-sm ${a.severity === 'high' ? 'text-destructive' : 'text-muted-foreground'}`}>{a.severity?.toUpperCase()}</div>
                  </div>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
