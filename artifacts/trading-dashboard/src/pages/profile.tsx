import React, { useEffect, useState } from 'react';
import { useApiData } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function Profile() {
  const { data: user, refetch: refetchUser } = useApiData<any>('/user');
  const { data: subs } = useApiData<any>('/subscription');
  const { data: exchanges = [] } = useApiData<any[]>('/exchanges');
  const { data: status } = useApiData<any>('/status');
  const { data: activity = [] } = useApiData<any[]>('/audit?limit=50');

  const [saving, setSaving] = useState(false);
  const [twofaEnabled, setTwofaEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (user) setTwofaEnabled(!!user.twofa_enabled);
  }, [user]);

  const disconnectExchange = async (id: string) => {
    if (!confirm(`Disconnect ${id}?`)) return;
    try {
      await apiFetch(`/exchanges/${id}/disconnect`, { method: 'POST' });
      toast.success('Exchange disconnected');
      refetchUser();
    } catch (e: any) { toast.error(e.message); }
  };

  const regenerateApiKey = async () => {
    if (!confirm('Regenerate API key? This will invalidate the existing key.')) return;
    try {
      const res = await apiFetch('/user/api/regenerate', { method: 'POST' });
      toast.success('API key regenerated');
      refetchUser();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggle2FA = async () => {
    try {
      setSaving(true);
      const enable = !twofaEnabled;
      await apiFetch('/user/2fa', { method: 'POST', body: JSON.stringify({ enable }) });
      setTwofaEnabled(enable);
      toast.success(`2FA ${enable ? 'enabled' : 'disabled'}`);
      refetchUser();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Profile</h2>
        <p className="text-muted-foreground">Account details, subscription, connected exchanges and security.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Basic account information.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm">Email: <strong>{user?.email ?? '—'}</strong></div>
              <div className="text-sm">Name: <strong>{user?.name ?? '—'}</strong></div>
              <div className="text-sm">Member since: <strong>{user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</strong></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Plan and billing details.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm">Plan: <strong>{subs?.plan ?? 'Free'}</strong></div>
              <div className="text-sm">Status: <Badge className={subs?.active ? 'bg-success/10 text-success' : 'bg-muted/10 text-muted-foreground'}>{subs?.active ? 'Active' : 'Inactive'}</Badge></div>
              <div className="text-sm">Renews: <strong>{subs?.renewal_date ?? '—'}</strong></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected Exchanges</CardTitle>
          <CardDescription>Manage your exchange connections and API status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Exchange</TableHead>
                <TableHead className="text-center">API Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exchanges.map((ex) => (
                <TableRow key={ex.id}>
                  <TableCell className="font-medium">{ex.name}</TableCell>
                  <TableCell className="text-center">{ex.connected ? <Badge className="bg-success/10 text-success">Connected</Badge> : <Badge>Disconnected</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => regenerateApiKey()}>Regenerate Key</Button>
                      <Button variant="destructive" size="sm" onClick={() => disconnectExchange(ex.id)}>Disconnect</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>API Status</CardTitle>
            <CardDescription>Bot connection and API health.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="text-sm">Bot status: {status ? (status.paused ? <Badge className="bg-amber-100 text-amber-700">Paused</Badge> : <Badge className="bg-success/10 text-success">Running</Badge>) : <Badge>Offline</Badge>}</div>
              <div className="text-sm">API reachable: <strong>{status?.api_ok ? 'Yes' : 'No'}</strong></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>Two-factor authentication and API keys.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Two-Factor Authentication</div>
                  <div className="text-xs text-muted-foreground">Protect your account with an authenticator app.</div>
                </div>
                <div>
                  <Button onClick={toggle2FA} disabled={saving}>{twofaEnabled ? 'Disable 2FA' : 'Enable 2FA'}</Button>
                </div>
              </div>
              <div>
                <div className="text-sm">API Key: <span className="font-mono">{user?.api_key ? '••••••••••' : 'Not set'}</span></div>
                <div className="mt-2"><Button size="sm" onClick={regenerateApiKey}>Regenerate API Key</Button></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity History</CardTitle>
          <CardDescription>Recent account and system events.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="font-medium">{a.action}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{a.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
