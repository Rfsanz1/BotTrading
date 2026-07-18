import React, { useEffect, useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, ShieldAlert, Database, History, Download } from 'lucide-react';
import { toast } from 'sonner';

export default function Settings() {
  const { data: configData, refetch: refetchConfig } = useApiData<any>('/config');
  const { data: backups, refetch: refetchBackups } = useApiData<any[]>('/backup/list');
  const { data: auditLogs } = useApiData<any[]>('/audit?limit=20');
  
  const [config, setConfig] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (configData) setConfig(configData);
  }, [configData]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiFetch('/config/save', {
        method: 'POST',
        body: JSON.stringify(config)
      });
      toast.success('Configuration saved');
      refetchConfig();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const createBackup = async () => {
    try {
      const res = await apiFetch<any>('/backup', { method: 'POST' });
      toast.success(`Backup created: ${res.file}`);
      refetchBackups();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">System Settings</h2>
        <p className="text-muted-foreground">Manage bot configuration, security, and data.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General & Exchange</TabsTrigger>
          <TabsTrigger value="risk">Risk Management</TabsTrigger>
          <TabsTrigger value="data">Data & Backups</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Exchange API Setup</CardTitle>
              <CardDescription>Requires restart to take effect.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Exchange Integration</Label>
                <Select value={config.exchange || 'binance'} onValueChange={(v) => setConfig({...config, exchange: v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="binance">Binance</SelectItem>
                    <SelectItem value="bybit">Bybit</SelectItem>
                    <SelectItem value="kraken">Kraken</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>API Key {configData?.has_api_key && <span className="text-success text-xs ml-2">(Configured)</span>}</Label>
                <Input 
                  type="password" 
                  placeholder={configData?.has_api_key ? "••••••••••••••••" : "Enter API Key"}
                  value={config.api_key || ''}
                  onChange={(e) => setConfig({...config, api_key: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label>API Secret {configData?.has_api_secret && <span className="text-success text-xs ml-2">(Configured)</span>}</Label>
                <Input 
                  type="password" 
                  placeholder={configData?.has_api_secret ? "••••••••••••••••" : "Enter API Secret"}
                  value={config.api_secret || ''}
                  onChange={(e) => setConfig({...config, api_secret: e.target.value})}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Trading Parameters</CardTitle>
              <CardDescription>Global limits applied to all strategies.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Capital Allocation % per Trade</Label>
                <Input type="number" value={config.capital_pct || ''} onChange={(e) => setConfig({...config, capital_pct: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <Label>Minimum Confidence Threshold %</Label>
                <Input type="number" value={config.confidence_min || ''} onChange={(e) => setConfig({...config, confidence_min: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <Label>Global Take Profit %</Label>
                <Input type="number" step="0.1" value={config.tp_pct || ''} onChange={(e) => setConfig({...config, tp_pct: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <Label>Global Stop Loss %</Label>
                <Input type="number" step="0.1" value={config.sl_pct || ''} onChange={(e) => setConfig({...config, sl_pct: Number(e.target.value)})} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Database Backups</CardTitle>
                <CardDescription>Local SQLite database snapshots.</CardDescription>
              </div>
              <Button onClick={createBackup} variant="secondary">
                <Database className="h-4 w-4 mr-2" /> Backup Now
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!backups?.length ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No backups found</TableCell></TableRow>
                  ) : (
                    backups.map(b => (
                      <TableRow key={b.file}>
                        <TableCell className="font-mono text-sm">{b.file}</TableCell>
                        <TableCell>{new Date(b.modified).toLocaleString()}</TableCell>
                        <TableCell className="text-right">{(b.size_bytes / 1024 / 1024).toFixed(2)} MB</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Security Audit Log</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>User/System</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs?.map(log => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="font-medium">{log.action}</TableCell>
                      <TableCell>{log.user}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{log.details}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveConfig} disabled={saving} className="w-full sm:w-auto px-8">
          <Save className="mr-2 h-4 w-4" /> Save Configuration
        </Button>
      </div>
    </div>
  );
}
