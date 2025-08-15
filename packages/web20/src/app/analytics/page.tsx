'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { useHeaderVisible, useFooterVisible } from '@/store/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  BarChart3, 
  TrendingUp, 
  Users, 
  Database, 
  Activity,
  Clock,
  Download,
  RefreshCw 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiService from '@/lib/api';

interface DashboardStats {
  totalArtifacts: number;
  totalAnalyses: number;
  activeUsers: number;
  systemHealth: string;
}

function AnalyticsContent() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Use real dashboard stats API
      const response = await apiService.request<DashboardStats>('/api/dashboard/stats');
      
      if (response.error) {
        setError(response.error);
        return;
      }
      
      setData(response.data || null);
      setLastRefresh(new Date());
    } catch (err) {
      setError('Failed to load analytics data');
      console.error('Failed to load analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleRefresh = () => {
    fetchAnalytics();
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'excellent': return 'bg-green-500';
      case 'good': return 'bg-blue-500';
      case 'fair': return 'bg-yellow-500';
      case 'poor': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading analytics...</span>
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
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Performance insights and system metrics for DDALAB
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Artifacts</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalArtifacts?.toLocaleString() || '0'}</div>
            <p className="text-xs text-muted-foreground">
              Data artifacts in system
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Analyses</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalAnalyses?.toLocaleString() || '0'}</div>
            <p className="text-xs text-muted-foreground">
              Completed analyses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.activeUsers || '0'}</div>
            <p className="text-xs text-muted-foreground">
              Users active in last 30 minutes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <div
                className={cn(
                  "w-3 h-3 rounded-full",
                  getHealthColor(data?.systemHealth || 'unknown')
                )}
              />
              <span className="text-2xl font-bold">{data?.systemHealth || 'Unknown'}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall system status
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Information Panel */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            System Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-medium">Data Overview</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Artifacts</span>
                  <span className="font-medium">{data?.totalArtifacts?.toLocaleString() || '0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Analyses</span>
                  <span className="font-medium">{data?.totalAnalyses?.toLocaleString() || '0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Users</span>
                  <span className="font-medium">{data?.activeUsers || '0'}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-medium">System Status</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Overall Health</span>
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        getHealthColor(data?.systemHealth || 'unknown')
                      )}
                    />
                    <span className="font-medium">{data?.systemHealth || 'Unknown'}</span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Update</span>
                  <span className="font-medium">{lastRefresh.toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-6 pt-6 border-t">
            <Button className="w-full" variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export Analytics Report
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
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
              <AnalyticsContent />
            </main>
            {footerVisible && <Footer />}
          </div>
        </div>
      </div>
    </AuthProvider>
  );
}