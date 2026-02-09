"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Square,
  ExternalLink,
  RotateCcw,
  GitCompareArrows,
} from "lucide-react";
import type { BatchJob, BatchFileStatus } from "@/store/slices/batchSlice";

interface BatchResultsSummaryProps {
  batch: BatchJob;
  onClear: () => void;
  onViewResult?: (analysisId: string) => void;
  onCompareResults?: () => void;
}

function StatusBadge({ status }: { status: BatchFileStatus }) {
  const config: Record<
    BatchFileStatus,
    {
      variant: "success" | "destructive" | "muted" | "secondary" | "default";
      label: string;
    }
  > = {
    completed: { variant: "success", label: "Completed" },
    error: { variant: "destructive", label: "Failed" },
    cancelled: { variant: "muted", label: "Cancelled" },
    queued: { variant: "secondary", label: "Queued" },
    running: { variant: "default", label: "Running" },
  };

  const { variant, label } = config[status];
  return (
    <Badge variant={variant} className="text-xs">
      {label}
    </Badge>
  );
}

export function BatchResultsSummary({
  batch,
  onClear,
  onViewResult,
  onCompareResults,
}: BatchResultsSummaryProps) {
  const elapsedSeconds = batch.elapsedMs
    ? (batch.elapsedMs / 1000).toFixed(1)
    : "—";

  const statusIcon =
    batch.status === "completed" ? (
      <CheckCircle2 className="h-5 w-5 text-green-500" />
    ) : batch.status === "error" ? (
      <XCircle className="h-5 w-5 text-destructive" />
    ) : (
      <Square className="h-5 w-5 text-muted-foreground" />
    );

  const statusLabel =
    batch.status === "completed"
      ? batch.failedFiles > 0
        ? "Completed with Errors"
        : "Completed"
      : batch.status === "error"
        ? "Failed"
        : "Cancelled";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {statusIcon}
            <div>
              <CardTitle className="text-sm">{statusLabel}</CardTitle>
              <CardDescription className="text-xs">
                {elapsedSeconds}s total
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            {onCompareResults && batch.completedFiles >= 2 && (
              <Button size="sm" onClick={onCompareResults}>
                <GitCompareArrows className="h-4 w-4 mr-2" />
                Compare Results
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onClear}>
              <RotateCcw className="h-4 w-4 mr-2" />
              New Batch
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-green-50 dark:bg-green-950/20 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-600">
              {batch.completedFiles}
            </div>
            <div className="text-xs text-muted-foreground">Succeeded</div>
          </div>
          <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
            <div className="text-2xl font-bold text-destructive">
              {batch.failedFiles}
            </div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-2xl font-bold">{batch.totalFiles}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.files.map((file) => (
                <TableRow key={file.filePath}>
                  <TableCell>
                    <div>
                      <p className="text-xs font-mono">{file.fileName}</p>
                      {file.error && (
                        <p className="text-xs text-destructive mt-0.5 line-clamp-1">
                          {file.error}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={file.status} />
                  </TableCell>
                  <TableCell>
                    {file.analysisId && onViewResult && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => onViewResult(file.analysisId!)}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
