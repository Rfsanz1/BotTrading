import React from 'react';
import { Sidebar, MobileSidebar } from './Sidebar';
import { useApiData } from '@/hooks/use-api';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { error } = useApiData<any>('/healthz/detail');

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:block w-64 flex-shrink-0">
        <Sidebar />
      </div>
      
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 flex items-center justify-between px-4 md:px-6 border-b border-border bg-card">
          <div className="flex items-center gap-4">
            <MobileSidebar />
            <h1 className="text-xl font-semibold hidden md:block text-foreground">Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Topbar widgets could go here */}
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          {error && (
            <Alert variant="destructive" className="mb-6 bg-destructive/10 border-destructive/20 text-destructive-foreground">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>API Unreachable</AlertTitle>
              <AlertDescription>
                Cannot connect to the bot backend. Please ensure the server is running and API keys are configured.
              </AlertDescription>
            </Alert>
          )}
          <div className="max-w-6xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
