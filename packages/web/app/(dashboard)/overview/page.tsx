"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shared/components/ui/card";
import { Badge } from "shared/components/ui/badge";
import { Button } from "shared/components/ui/button";
import { Progress } from "shared/components/ui/progress";
import { useApiQuery } from "shared/hooks/useApiQuery";
import {
  BarChart3,
  FileText,
  HelpCircle,
  Settings,
  Activity,
  Brain,
  Zap,
  Users,
  Clock,
  TrendingUp,
  Shield,
  Database,
  Cpu
} from "lucide-react";

interface StatsResponse {
  totalArtifacts?: number;
  totalAnalyses?: number;
  activeUsers?: number;
  systemHealth?: 'excellent' | 'good' | 'fair' | 'poor';
}

export default function OverviewPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const user = session?.user;

  // Fetch dashboard statistics
  const { data: stats } = useApiQuery<StatsResponse>({
    url: "/api/dashboard/stats",
    method: "GET",
    responseType: "json",
    enabled: !!session,
  });

  const getHealthColor = (health?: string) => {
    switch (health) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'fair': return 'text-yellow-600';
      case 'poor': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getHealthProgress = (health?: string) => {
    switch (health) {
      case 'excellent': return 95;
      case 'good': return 75;
      case 'fair': return 50;
      case 'poor': return 25;
      default: return 0;
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Welcome back, {user?.name?.split(' ')[0] || 'User'}
            </h1>
            <p className="text-xl text-muted-foreground mt-2">
              DDALAB - Delay Differential Analysis Laboratory
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="px-3 py-1">
              <Activity className="h-3 w-3 mr-1" />
              System Online
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">EEG Analysis</Badge>
          <Badge variant="secondary">Data Visualization</Badge>
          <Badge variant="secondary">Artifact Detection</Badge>
          <Badge variant="secondary">Real-time Processing</Badge>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Artifacts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalArtifacts || 0}</div>
            <p className="text-xs text-muted-foreground">
              Analysis results stored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyses Run</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalAnalyses || 0}</div>
            <p className="text-xs text-muted-foreground">
              DDA computations completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeUsers || 1}</div>
            <p className="text-xs text-muted-foreground">
              Currently online
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <Activity className={`h-4 w-4 ${getHealthColor(stats?.systemHealth)}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getHealthColor(stats?.systemHealth)}`}>
              {stats?.systemHealth || 'Unknown'}
            </div>
            <Progress value={getHealthProgress(stats?.systemHealth)} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-2xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => router.push('/dashboard')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Main Workspace</CardTitle>
              <Zap className="h-4 w-4 text-blue-600 group-hover:scale-110 transition-transform" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Interactive dashboard with widgets
              </p>
              <Badge variant="secondary" className="mt-2">
                Launch →
              </Badge>
            </CardContent>
          </Card>

          <Card
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => router.push('/dashboard/dda')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Data Analysis</CardTitle>
              <BarChart3 className="h-4 w-4 text-green-600 group-hover:scale-110 transition-transform" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Run DDA on EDF files
              </p>
              <Badge variant="secondary" className="mt-2">
                Analyze →
              </Badge>
            </CardContent>
          </Card>

          <Card
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => router.push('/dashboard/artifacts')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Results & Artifacts</CardTitle>
              <FileText className="h-4 w-4 text-purple-600 group-hover:scale-110 transition-transform" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                View and manage analysis results
              </p>
              <Badge variant="secondary" className="mt-2">
                Browse →
              </Badge>
            </CardContent>
          </Card>

          <Card
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => router.push('/dashboard/settings')}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Settings</CardTitle>
              <Settings className="h-4 w-4 text-orange-600 group-hover:scale-110 transition-transform" />
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Configure preferences
              </p>
              <Badge variant="secondary" className="mt-2">
                Configure →
              </Badge>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-2xl font-semibold mb-4">Recent Activity</h2>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-600" />
              System Updates & News
            </CardTitle>
            <CardDescription>
              Latest platform updates and announcements
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="w-2 h-2 rounded-full bg-green-500 mt-2"></div>
              <div className="flex-1">
                <p className="font-medium text-sm">Widget Synchronization Enhanced</p>
                <p className="text-xs text-muted-foreground">
                  Popped-out widgets now maintain real-time sync with dashboard
                </p>
                <p className="text-xs text-muted-foreground mt-1">Just now</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
              <div className="flex-1">
                <p className="font-medium text-sm">New Sidebar Navigation</p>
                <p className="text-xs text-muted-foreground">
                  Modern sidebar design for improved navigation experience
                </p>
                <p className="text-xs text-muted-foreground mt-1">5 minutes ago</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="w-2 h-2 rounded-full bg-purple-500 mt-2"></div>
              <div className="flex-1">
                <p className="font-medium text-sm">Performance Improvements</p>
                <p className="text-xs text-muted-foreground">
                  Enhanced data processing and visualization performance
                </p>
                <p className="text-xs text-muted-foreground mt-1">1 hour ago</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Platform Capabilities */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-blue-600" />
              EEG Analysis Capabilities
            </CardTitle>
            <CardDescription>
              Advanced algorithms for neurological data processing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <div>
                <p className="font-medium">DDA</p>
                <p className="text-sm text-muted-foreground">Dual Density Analysis for artifact detection</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Database className="h-4 w-4 text-blue-600" />
              <div>
                <p className="font-medium">EDF File Support</p>
                <p className="text-sm text-muted-foreground">Native European Data Format processing</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Cpu className="h-4 w-4 text-purple-600" />
              <div>
                <p className="font-medium">Real-time Processing</p>
                <p className="text-sm text-muted-foreground">Live data visualization and analysis</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={() => router.push('/dashboard/dda')}
            >
              Start Analysis
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-green-600" />
              Getting Started
            </CardTitle>
            <CardDescription>
              New to DDALAB? Follow these steps to begin
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-8 h-8 rounded-full flex items-center justify-center p-0">1</Badge>
                <div>
                  <p className="font-medium">Upload EDF Files</p>
                  <p className="text-sm text-muted-foreground">Upload your neurological data files</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-8 h-8 rounded-full flex items-center justify-center p-0">2</Badge>
                <div>
                  <p className="font-medium">Configure Analysis</p>
                  <p className="text-sm text-muted-foreground">Set parameters for your analysis</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="w-8 h-8 rounded-full flex items-center justify-center p-0">3</Badge>
                <div>
                  <p className="font-medium">Review Results</p>
                  <p className="text-sm text-muted-foreground">Examine artifacts and insights</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                variant="default"
                className="flex-1"
                onClick={() => router.push('/dashboard')}
              >
                Open Workspace
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push('/dashboard/tickets')}
              >
                <HelpCircle className="h-4 w-4 mr-1" />
                Help
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
