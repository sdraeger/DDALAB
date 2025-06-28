"use client";

import { useState, useEffect } from "react";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card";
import { Badge } from "./badge";
import { Trash2, RefreshCw, Database } from "lucide-react";
import { cacheManager } from "../../lib/utils/cache";
import { useToast } from "./use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

interface CacheStatsDisplay {
  plotCount: number;
  heatmapCount: number;
  annotationCount: number;
  widgetLayoutCount: number;
  totalSizeMB: number;
  memoryPlotCount: number;
  memoryHeatmapCount: number;
  memoryAnnotationCount: number;
  memoryWidgetLayoutCount: number;
  memorySizeMB: number;
}

const DEFAULT_STATS: CacheStatsDisplay = {
  plotCount: 0,
  heatmapCount: 0,
  annotationCount: 0,
  widgetLayoutCount: 0,
  totalSizeMB: 0,
  memoryPlotCount: 0,
  memoryHeatmapCount: 0,
  memoryAnnotationCount: 0,
  memoryWidgetLayoutCount: 0,
  memorySizeMB: 0,
};

export function CacheStatus() {
  const [stats, setStats] = useState<CacheStatsDisplay>(DEFAULT_STATS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const updateStats = () => {
    try {
      const cacheStats = cacheManager.getCacheStats();

      setStats({
        plotCount: cacheStats.plot.totalEntries,
        heatmapCount: cacheStats.heatmap.totalEntries,
        annotationCount: cacheStats.annotation.totalEntries,
        widgetLayoutCount: cacheStats.widgetLayout.totalEntries,
        totalSizeMB: cacheStats.plot.totalSizeMB + cacheStats.heatmap.totalSizeMB +
          cacheStats.annotation.totalSizeMB + cacheStats.widgetLayout.totalSizeMB,
        memoryPlotCount: cacheStats.plot.memoryEntries,
        memoryHeatmapCount: cacheStats.heatmap.memoryEntries,
        memoryAnnotationCount: cacheStats.annotation.memoryEntries,
        memoryWidgetLayoutCount: cacheStats.widgetLayout.memoryEntries,
        memorySizeMB: cacheStats.plot.memorySizeMB + cacheStats.heatmap.memorySizeMB +
          cacheStats.annotation.memorySizeMB + cacheStats.widgetLayout.memorySizeMB,
      });
    } catch (error) {
      console.error("Error in updateStats:", error);
    }
  };

  useEffect(() => {
    updateStats();

    // Update stats periodically
    const interval = setInterval(() => {
      updateStats();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const handleClearExpired = () => {
    cacheManager.clearExpiredCache();
    updateStats();
    toast({
      title: "Cache Cleaned",
      description: "Expired cache entries have been removed.",
    });
  };

  const handleClearAll = () => {
    try {
      const totalBefore = stats.plotCount + stats.heatmapCount + stats.annotationCount + stats.widgetLayoutCount;

      cacheManager.clearAllCache();

      updateStats();
      toast({
        title: "Cache Cleared",
        description: `Removed ${totalBefore} cache entries from localStorage and memory.`,
      });
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear cache.",
        variant: "destructive",
      });
    }
  };

  const handleTestCache = () => {
    // Test cache functionality by creating a test entry
    const testKey = {
      filePath: "/test/file.edf",
      chunkStart: 0,
      chunkSize: 1000,
      preprocessingOptions: null
    };

    const testData = {
      data: [1, 2, 3, 4, 5],
      channels: ["test"]
    };

    try {
      cacheManager.cachePlotData(testKey, testData);

      // Also test memory cache directly with a large data set (>2MB)
      const largeArray = new Array(300000).fill([1, 2, 3, 4, 5]).flat();
      const largeTestData = {
        data: largeArray,
        channels: ["large_test"],
        metadata: { size: "large", testCase: true }
      };

      cacheManager.cachePlotData({
        filePath: "/test/large_file.edf",
        chunkStart: 0,
        chunkSize: 2000,
        preprocessingOptions: null
      }, largeTestData);

    } catch (error) {
      console.error("Error creating test cache entry:", error);
    }

    // Update stats after creating test entry
    setTimeout(() => {
      updateStats();
      toast({
        title: "Test Cache Created",
        description: "Created test cache entries to verify functionality.",
      });
    }, 100);
  };

  const totalCached = stats.plotCount + stats.heatmapCount + stats.annotationCount + stats.widgetLayoutCount;

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Database className="h-4 w-4" />
          Cache ({totalCached})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cache Status</DialogTitle>
          <DialogDescription>
            Manage cached data to improve performance when navigating
            between plots and settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cache Statistics</CardTitle>
              <CardDescription>
                Current number of cached items by type
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm">Plot Data:</span>
                <div className="flex gap-1">
                  <Badge variant="secondary">{stats.plotCount}</Badge>
                  {stats.memoryPlotCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{stats.memoryPlotCount} in memory
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Heatmap Data:</span>
                <div className="flex gap-1">
                  <Badge variant="secondary">{stats.heatmapCount}</Badge>
                  {stats.memoryHeatmapCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{stats.memoryHeatmapCount} in memory
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Annotations:</span>
                <div className="flex gap-1">
                  <Badge variant="secondary">{stats.annotationCount}</Badge>
                  {stats.memoryAnnotationCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{stats.memoryAnnotationCount} in memory
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Widget Layouts:</span>
                <div className="flex gap-1">
                  <Badge variant="secondary">{stats.widgetLayoutCount}</Badge>
                  {stats.memoryWidgetLayoutCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{stats.memoryWidgetLayoutCount} in memory
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center border-t pt-2">
                <span className="text-sm font-medium">Total Size:</span>
                <div className="flex gap-1">
                  <Badge variant="outline">
                    {stats.totalSizeMB.toFixed(1)} MB
                  </Badge>
                  {stats.memorySizeMB > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{stats.memorySizeMB.toFixed(1)} MB in memory
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearExpired}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Clear Expired
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestCache}
              className="gap-2"
            >
              <Database className="h-4 w-4" />
              Test Cache
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Clear All
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
