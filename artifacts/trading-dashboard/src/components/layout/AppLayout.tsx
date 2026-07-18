import React from 'react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { useSSE } from '@/hooks/use-sse';
import { LogoutButton } from '@/components/AuthGate';
import { AlertCircle, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type LivePayload = { status: Record<string, unknown>; positions: unknown[] };

function LiveIndicator({ sse }: { sse: ReturnType<typeof useSSE<LivePayload>> }) {
  const { status } = sse;
  if (status === 'connected') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5 text-success border-success/30 bg-success/10 cursor-default select-none">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            Live
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Real-time data via SSE</TooltipContent>
      </Tooltip>
    );
  }
  if (status === 'reconnecting') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1.5 text-warning border-warning/30 bg-warning/10 cursor-default select-none">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reconnecting
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Stream interrupted — reconnecting…</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className="gap-1.5 text-muted-foreground cursor-default select-none">
          <WifiOff className="h-3 w-3" />
          Offline
        </Badge>
      </TooltipTrigger>
      <TooltipContent>Cannot reach bot server</TooltipContent>
    </Tooltip>
  );
}

/**
 * AppLayout — wraps every dashboard page.
 * Opens a single shared SSE connection and passes live data via context.
 */
export const LiveDataContext = React.createContext<LivePayload | null>(null);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const sse = useSSE<LivePayload>('/events');
  const offline = sse.status === 'reconnecting' || (sse.status === 'connecting' && !sse.data);

  return (
    <LiveDataContext.Provider value={sse.data}>
      <div className="flex h-screen overflow-hidden bg-background">
        <div className="hidden md:block w-64 flex-shrink-0">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 flex items-center justify-between px-4 md:px-6 border-b border-border bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
            <div className="flex items-center gap-4">
              <MobileSidebar />
              <h1 className="text-base font-semibold hidden md:block text-foreground">
                Trading Bot
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <LiveIndicator sse={sse} />
              <LogoutButton />
            </div>
          </header>

          <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
            {offline && (
              <Alert variant="destructive" className="mb-6 bg-destructive/10 border-destructive/20 text-destructive-foreground">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Bot Offline</AlertTitle>
                <AlertDescription>
                  Cannot reach the bot backend. Make sure the bot is running and API keys are configured.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-w-6xl mx-auto space-y-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </LiveDataContext.Provider>
  );
}
