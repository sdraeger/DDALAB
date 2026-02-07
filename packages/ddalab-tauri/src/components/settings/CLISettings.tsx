"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Terminal,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  useCliInstallStatus,
  useInstallCli,
  useUninstallCli,
} from "@/hooks/useCliInstall";

export function CLISettings() {
  const { data: isInstalled, isLoading: statusLoading } = useCliInstallStatus();
  const installMutation = useInstallCli();
  const uninstallMutation = useUninstallCli();

  const error =
    installMutation.error?.message || uninstallMutation.error?.message || "";
  const successMessage = installMutation.data || uninstallMutation.data || "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Command Line Interface</h2>
        <p className="text-sm text-muted-foreground">
          Use the{" "}
          <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
            ddalab
          </code>{" "}
          CLI to run DDA analyses from your terminal
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            CLI Status
          </CardTitle>
          <CardDescription>
            Install the CLI to make{" "}
            <code className="font-mono text-xs">ddalab</code> available in your
            terminal
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {statusLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : isInstalled ? (
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {statusLoading
                    ? "Checking..."
                    : isInstalled
                      ? "Installed and available in PATH"
                      : "Not installed"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isInstalled
                    ? "Run 'ddalab --help' in any terminal to get started"
                    : "Click install to add ddalab to your PATH"}
                </p>
              </div>
            </div>

            {!statusLoading &&
              (isInstalled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => uninstallMutation.mutate()}
                  isLoading={uninstallMutation.isPending}
                  loadingText="Removing..."
                >
                  Uninstall CLI
                </Button>
              ) : (
                <Button
                  onClick={() => installMutation.mutate()}
                  isLoading={installMutation.isPending}
                  loadingText="Installing..."
                >
                  <Terminal className="h-4 w-4" />
                  Install CLI to PATH
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {successMessage && !error && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            {successMessage}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>
            Common CLI commands for running analyses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="rounded-lg bg-muted p-3 font-mono text-xs space-y-1.5">
              <p className="text-muted-foreground">
                # Run a single-timeseries analysis
              </p>
              <p>ddalab run --file data.edf --channels 0 1 2 --variants ST</p>
              <p className="text-muted-foreground mt-3">
                # List available DDA variants
              </p>
              <p>ddalab variants</p>
              <p className="text-muted-foreground mt-3">
                # Check setup and binary info
              </p>
              <p>ddalab info</p>
              <p className="text-muted-foreground mt-3">
                # Save results as JSON
              </p>
              <p>ddalab run --file data.edf --channels 0 -o results.json</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Run{" "}
              <code className="px-1 py-0.5 rounded bg-muted font-mono">
                ddalab --help
              </code>{" "}
              for full documentation of all commands and options.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
