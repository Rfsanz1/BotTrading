import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthGate } from '@/components/AuthGate';

import Overview from '@/pages/overview';
import Positions from '@/pages/positions';
import Analytics from '@/pages/analytics';
import Backtest from '@/pages/backtest';
import Trades from '@/pages/trades';
import DCAManager from '@/pages/dca';
import System from '@/pages/system';
import Schedule from '@/pages/schedule';
import Settings from '@/pages/settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },
});

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Overview} />
        <Route path="/positions" component={Positions} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/backtest" component={Backtest} />
        <Route path="/trades" component={Trades} />
        <Route path="/dca" component={DCAManager} />
        <Route path="/system" component={System} />
        <Route path="/schedule" component={Schedule} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </AuthGate>
        <Toaster theme="dark" position="top-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
