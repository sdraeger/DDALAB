"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Code,
  RefreshCw,
} from "lucide-react";
import {
  usePythonEnvironment,
  useTestPythonPath,
} from "@/hooks/usePythonEnvironment";

export function PythonSettings() {
  const { data: env, isLoading, refetch } = usePythonEnvironment();
  const testMutation = useTestPythonPath();
  const [customPath, setCustomPath] = useState("");

  const handleTest = () => {
    if (customPath.trim()) {
      testMutation.mutate(customPath.trim());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Python / MNE-Python</h2>
        <p className="text-sm text-muted-foreground">
          MNE-Python enables reading additional file formats (MATLAB v7.3 .set,
          .cnt, .mff, .bdf, and more)
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Environment Status
          </CardTitle>
          <CardDescription>
            Auto-detected Python environment and MNE-Python availability
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : env?.hasMne ? (
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              ) : env?.detected ? (
                <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {isLoading
                    ? "Detecting..."
                    : env?.hasMne
                      ? `MNE-Python ${env.mneVersion} available`
                      : env?.detected
                        ? "Python found, MNE not installed"
                        : "Python not detected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {env?.pythonPath
                    ? `Using: ${env.pythonPath}`
                    : "No Python installation found in PATH"}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className="h-4 w-4" />
              Re-detect
            </Button>
          </div>

          {env?.detected && !env.hasMne && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Python was found but MNE-Python is not installed. Run{" "}
                <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">
                  pip install mne
                </code>{" "}
                to enable additional file format support.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom Python Path</CardTitle>
          <CardDescription>
            Specify a custom Python executable if auto-detection fails
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="/usr/local/bin/python3"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              className="font-mono text-sm"
            />
            <Button
              onClick={handleTest}
              disabled={!customPath.trim() || testMutation.isPending}
              variant="outline"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          </div>

          {testMutation.data && (
            <Alert
              className={
                testMutation.data.hasMne
                  ? "border-green-500 bg-green-50 dark:bg-green-950"
                  : testMutation.data.detected
                    ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950"
                    : undefined
              }
              variant={!testMutation.data.detected ? "destructive" : undefined}
            >
              {testMutation.data.hasMne ? (
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : testMutation.data.detected ? (
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {testMutation.data.hasMne
                  ? `MNE-Python ${testMutation.data.mneVersion} found at ${testMutation.data.pythonPath}`
                  : testMutation.data.detected
                    ? `Python found but MNE not installed at ${testMutation.data.pythonPath}`
                    : `Python not found at ${customPath}`}
              </AlertDescription>
            </Alert>
          )}

          {testMutation.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{testMutation.error.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supported Formats via MNE-Python</CardTitle>
          <CardDescription>
            Additional file formats available when MNE-Python is installed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .set
              </code>
              <span className="text-muted-foreground">
                MATLAB v7.3 HDF5 EEGLAB
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .bdf
              </code>
              <span className="text-muted-foreground">BioSemi Data Format</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .cnt
              </code>
              <span className="text-muted-foreground">
                Neuroscan continuous
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .mff
              </code>
              <span className="text-muted-foreground">EGI/Philips MFF</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .gdf
              </code>
              <span className="text-muted-foreground">General Data Format</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">
                .egi
              </code>
              <span className="text-muted-foreground">EGI simple binary</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
