"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function PersistenceDebugger() {
  const [localStorageData, setLocalStorageData] = useState<Record<string, any>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [mounted, setMounted] = useState(false);

  const refreshData = () => {
    if (typeof window === 'undefined') return;
    
    const data: Record<string, any> = {};
    const keys = Object.keys(localStorage).filter(key => key.startsWith('web30-'));
    
    keys.forEach(key => {
      try {
        data[key] = JSON.parse(localStorage.getItem(key) || '{}');
      } catch (error) {
        data[key] = localStorage.getItem(key);
      }
    });
    
    setLocalStorageData(data);
    setRefreshKey(prev => prev + 1);
  };

  useEffect(() => {
    setMounted(true);
    refreshData();
    // Refresh every 2 seconds to see live updates
    const interval = setInterval(refreshData, 2000);
    return () => clearInterval(interval);
  }, []);

  const clearStorage = () => {
    if (typeof window === 'undefined') return;
    
    const keys = Object.keys(localStorage).filter(key => key.startsWith('web30-'));
    keys.forEach(key => localStorage.removeItem(key));
    refreshData();
  };

  // Don't render until mounted to avoid hydration issues
  if (!mounted) {
    return null;
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 max-h-96 overflow-auto z-50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Persistence Debug</CardTitle>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={refreshData}>
              Refresh
            </Button>
            <Button size="sm" variant="destructive" onClick={clearStorage}>
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-xs space-y-2">
          {Object.keys(localStorageData).length === 0 ? (
            <p className="text-muted-foreground">No web30 data in localStorage</p>
          ) : (
            Object.entries(localStorageData).map(([key, value]) => (
              <div key={key} className="border rounded p-2">
                <div className="font-mono font-bold text-xs mb-1">{key}</div>
                <pre className="text-xs overflow-x-auto bg-muted p-1 rounded">
                  {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-2">
          Auto-refresh: {refreshKey} | {new Date().toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}