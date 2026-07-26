import React, { useMemo, useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Toggle } from '@/components/ui/toggle';
import { toast } from 'sonner';

export default function Risk() {
  // Fetch positions to calculate exposure
  const { data: positions = [] } = useApiData<any[]>('/positions');

  // Position size calculator state
  const [account, setAccount] = useState<number>(1000);
  const [riskPct, setRiskPct] = useState<number>(1); // percent
  const [entryPrice, setEntryPrice] = useState<number | ''>('');
  const [stopPrice, setStopPrice] = useState<number | ''>('');
  const [leverage, setLeverage] = useState<number>(1);

  // Risk settings
  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(50);
  const [drawdownProtectionEnabled, setDrawdownProtectionEnabled] = useState<boolean>(false);
  const [drawdownThreshold, setDrawdownThreshold] = useState<number>(10); // percent

  // Exposure
  const exposure = useMemo(() => {
    return positions.reduce((s, p) => s + ((p.entry_price ?? 0) * (p.qty ?? 0)), 0);
  }, [positions]);

  const riskPerTradeAmt = useMemo(() => (account * (riskPct / 100)), [account, riskPct]);

  const positionSize = useMemo(() => {
    if (!entryPrice || !stopPrice || entryPrice === 0) return { qty: 0, margin: 0 };
    const riskPerUnit = Math.abs(entryPrice - stopPrice);
    if (riskPerUnit === 0) return { qty: 0, margin: 0 };
    const qty = (riskPerTradeAmt / riskPerUnit) * leverage;
    const margin = (entryPrice * qty) / leverage;
    return { qty, margin };
  }, [entryPrice, stopPrice, riskPerTradeAmt, leverage]);

  const saveSettings = async () => {
    try {
      await apiFetch('/risk/settings', { method: 'POST', body: JSON.stringify({ maxDailyLoss, drawdownProtectionEnabled, drawdownThreshold }) });
      toast.success('Risk settings saved');
    } catch (e: any) {
      toast.error(e.message || 'Failed to save settings');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Risk Management</h2>
        <p className="text-muted-foreground">Tools to control position sizing, daily loss limits, drawdown protection and exposure.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Position Size Calculator</CardTitle>
            <CardDescription>Calculate recommended position size based on account risk.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={account} onChange={(e) => setAccount(Number(e.target.value))} placeholder="Account balance" />
                <Input type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} placeholder="Risk %" />
                <Input type="number" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Entry price" />
                <Input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Stop loss price" />
                <Input type="number" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} placeholder="Leverage" />
              </div>

              <div className="pt-2">
                <div className="text-sm">Risk per trade: <strong>${riskPerTradeAmt.toFixed(2)}</strong></div>
                <div className="text-sm">Recommended qty: <strong>{positionSize.qty ? positionSize.qty.toFixed(4) : '—'}</strong></div>
                <div className="text-sm">Estimated margin: <strong>${positionSize.margin ? positionSize.margin.toFixed(2) : '—'}</strong></div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exposure Monitoring</CardTitle>
            <CardDescription>Overview of current exposure across positions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm">Total exposure (notional): <strong>${exposure.toFixed(2)}</strong></div>
              <div className="text-sm">Open positions: <strong>{positions.length}</strong></div>
              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right">Notional</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.symbol}</TableCell>
                        <TableCell className="text-right">${((p.entry_price ?? 0) * (p.qty ?? 0)).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Maximum Daily Loss</CardTitle>
            <CardDescription>Set a hard cap for daily losses.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(Number(e.target.value))} placeholder="Max daily loss ($)" />
              <div className="flex gap-2 mt-2">
                <Button onClick={saveSettings}>Save</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Drawdown Protection</CardTitle>
            <CardDescription>Disable trading or reduce risk after drawdown threshold.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-sm">Enabled</label>
                <Toggle pressed={drawdownProtectionEnabled} onPressedChange={(v) => setDrawdownProtectionEnabled(!!v)} />
              </div>
              <Input type="number" value={drawdownThreshold} onChange={(e) => setDrawdownThreshold(Number(e.target.value))} placeholder="Drawdown %" />
              <div className="text-sm text-muted-foreground">If current drawdown exceeds this value the bot will reduce position sizing or stop new trades (requires backend enforcement).</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk Per Trade</CardTitle>
          <CardDescription>Quick calculator for dollar risk per trade.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input type="number" value={account} onChange={(e) => setAccount(Number(e.target.value))} placeholder="Account balance" />
            <Input type="number" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} placeholder="Risk %" />
            <div className="flex items-center">
              <div className="text-sm">${riskPerTradeAmt.toFixed(2)}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
