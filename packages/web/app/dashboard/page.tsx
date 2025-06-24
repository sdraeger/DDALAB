"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "shared/components/ui/card";
import { Badge } from "shared/components/ui/badge";
import { CompactFileBrowser } from "shared/components/files/CompactFileBrowser";
import { DDAForm } from "shared/components/form/DDAForm";
import { useDashboardState } from "shared/contexts/DashboardStateContext";
import { apiRequest, ApiRequestOptions } from "shared/lib/utils/request";
import { EdfConfigResponse } from "shared/lib/schemas/edf";
import logger from "shared/lib/utils/logger";
import { BarChart3, FileText, HelpCircle, Settings } from "lucide-react";

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const {
    selectedFilePath,
    selectedChannels,
    setSelectedChannels,
    handleFileSelect: handleFileSelectFromContext,
  } = useDashboardState();

  const handleFileSelect = async (filePath: string) => {
    // Use the context's file select handler first
    handleFileSelectFromContext(filePath);

    const token = session?.accessToken;
    if (!token) {
      logger.error("No token found in session");
      return;
    }

    try {
      const configRequestOptions: ApiRequestOptions & { responseType: "json" } = {
        url: `/api/config/edf?file_path=${encodeURIComponent(filePath)}`,
        method: "GET",
        token,
        responseType: "json",
        contentType: "application/json",
      };

      const fileCfgResponse = await apiRequest<EdfConfigResponse>(configRequestOptions);
      logger.info("File config loaded:", fileCfgResponse);
      setSelectedChannels(fileCfgResponse?.channels || []);
    } catch (error) {
      logger.error("Error loading file config:", error);
      setSelectedChannels([]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
        <p className="text-muted-foreground">
          Select a file to begin your data analysis workflow
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => router.push('/dashboard/dda')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Analysis</CardTitle>
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Run DDA analysis on EDF files
            </p>
            <Badge variant="secondary" className="mt-2">
              Quick Start →
            </Badge>
          </CardContent>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => router.push('/dashboard/artifacts')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artifacts</CardTitle>
            <FileText className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              View and manage results
            </p>
            <Badge variant="secondary" className="mt-2">
              Browse →
            </Badge>
          </CardContent>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => router.push('/dashboard/tickets')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Support</CardTitle>
            <HelpCircle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Get help and support
            </p>
            <Badge variant="secondary" className="mt-2">
              Contact →
            </Badge>
          </CardContent>
        </Card>

        <Card
          className="hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => router.push('/dashboard/settings')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settings</CardTitle>
            <Settings className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Configure preferences
            </p>
            <Badge variant="secondary" className="mt-2">
              Customize →
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* File Browser */}
        <div className="lg:col-span-2">
          <CompactFileBrowser
            onFileSelect={handleFileSelect}
            selectedFile={selectedFilePath || undefined}
            maxHeight="500px"
          />
        </div>

        {/* Analysis Form */}
        <div className="lg:col-span-3">
          {selectedFilePath ? (
            <DDAForm
              filePath={selectedFilePath}
              selectedChannels={selectedChannels}
              setSelectedChannels={setSelectedChannels}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Get Started</CardTitle>
                <CardDescription>
                  Select a file from the browser to begin analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step 1</Badge>
                    <span className="text-sm">Choose an EDF file from the file browser</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step 2</Badge>
                    <span className="text-sm">Configure analysis parameters</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Step 3</Badge>
                    <span className="text-sm">Run DDA analysis and view results</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
