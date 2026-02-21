"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shield } from "lucide-react";

export function SecuritySettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Security Settings</h3>
        <p className="text-sm text-muted-foreground">
          Review local processing and credential safeguards
        </p>
      </div>

      {/* Server Status */}
      <Card className="transition-shadow duration-150 hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <Shield className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            Local Runtime Configuration
          </CardTitle>
          <CardDescription>
            Desktop runtime and communication model
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Execution Model:</span>
            <span className="font-medium">In-process via Tauri IPC</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Network Ports:</span>
            <span className="font-medium">None required</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Data Path:</span>
            <span className="font-medium">Local machine only</span>
          </div>
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              DDALAB desktop now uses Tauri IPC for backend communication
              instead of an HTTP localhost service. Sensitive analysis data
              stays local unless you explicitly use sharing or upload features.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
