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
import { plotCacheManager } from "../../lib/utils/cache";
import { useToast } from "./use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

interface CacheStats {
  plotCount: number;
  heatmapCount: number;
  annotationCount: number;
  totalSizeMB: number;
  totalSizeBytes: number;
  memoryPlotCount: number;
  memoryHeatmapCount: number;
  memoryAnnotationCount: number;
  memorySizeMB: number;
}

export function CacheStatus() {
  const [stats, setStats] = useState<CacheStats>({
    plotCount: 0,
    heatmapCount: 0,
    annotationCount: 0,
    totalSizeMB: 0,
    totalSizeBytes: 0,
    memoryPlotCount: 0,
    memoryHeatmapCount: 0,
    memoryAnnotationCount: 0,
    memorySizeMB: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const updateStats = () => {
    console.log("updateStats called");
    try {
      const newStats = plotCacheManager.getCacheStats();
      console.log("Cache stats from plotCacheManager:", newStats);

      // Also check if plotCacheManager exists
      console.log("plotCacheManager exists:", !!plotCacheManager);
      console.log("plotCacheManager type:", typeof plotCacheManager);

      setStats({
        plotCount: newStats.plotCount,
        heatmapCount: newStats.heatmapCount,
        annotationCount: newStats.annotationCount,
        totalSizeMB: newStats.totalSizeMB,
        totalSizeBytes: newStats.totalSizeBytes,
        memoryPlotCount: newStats.memoryPlotCount,
        memoryHeatmapCount: newStats.memoryHeatmapCount,
        memoryAnnotationCount: newStats.memoryAnnotationCount,
        memorySizeMB: newStats.memorySizeMB,
      });
    } catch (error) {
      console.error("Error in updateStats:", error);
    }
  };

  useEffect(() => {
    console.log("CacheStatus useEffect running");
    updateStats();

    // Update stats periodically
    const interval = setInterval(() => {
      console.log("Interval updateStats called");
      updateStats();
    }, 5000);
    return () => {
      console.log("CacheStatus cleanup");
      clearInterval(interval);
    };
  }, []);

  const handleClearExpired = () => {
    plotCacheManager.clearExpiredCache();
    updateStats();
    toast({
      title: "Cache Cleaned",
      description: "Expired cache entries have been removed.",
    });
  };

  const handleClearAll = () => {
    try {
      // Clear all plot-related cache entries from localStorage
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(
        (key) =>
          key.startsWith("plot:") ||
          key.startsWith("heatmap:") ||
          key.startsWith("annotations:")
      );

      cacheKeys.forEach((key) => localStorage.removeItem(key));

      // Also clear memory cache by calling the manager's method
      const currentStats = plotCacheManager.getCacheStats();
      const totalCleared = cacheKeys.length +
        currentStats.memoryPlotCount +
        currentStats.memoryHeatmapCount +
        currentStats.memoryAnnotationCount;

      // Clear memory cache
      plotCacheManager.clearMemoryCache();

      updateStats();
      toast({
        title: "Cache Cleared",
        description: `Removed ${totalCleared} cache entries from localStorage and memory.`,
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
    console.log("Test cache button clicked");

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

    console.log("About to call plotCacheManager.cachePlotData");
    console.log("plotCacheManager:", plotCacheManager);

    try {
      plotCacheManager.cachePlotData(testKey, testData);
      console.log("Successfully created test cache entry");

      // Also test memory cache directly with a large data set (>2MB)
      console.log("Testing large data for memory cache...");
      const largeArray = new Array(300000).fill([1, 2, 3, 4, 5]).flat(); // This should be >2MB
      const largeTestData = {
        data: largeArray,
        channels: ["large_test"],
        metadata: { size: "large", testCase: true }
      };

      console.log("Large test data estimated size:", (JSON.stringify(largeTestData).length * 2 / 1024 / 1024).toFixed(2), "MB");

      plotCacheManager.cachePlotData({
        filePath: "/test/large_file.edf",
        chunkStart: 0,
        chunkSize: 2000,
        preprocessingOptions: null
      }, largeTestData);

      console.log("Successfully created large test cache entry");
    } catch (error) {
      console.error("Error creating test cache entry:", error);
    }

    // Update stats after creating test entry
    setTimeout(() => {
      console.log("Updating stats after test cache creation");
      updateStats();
      toast({
        title: "Test Cache Created",
        description: "Created test cache entries to verify functionality.",
      });
    }, 100);
  };

  const totalCached =
    stats.plotCount + stats.heatmapCount + stats.annotationCount;

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
          <DialogTitle>Plot Cache Status</DialogTitle>
          <DialogDescription>
            Manage cached plot data to improve performance when navigating
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
              <div className="border-t pt-2 space-y-2">
                <div className="flex justify-between items-center font-medium">
                  <span className="text-sm">Total Cached:</span>
                  <Badge>{totalCached}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Cache Size:</span>
                  <Badge variant="outline">{stats.totalSizeMB.toFixed(2)} MB</Badge>
                </div>
                {stats.memorySizeMB > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Memory Cache:</span>
                    <Badge variant="outline">{stats.memorySizeMB.toFixed(2)} MB</Badge>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearExpired}
              className="gap-2 flex-1"
            >
              <RefreshCw className="h-4 w-4" />
              Clear Expired
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              className="gap-2 flex-1"
            >
              <Trash2 className="h-4 w-4" />
              Clear All
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestCache}
              className="gap-2 flex-1"
            >
              Test Cache
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            <p>• Plot data is cached for 5 minutes</p>
            <p>• Annotations and heatmaps are cached for 10 minutes</p>
            <p>• Large files (&gt;2MB) are stored in memory cache only</p>
            <p>• Cache automatically clears expired entries every minute</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
