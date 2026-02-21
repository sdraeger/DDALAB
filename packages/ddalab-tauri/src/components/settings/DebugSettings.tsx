"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TauriService } from "@/services/tauriService";
import { FileText, FolderOpen, Bug } from "lucide-react";
import { useLogsPath } from "@/hooks/useAppInfo";
import { createLogger } from "@/lib/logger";
import { useIsTauriRuntime } from "@/hooks/useIsTauriRuntime";

const logger = createLogger("DebugSettings");

export function DebugSettings() {
  const isTauriRuntime = useIsTauriRuntime();

  // TanStack Query hook
  const { data: logsPath = "" } = useLogsPath();

  const handleOpenLogs = async () => {
    if (!isTauriRuntime) return;
    try {
      await TauriService.openLogsFolder();
    } catch (error) {
      logger.warn("Failed to open logs folder", { error });
    }
  };

  const handleReportIssue = async () => {
    try {
      await TauriService.openUrl(
        "https://github.com/sdraeger/DDALAB/issues/new",
      );
    } catch (error) {
      logger.warn("Failed to open issue tracker", { error });
    }
  };

  if (!isTauriRuntime) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-2xl font-bold mb-2">Debug Information</h3>
          <p className="text-muted-foreground">
            Debug features are only available in the desktop application
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Debug Information</h3>
        <p className="text-muted-foreground">
          View application logs and debug information
        </p>
      </div>

      <Card className="transition-shadow duration-150 hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
              <FileText className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            Application Logs
          </CardTitle>
          <CardDescription>
            Access logs for troubleshooting and bug reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Logs Location</Label>
              <div className="p-3 bg-muted rounded-lg">
                <code className="text-xs break-all">
                  {logsPath || "Loading..."}
                </code>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={handleOpenLogs} variant="outline">
                <FolderOpen className="mr-2 h-4 w-4" />
                View Logs
              </Button>
              <Button onClick={handleReportIssue} variant="outline">
                <Bug className="mr-2 h-4 w-4" />
                Report Issue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
