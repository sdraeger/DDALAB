"use client";

import { memo, useCallback } from "react";
import { Download, Trash2, HardDrive, FileType, Clock } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import {
  useSampleDataIndex,
  useDownloadedSamples,
  useDownloadSampleData,
  useDeleteSampleData,
} from "@/hooks/useLearn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { SampleDataset } from "@/types/learn";

export const SampleDataManager = memo(function SampleDataManager() {
  const sampleDatasets = useAppStore((s) => s.learn.sampleDatasets);
  const { data: datasets, isLoading: isLoadingIndex } = useSampleDataIndex();
  const { data: downloadedList } = useDownloadedSamples();
  const downloadMutation = useDownloadSampleData();
  const deleteMutation = useDeleteSampleData();

  const handleDownload = useCallback(
    (dataset: SampleDataset) => {
      downloadMutation.mutate(dataset);
    },
    [downloadMutation],
  );

  const handleDelete = useCallback(
    (datasetId: string) => {
      deleteMutation.mutate(datasetId);
    },
    [deleteMutation],
  );

  const isDownloaded = useCallback(
    (datasetId: string) => {
      const storeStatus = sampleDatasets[datasetId];
      if (storeStatus?.downloaded) return true;
      return downloadedList?.some((item) => item.id === datasetId) ?? false;
    },
    [sampleDatasets, downloadedList],
  );

  const totalDiskUsage =
    datasets?.reduce((acc, ds) => {
      if (isDownloaded(ds.id)) return acc + ds.sizeBytes;
      return acc;
    }, 0) ?? 0;

  if (isLoadingIndex) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Sample Data</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Download example datasets for tutorials and experimentation
          </p>
        </div>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          Loading available datasets...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Sample Data</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Download example datasets for tutorials and experimentation
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {datasets?.map((dataset) => {
          const downloaded = isDownloaded(dataset.id);
          const status = sampleDatasets[dataset.id];
          const isDownloading = status?.downloading ?? false;
          const progress = status?.progress ?? 0;

          return (
            <Card key={dataset.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{dataset.name}</CardTitle>
                  <Badge variant="secondary">{dataset.format}</Badge>
                </div>
                <CardDescription>{dataset.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    <span>{formatBytes(dataset.sizeBytes)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileType className="h-3 w-3" />
                    <span>{dataset.channels} channels</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{dataset.duration}</span>
                  </div>
                </div>

                {isDownloading && (
                  <div className="space-y-1">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground text-right">
                      {progress}%
                    </p>
                  </div>
                )}

                <div className="flex justify-end">
                  {downloaded ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1"
                      onClick={() => handleDelete(dataset.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => handleDownload(dataset)}
                      disabled={isDownloading}
                      isLoading={isDownloading}
                      loadingText="Downloading..."
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {datasets && datasets.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-4">
          <HardDrive className="h-4 w-4" />
          <span>Total disk usage: {formatBytes(totalDiskUsage)}</span>
        </div>
      )}
    </div>
  );
});
