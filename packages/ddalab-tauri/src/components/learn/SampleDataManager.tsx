"use client";

import { memo, useCallback } from "react";
import {
  AlertCircle,
  Clock,
  Download,
  HardDrive,
  FileType,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import {
  useSampleDataIndex,
  useDownloadedSamples,
  useDownloadSampleData,
  useDeleteSampleData,
} from "@/hooks/useLearn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const {
    data: datasets,
    error: sampleIndexError,
    isFetching: isFetchingIndex,
    isLoading: isLoadingIndex,
    refetch: refetchSampleIndex,
  } = useSampleDataIndex();
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
  const hasDatasets = (datasets?.length ?? 0) > 0;

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

      {sampleIndexError && (
        <Alert variant={hasDatasets ? "warning" : "destructive"}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {hasDatasets
              ? "Sample catalog refresh failed"
              : "Sample catalog unavailable"}
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{sampleIndexError.message}</p>
            <div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                isLoading={isFetchingIndex}
                loadingText="Retrying..."
                onClick={() => {
                  void refetchSampleIndex();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!sampleIndexError && !hasDatasets && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center text-muted-foreground">
          <HardDrive className="h-12 w-12 opacity-40" />
          <p className="mt-4 text-sm font-medium text-foreground">
            No sample datasets are currently published
          </p>
          <p className="mt-2 max-w-md text-sm">
            DDALAB could not find any downloadable sample datasets right now.
            Try refreshing the catalog later.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 gap-1"
            isLoading={isFetchingIndex}
            loadingText="Refreshing..."
            onClick={() => {
              void refetchSampleIndex();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Catalog
          </Button>
        </div>
      )}

      {hasDatasets && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {datasets?.map((dataset) => {
            const downloaded = isDownloaded(dataset.id);
            const status = sampleDatasets[dataset.id];
            const downloadError = status?.errorMessage ?? null;
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

                  {downloadError && (
                    <Alert variant="warning">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{downloadError}</AlertDescription>
                    </Alert>
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
                        variant={downloadError ? "outline" : "default"}
                        onClick={() => handleDownload(dataset)}
                        disabled={isDownloading}
                        isLoading={isDownloading}
                        loadingText="Downloading..."
                      >
                        <Download className="h-4 w-4" />
                        {downloadError ? "Retry Download" : "Download"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {hasDatasets && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-4">
          <HardDrive className="h-4 w-4" />
          <span>Total disk usage: {formatBytes(totalDiskUsage)}</span>
        </div>
      )}
    </div>
  );
});
