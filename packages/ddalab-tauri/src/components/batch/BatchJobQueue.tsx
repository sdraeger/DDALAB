"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { Loader2, CheckCircle2, XCircle, Clock, Square } from "lucide-react";
import type { BatchJob, BatchFileStatus } from "@/store/slices/batchSlice";

interface BatchJobQueueProps {
  batch: BatchJob;
  onCancel: () => void;
}

function FileStatusIcon({ status }: { status: BatchFileStatus }) {
  switch (status) {
    case "queued":
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "cancelled":
      return <Square className="h-4 w-4 text-muted-foreground" />;
  }
}

function FileStatusBadge({ status }: { status: BatchFileStatus }) {
  const variantMap: Record<
    BatchFileStatus,
    "secondary" | "default" | "success" | "destructive" | "muted"
  > = {
    queued: "secondary",
    running: "default",
    completed: "success",
    error: "destructive",
    cancelled: "muted",
  };

  return (
    <Badge variant={variantMap[status]} className="text-xs capitalize">
      {status}
    </Badge>
  );
}

export function BatchJobQueue({ batch, onCancel }: BatchJobQueueProps) {
  const elapsed = batch.startedAt
    ? Math.round((Date.now() - batch.startedAt) / 1000)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm">Batch Processing</CardTitle>
            <CardDescription className="text-xs">
              {batch.completedFiles + batch.failedFiles} / {batch.totalFiles}{" "}
              files processed ({elapsed}s elapsed)
            </CardDescription>
          </div>
          {batch.status === "running" && (
            <Button variant="destructive" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-mono">
              {Math.round(batch.overallProgress)}%
            </span>
          </div>
          <Progress value={batch.overallProgress} className="h-2" />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>File</TableHead>
                <TableHead className="w-24">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batch.files.map((file, index) => (
                <TableRow
                  key={file.filePath}
                  className={
                    index === batch.currentFileIndex &&
                    batch.status === "running"
                      ? "bg-blue-50 dark:bg-blue-950/20"
                      : undefined
                  }
                >
                  <TableCell className="py-2">
                    <FileStatusIcon status={file.status} />
                  </TableCell>
                  <TableCell className="py-2">
                    <div>
                      <p className="text-xs font-mono">{file.fileName}</p>
                      {file.error && (
                        <p className="text-xs text-destructive mt-0.5">
                          {file.error}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <FileStatusBadge status={file.status} />
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
