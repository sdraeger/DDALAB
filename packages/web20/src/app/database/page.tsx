'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { useHeaderVisible, useFooterVisible } from '@/store/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Database, 
  Table,
  Search,
  Play,
  Download,
  RefreshCw,
  BarChart3,
  HardDrive,
  Zap,
  AlertCircle,
  CheckCircle,
  Activity,
  Settings,
  Terminal,
  Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiService from '@/lib/api';

interface SystemHealth {
  status: string;
  message?: string;
}

function DatabaseContent() {
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sqlQuery, setSqlQuery] = useState('');
  const [executingQuery, setExecutingQuery] = useState(false);
  const [queryResult, setQueryResult] = useState<string | null>(null);

  const loadSystemInfo = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check system health
      const healthResponse = await apiService.request<SystemHealth>('/api/health');
      
      if (healthResponse.error) {
        setError(healthResponse.error);
        return;
      }
      
      setSystemHealth(healthResponse.data || null);
    } catch (err) {
      setError('Failed to load system information');
      console.error('Failed to load system info:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const handleExecuteQuery = async () => {
    if (!sqlQuery.trim()) return;
    
    setExecutingQuery(true);
    setQueryResult('Note: Direct SQL execution is not available in this interface for security reasons. Use the API endpoints or database management tools.');
    
    // Simulate query execution time
    await new Promise(resolve => setTimeout(resolve, 1000));
    setExecutingQuery(false);
  };

  const handleRefresh = () => {
    loadSystemInfo();
  };

  const getHealthColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
      case 'ok': 
        return 'bg-green-100 text-green-800';
      case 'warning': 
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
      case 'down': 
        return 'bg-red-100 text-red-800';
      default: 
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'healthy':
      case 'ok': 
        return <CheckCircle className="h-4 w-4" />;
      case 'warning': 
        return <AlertCircle className="h-4 w-4" />;
      case 'error':
      case 'down': 
        return <AlertCircle className="h-4 w-4" />;
      default: 
        return <Database className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading system information...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database & System</h1>
          <p className="text-muted-foreground">
            Monitor system health and database status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* System Health Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {systemHealth && getHealthIcon(systemHealth.status)}
            System Health Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {systemHealth ? (
            <div className="flex items-center gap-4">
              <Badge className={cn("text-sm", getHealthColor(systemHealth.status))}>
                {systemHealth.status.toUpperCase()}
              </Badge>
              <span className="text-muted-foreground">
                {systemHealth.message || 'System is operating normally'}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground">Unable to determine system health</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        {/* Database Information */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Database Information
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Connection Status</span>
                    {systemHealth && getHealthIcon(systemHealth.status)}
                  </div>
                  <p className="text-2xl font-bold mt-2">
                    {systemHealth?.status === 'ok' ? 'Connected' : 'Disconnected'}
                  </p>
                </div>
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Database Engine</span>
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-2xl font-bold mt-2">PostgreSQL</p>
                </div>
              </div>
              
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Available API Endpoints</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">User Management</span>
                    <Badge variant="secondary">/api/users</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">File Operations</span>
                    <Badge variant="secondary">/api/files</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Widget Data</span>
                    <Badge variant="secondary">/api/widget-data</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dashboard Stats</span>
                    <Badge variant="secondary">/api/dashboard</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Database Tools */}
        <div className="flex flex-col gap-6">
          {/* SQL Query Interface */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" />
                Database Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <textarea
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="Note: Direct SQL execution is not available for security. Use API endpoints to interact with data."
                  className="w-full h-24 p-3 border border-input rounded-md text-sm font-mono resize-none"
                  disabled
                />
                <div className="flex items-center gap-2">
                  <Button 
                    onClick={handleExecuteQuery} 
                    disabled={!sqlQuery.trim() || executingQuery}
                    size="sm"
                    variant="outline"
                  >
                    {executingQuery ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Test Interface
                  </Button>
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 mr-2" />
                    View Schema
                  </Button>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export Data
                  </Button>
                </div>
                {queryResult && (
                  <div className="p-3 bg-muted rounded-md text-sm">
                    {queryResult}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* System Information */}
          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                System Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Environment</span>
                    <p className="text-muted-foreground">Development</p>
                  </div>
                  <div>
                    <span className="font-medium">API Version</span>
                    <p className="text-muted-foreground">v1.0</p>
                  </div>
                  <div>
                    <span className="font-medium">Authentication</span>
                    <p className="text-muted-foreground">JWT Bearer Token</p>
                  </div>
                  <div>
                    <span className="font-medium">Last Health Check</span>
                    <p className="text-muted-foreground">
                      {new Date().toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    For database administration tasks, use dedicated database management tools 
                    or contact your system administrator.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DatabasePage() {
  const headerVisible = useHeaderVisible();
  const footerVisible = useFooterVisible();

  return (
    <AuthProvider>
      <div className="min-h-screen w-full bg-background">
        <div className="flex h-screen">
          <Sidebar />
          <div className="flex flex-col flex-1 min-w-0">
            {headerVisible && <Header />}
            <main className="flex-1 overflow-auto">
              <DatabaseContent />
            </main>
            {footerVisible && <Footer />}
          </div>
        </div>
      </div>
    </AuthProvider>
  );
}