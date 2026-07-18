import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  Activity, 
  BarChart3, 
  Briefcase, 
  Clock, 
  Settings, 
  ListOrdered,
  History,
  CalendarDays,
  Menu,
  LineChart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useApiData } from '@/hooks/use-api';
import { Badge } from '@/components/ui/badge';

const NavLinks = [
  { href: '/', label: 'Overview', icon: Activity },
  { href: '/positions', label: 'Positions', icon: Briefcase },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/backtest', label: 'Backtest', icon: LineChart },
  { href: '/trades', label: 'Trade History', icon: History },
  { href: '/dca', label: 'DCA Manager', icon: ListOrdered },
  { href: '/system', label: 'System', icon: Clock },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();
  const { data: status } = useApiData<any>('/status', 30000);

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-6 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground font-bold">
          TR
        </div>
        <div>
          <h2 className="font-bold text-lg leading-tight">Nexus Bot</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${status ? (status.paused ? 'bg-amber-500' : 'bg-success') : 'bg-muted'}`} />
            <span className="text-xs text-muted-foreground">
              {status ? (status.paused ? 'Paused' : 'Running') : 'Offline'}
            </span>
            {status?.testnet && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 ml-1">TESTNET</Badge>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {NavLinks.map((item) => {
            const active = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  active 
                    ? 'bg-primary/10 text-primary' 
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function MobileSidebar() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64 border-r-0">
        <Sidebar />
      </SheetContent>
    </Sheet>
  );
}
