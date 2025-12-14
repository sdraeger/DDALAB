"use client";

import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Cloud, Server } from "lucide-react";

export interface SubmissionStatus {
  phase: string;
  error: string | null;
  isSubmitting: boolean;
}

export interface SubmissionAlertsProps {
  nsg: SubmissionStatus;
  server: SubmissionStatus;
  className?: string;
}

export const SubmissionAlerts: React.FC<SubmissionAlertsProps> = ({
  nsg,
  server,
  className = "",
}) => {
  const hasAlerts = nsg.phase || nsg.error || server.phase || server.error;

  if (!hasAlerts) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {server.phase && (
        <Alert>
          <Server className="h-4 w-4 animate-pulse" />
          <AlertDescription>{server.phase}</AlertDescription>
        </Alert>
      )}

      {server.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{server.error}</AlertDescription>
        </Alert>
      )}

      {nsg.phase && (
        <Alert>
          <Cloud className="h-4 w-4 animate-pulse" />
          <AlertDescription>{nsg.phase}</AlertDescription>
        </Alert>
      )}

      {nsg.error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{nsg.error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};
