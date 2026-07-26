import React, { useEffect, useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationNext, PaginationLink } from '@/components/ui/pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type Order = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  filled_qty?: number;
  status: string;
  timestamp: string;
};

export default function Orders() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const endpoint = `/orders?status=${statusFilter !== 'ALL' ? statusFilter : ''}&symbol=${symbolFilter}&page=${page}&limit=${limit}`;
  const { data: orders, loading, refetch } = useApiData<Order[]>(endpoint);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<any | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [symbolFilter, statusFilter]);

  useEffect(() => {
    if (!selectedId) return setDetails(null);
    let cancelled = false;
    (async () => {
      try {
        const d = await apiFetch<any>(`/orders/${selectedId}`);
        if (!cancelled) setDetails(d);
      } catch (err) {
        console.error('Failed fetching order details', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const openDetails = (id: string) => {
    setSelectedId(id);
    setDetailsOpen(true);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
    setSelectedId(null);
    setDetails(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Orders</h2>
        <p className="text-muted-foreground">View active, filled, cancelled and pending orders.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>Orders</CardTitle>
          <div className="flex gap-2 w-full sm:w-auto">
            <Input
              placeholder="Filter symbol..."
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="max-w-[150px]"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="FILLED">Filled</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { setPage(1); refetch(); }} className="ml-2">Refresh</Button>
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
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!orders || orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No orders found matching criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="text-muted-foreground text-sm">{new Date(o.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{o.symbol}</TableCell>
                      <TableCell>
                        <span className={o.side === 'BUY' ? 'text-success font-semibold' : 'text-destructive font-semibold'}>{o.side}</span>
                      </TableCell>
                      <TableCell className="text-right">{o.price?.toFixed ? `$${o.price.toFixed(4)}` : o.price}</TableCell>
                      <TableCell className="text-right">{o.qty}</TableCell>
                      <TableCell className="text-right">{o.filled_qty ?? 0}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{o.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Dialog open={detailsOpen && selectedId === o.id} onOpenChange={(v) => { if (!v) closeDetails(); }}>
                          <DialogTrigger asChild>
                            <Button size="sm" onClick={() => openDetails(o.id)}>Details</Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-[600px]">
                            <DialogHeader>
                              <DialogTitle>Order Details</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-2 mt-2">
                              {selectedId === o.id && details ? (
                                <pre className="rounded bg-muted p-3 text-sm overflow-auto">{JSON.stringify(details, null, 2)}</pre>
                              ) : (
                                <div className="text-sm text-muted-foreground">Loading details…</div>
                              )}
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

          <div className="mt-4">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink className="px-3">Page {page}</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext onClick={() => setPage((p) => p + 1)} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
