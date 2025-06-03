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
import { plotCacheManager } from "../../lib/utils/plotCache";
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
}

export function CacheStatus() {
  const [stats, setStats] = useState<CacheStats>({
    plotCount: 0,
    heatmapCount: 0,
    annotationCount: 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const updateStats = () => {
    const newStats = plotCacheManager.getCacheStats();
    setStats(newStats);
  };

  useEffect(() => {
    updateStats();

    // Update stats periodically
    const interval = setInterval(updateStats, 5000);
    return () => clearInterval(interval);
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
      // Clear all plot-related cache entries
      const keys = Object.keys(localStorage);
      const cacheKeys = keys.filter(
        (key) =>
          key.startsWith("plot:") ||
          key.startsWith("heatmap:") ||
          key.startsWith("annotations:")
      );

      cacheKeys.forEach((key) => localStorage.removeItem(key));

      updateStats();
      toast({
        title: "Cache Cleared",
        description: `Removed ${cacheKeys.length} cache entries.`,
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
                <Badge variant="secondary">{stats.plotCount}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Heatmap Data:</span>
                <Badge variant="secondary">{stats.heatmapCount}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Annotations:</span>
                <Badge variant="secondary">{stats.annotationCount}</Badge>
              </div>
              <div className="border-t pt-2">
                <div className="flex justify-between items-center font-medium">
                  <span className="text-sm">Total Cached:</span>
                  <Badge>{totalCached}</Badge>
                </div>
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

          <div className="text-xs text-muted-foreground">
            <p>• Plot data is cached for 5 minutes</p>
            <p>• Annotations and heatmaps are cached for 10 minutes</p>
            <p>• Cache automatically clears expired entries every minute</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
