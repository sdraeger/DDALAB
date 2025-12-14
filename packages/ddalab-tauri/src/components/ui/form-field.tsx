"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { AlertCircle, Info } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  error?: string;
  warning?: string;
  helpText?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  children,
  error,
  warning,
  helpText,
  required = false,
  htmlFor,
  className = "",
}) => {
  const hasError = !!error;
  const hasWarning = !!warning && !hasError;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2">
        <Label
          htmlFor={htmlFor}
          className={`text-sm font-medium ${hasError ? "text-destructive" : ""}`}
        >
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
        {helpText && <InfoTooltip content={helpText} />}
      </div>

      <div
        className={`
        ${hasError ? "ring-2 ring-destructive ring-offset-2 rounded-md" : ""}
        ${hasWarning ? "ring-2 ring-yellow-500 ring-offset-2 rounded-md" : ""}
      `}
      >
        {children}
      </div>

      {hasError && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {hasWarning && (
        <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-500">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <p>{warning}</p>
        </div>
      )}
    </div>
  );
};
