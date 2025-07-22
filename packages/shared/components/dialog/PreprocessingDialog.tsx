"use client";

import React from "react";
import { UseFormReturn } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { FilterOptionsGroup } from "../ui/preprocessing/FilterOptionsGroup";
import { SignalProcessingGroup } from "../ui/preprocessing/SignalProcessingGroup";
import { NormalizationGroup } from "../ui/preprocessing/NormalizationGroup";
import { Loader2, PlayCircle, Settings } from "lucide-react";
import { FormValues } from "../../types/preprocessing";

interface PreprocessingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<FormValues>;
  onSubmit: () => void;
  isSubmitting: boolean;
  selectedChannelsCount: number;
  fileName: string;
}

export function PreprocessingDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  isSubmitting,
  selectedChannelsCount,
  fileName,
}: PreprocessingDialogProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const getActiveOptionsCount = () => {
    const preprocessingSteps = form.watch("preprocessingSteps") || [];
    const removeOutliers = form.watch("removeOutliers");
    const smoothing = form.watch("smoothing");
    const normalization = form.watch("normalization");

    let count = preprocessingSteps.length;
    if (removeOutliers) count++;
    if (smoothing) count++;
    if (normalization !== "none") count++;

    return count;
  };

  const activeCount = getActiveOptionsCount();

  // When accessing form.watch('smoothingWindow'), provide a default value if undefined
  const smoothingWindow = form.watch('smoothingWindow') ?? 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Settings className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl">
                Configure DDA Preprocessing
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Set up signal preprocessing options before running DDA
                on your EEG data.
              </DialogDescription>
            </div>
          </div>

          {/* Analysis Summary */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">File:</span>
              <span className="font-mono text-xs bg-background px-2 py-1 rounded border">
                {fileName}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Selected Channels:</span>
              <span className="font-semibold">{selectedChannelsCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Preprocessing Options:
              </span>
              <span className="font-semibold">
                {activeCount === 0 ? "None" : `${activeCount} active`}
              </span>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
            {/* Signal Filtering */}
            <div className="space-y-4">
              <FilterOptionsGroup form={form} />
            </div>

            {/* Signal Processing */}
            <div className="space-y-4">
              <SignalProcessingGroup form={form} />
            </div>

            {/* Normalization */}
            <div className="space-y-4">
              <NormalizationGroup form={form} />
            </div>
          </div>

          <DialogFooter className="flex items-center gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            <div className="flex-1" />

            {activeCount > 0 && (
              <div className="text-xs text-muted-foreground">
                {activeCount} preprocessing option{activeCount !== 1 ? "s" : ""}{" "}
                selected
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting || selectedChannelsCount === 0}
              className="min-w-[140px]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running DDA...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Run DDA
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
