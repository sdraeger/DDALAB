"use client";

import { useState, useEffect } from "react";
import { profiler } from "@/utils/performance";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Activity, Download, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Performance Monitor Component
 *
 * Provides a UI for viewing and analyzing performance metrics in development mode.
 * Shows bottlenecks, render times, and provides optimization recommendations.
 */
export function PerformanceMonitor() {
  const [isOpen, setIsOpen] = useState(false);
  const [report, setReport] = useState<ReturnType<
    typeof profiler.generateReport
  > | null>(null);
  const [memoryUsage, setMemoryUsage] = useState<ReturnType<
    typeof profiler.getMemoryUsage
  > | null>(null);

  // Only show in development
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  // Debug: Log that component is rendering
  console.log("[PerformanceMonitor] Component rendering");

  const refreshReport = () => {
    setReport(profiler.generateReport(50));
    setMemoryUsage(profiler.getMemoryUsage());
  };

  const clearMetrics = () => {
    profiler.clear();
    setReport(null);
  };

  const exportReport = () => {
    const reportData = {
      timestamp: new Date().toISOString(),
      report,
      memoryUsage,
      browserMetrics: profiler.getBrowserMetrics(),
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `performance-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auto-refresh report when dialog opens
  useEffect(() => {
    if (isOpen) {
      refreshReport();
      const interval = setInterval(refreshReport, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="fixed bottom-4 right-4 rounded-full shadow-lg"
          style={{ zIndex: 9999 }}
          title="Performance Monitor"
        >
          <Activity className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Performance Monitor
          </DialogTitle>
          <DialogDescription>
            Real-time performance metrics and bottleneck detection
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button onClick={refreshReport} size="sm" variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={clearMetrics} size="sm" variant="outline">
            <Trash2 className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <Button onClick={exportReport} size="sm" variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <Button
            onClick={() => profiler.printReport()}
            size="sm"
            variant="outline"
          >
            Print to Console
          </Button>
        </div>

        <ScrollArea className="h-[60vh]">
          <div className="space-y-4">
            {/* Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Total Operations
                    </div>
                    <div className="text-2xl font-bold">
                      {report?.metrics.length || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">
                      Total Time
                    </div>
                    <div className="text-2xl font-bold">
                      {report?.totalDuration.toFixed(2) || "0.00"}ms
                    </div>
                  </div>
                </div>

                {memoryUsage && (
                  <div className="mt-4">
                    <div className="text-sm text-muted-foreground">
                      Memory Usage
                    </div>
                    <div className="text-lg font-semibold">
                      {(memoryUsage.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB
                      / {(memoryUsage.totalJSHeapSize / 1024 / 1024).toFixed(2)}{" "}
                      MB
                    </div>
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${(memoryUsage.usedJSHeapSize / memoryUsage.totalJSHeapSize) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bottlenecks */}
            {report && report.bottlenecks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    Bottlenecks
                    <Badge variant="destructive">
                      {report.bottlenecks.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {report.bottlenecks.slice(0, 10).map((metric, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center p-2 bg-muted/50 rounded"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {metric.name}
                          </div>
                          {metric.metadata && (
                            <div className="text-xs text-muted-foreground">
                              {JSON.stringify(metric.metadata)}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline">
                          {metric.duration?.toFixed(2)}ms
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Averages */}
            {report &&
              Object.keys(report.averages).some(
                (k) => report.averages[k] > 0,
              ) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Average Times by Category
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(report.averages)
                        .filter(([, avg]) => avg > 0)
                        .map(([category, avg]) => (
                          <div
                            key={category}
                            className="flex justify-between items-center"
                          >
                            <span className="capitalize text-sm">
                              {category.replace("_", " ")}
                            </span>
                            <span className="font-mono text-sm">
                              {avg.toFixed(2)}ms
                            </span>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Recommendations */}
            {report && report.recommendations.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recommendations</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm list-disc list-inside">
                    {report.recommendations.map((rec, i) => (
                      <li key={i} className="text-muted-foreground">
                        {rec}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Recent Operations */}
            {report && report.metrics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recent Operations</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {report.metrics
                      .slice(-20)
                      .reverse()
                      .map((metric, i) => (
                        <div
                          key={i}
                          className="flex justify-between items-center text-xs p-1 hover:bg-muted/50 rounded"
                        >
                          <span className="font-mono">{metric.name}</span>
                          <span className="text-muted-foreground">
                            {metric.duration?.toFixed(2)}ms
                          </span>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
