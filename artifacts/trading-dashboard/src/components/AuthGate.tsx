import React, { useState, useEffect } from 'react';
import { accessToken, apiFetch, ApiError, login, logoutSession } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Lock, AlertCircle, Bot, LogOut } from 'lucide-react';

/** Global helper — other components can call this to log out */
export function logout() {
  void logoutSession().catch(() => undefined).finally(() => window.location.reload());
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onExpired = () => setUnlocked(false);
    window.addEventListener('auth:expired', onExpired);
    if (accessToken.get()) {
      apiFetch('/health/readiness')
        .then(() => setUnlocked(true))
        .catch(() => accessToken.clear())
        .finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const { accessToken: token } = await login(email.trim(), password);
      accessToken.set(token);
      setPassword('');
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401
        ? 'Invalid email or password.'
        : 'Backend unavailable — the dashboard remains locked.');
    } finally {
      setLoading(false);
    }
  };

  /* ── Loading splash ── */
  if (checking) {
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
                Sign in to continue
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  autoFocus
                  autoComplete="username"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive rounded-md bg-destructive/10 p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading || !email.trim() || !password}>
                {loading ? 'Signing in…' : (
                  <><Lock className="mr-2 h-4 w-4" /> Sign in</>
                )}
              </Button>
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
