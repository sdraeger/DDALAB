"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Play, CheckCircle2, XCircle, Terminal } from "lucide-react";
import { useRunPlugin } from "@/hooks/usePlugins";
import type { PluginOutputResponse } from "@/services/tauriBackendService";

interface PluginRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginId: string | null;
  pluginName: string;
  analysisId: string | null;
}

export function PluginRunDialog({
  open,
  onOpenChange,
  pluginId,
  pluginName,
  analysisId,
}: PluginRunDialogProps) {
  const [output, setOutput] = useState<PluginOutputResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runMutation = useRunPlugin();

  const handleRun = async () => {
    if (!pluginId || !analysisId) return;

    setOutput(null);
    setError(null);

    try {
      const result = await runMutation.mutateAsync({ pluginId, analysisId });
      setOutput(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setOutput(null);
    setError(null);
  };

  const isRunning = runMutation.isPending;
  const isDone = !!output || !!error;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Plugin: {pluginName}</DialogTitle>
          <DialogDescription>
            {analysisId
              ? `Execute plugin on analysis ${analysisId.slice(0, 8)}...`
              : "No analysis selected"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Progress */}
          {isRunning && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                Running plugin...
              </div>
              <Progress value={undefined} className="h-1.5" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Plugin failed</p>
                <p className="text-xs mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Output */}
          {output && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Plugin completed successfully
              </div>

              {/* Results */}
              <div>
                <h4 className="text-sm font-medium mb-1.5">Results</h4>
                <ScrollArea className="h-48 rounded-md border">
                  <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(output.results, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              {/* Logs */}
              {output.logs.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <h4 className="text-sm font-medium">
                      Logs
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">
                        {output.logs.length}
                      </Badge>
                    </h4>
                  </div>
                  <ScrollArea className="h-24 rounded-md border bg-muted/30">
                    <div className="p-2 space-y-0.5">
                      {output.logs.map((log, i) => (
                        <p
                          key={i}
                          className="text-xs font-mono text-muted-foreground"
                        >
                          {log}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {!isDone ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleRun}
                disabled={isRunning || !pluginId || !analysisId}
              >
                <Play className="h-4 w-4 mr-2" />
                {isRunning ? "Running..." : "Run"}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
