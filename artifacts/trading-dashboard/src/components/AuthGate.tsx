import React, { useState, useEffect } from 'react';
import { apiKey, apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Lock, AlertCircle, Bot, LogOut } from 'lucide-react';

/** Global helper — other components can call this to log out */
export function logout() {
  apiKey.clear();
  window.location.reload();
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  // null = still checking, true = key required, false = open (no key configured)
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ required: boolean }>('/auth/required')
      .then(({ required }) => {
        setAuthRequired(required);
        if (!required) {
          setUnlocked(true);
          return;
        }
        // Try stored key
        const stored = apiKey.get();
        if (stored) {
          apiFetch<{ valid: boolean }>('/auth/verify', {
            method: 'POST',
            body: JSON.stringify({ key: stored }),
          })
            .then(({ valid }) => {
              if (valid) {
                setUnlocked(true);
              } else {
                apiKey.clear();
              }
            })
            .catch(() => setUnlocked(true)); // offline → show dashboard anyway
        }
      })
      .catch(() => {
        // Bot offline — let user through; the API error banner will show
        setAuthRequired(false);
        setUnlocked(true);
      });
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { valid } = await apiFetch<{ valid: boolean }>('/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ key: keyInput.trim() }),
      });
      if (valid) {
        apiKey.set(keyInput.trim());
        setUnlocked(true);
      } else {
        setError('Wrong key. Check DASHBOARD_API_KEY in config.json.');
      }
    } catch {
      setError('Bot server unreachable — make sure the bot is running.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Loading splash ── */
  if (authRequired === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Bot className="h-8 w-8 animate-pulse text-primary" />
          <span className="text-sm">Connecting to bot…</span>
        </div>
      </div>
    );
  }

  /* ── Lock screen ── */
  if (!unlocked) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm border-border/60 shadow-xl">
          <CardHeader className="text-center space-y-4 pb-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary/10 p-4 ring-1 ring-primary/20">
                <Bot className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div>
              <CardTitle className="text-2xl">Trading Bot</CardTitle>
              <CardDescription className="mt-1">
                Enter your dashboard API key to continue
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="password"
                  placeholder="Paste your API key…"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="pl-9 font-mono"
                  autoFocus
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive rounded-md bg-destructive/10 p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading || !keyInput.trim()}>
                {loading ? 'Verifying…' : (
                  <><Lock className="mr-2 h-4 w-4" /> Unlock Dashboard</>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Set{' '}
                <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">
                  DASHBOARD_API_KEY
                </code>{' '}
                in <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">config.json</code>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

/** Small logout button to place in the header */
export function LogoutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={logout}
      className="text-muted-foreground hover:text-foreground"
      title="Lock dashboard"
    >
      <LogOut className="h-4 w-4" />
    </Button>
  );
}
