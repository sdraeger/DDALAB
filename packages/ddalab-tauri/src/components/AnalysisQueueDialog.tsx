"use client";

import { memo, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/appStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Clock, XCircle } from "lucide-react";
import type {
  AnalysisQueuePreference,
  AnalysisJob,
} from "@/store/slices/analysisSlice";

export type QueueAction = "parallel" | "queue" | "cancel-current";

interface AnalysisQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runningJob: AnalysisJob;
  newFileName: string;
  onAction: (action: QueueAction) => void;
}

/**
 * Dialog shown when user tries to start a new analysis while another is running.
 * Allows choosing between parallel execution, queueing, or canceling current.
 */
export const AnalysisQueueDialog = memo(function AnalysisQueueDialog({
  open,
  onOpenChange,
  runningJob,
  newFileName,
  onAction,
}: AnalysisQueueDialogProps) {
  const [selectedAction, setSelectedAction] = useState<QueueAction>("parallel");
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setQueuePreference } = useAppStore(
    useShallow((state) => ({
      setQueuePreference: state.setQueuePreference,
    })),
  );

  // Extract filename from path
  const runningFileName =
    runningJob.filePath.split("/").pop() || runningJob.filePath;

  const handleContinue = useCallback(async () => {
    setIsSubmitting(true);

    // Save preference if user checked "remember"
    if (rememberChoice) {
      const preference: AnalysisQueuePreference =
        selectedAction === "parallel"
          ? "parallel"
          : selectedAction === "queue"
            ? "sequential"
            : "ask"; // "cancel-current" doesn't make sense to remember

      if (selectedAction !== "cancel-current") {
        setQueuePreference(preference);
      }
    }

    // Execute the action
    onAction(selectedAction);
    setIsSubmitting(false);
    onOpenChange(false);
  }, [
    selectedAction,
    rememberChoice,
    setQueuePreference,
    onAction,
    onOpenChange,
  ]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Analysis Already Running</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2">
              <p>
                <span className="font-medium text-foreground">
                  {runningFileName}
                </span>{" "}
                has an analysis in progress.
              </p>
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span>{Math.round(runningJob.progress)}% complete</span>
                {runningJob.currentStep && (
                  <span className="text-muted-foreground truncate">
                    — {runningJob.currentStep}
                  </span>
                )}
              </div>
              <Progress value={runningJob.progress} className="h-1.5" />
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            What would you like to do with{" "}
            <span className="font-medium text-foreground">{newFileName}</span>?
          </p>

          <RadioGroup
            value={selectedAction}
            onValueChange={(value) => setSelectedAction(value as QueueAction)}
            className="space-y-3"
          >
            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer">
              <RadioGroupItem
                value="parallel"
                id="parallel"
                className="mt-0.5"
              />
              <Label htmlFor="parallel" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Run in parallel</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Both analyses will run simultaneously
                </p>
              </Label>
            </div>

            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer">
              <RadioGroupItem value="queue" id="queue" className="mt-0.5" />
              <Label htmlFor="queue" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span className="font-medium">Wait in queue</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Start after current analysis completes
                </p>
              </Label>
            </div>

            <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer">
              <RadioGroupItem
                value="cancel-current"
                id="cancel-current"
                className="mt-0.5"
              />
              <Label htmlFor="cancel-current" className="flex-1 cursor-pointer">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span className="font-medium">Cancel current</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Stop {runningFileName} and start new analysis immediately
                </p>
              </Label>
            </div>
          </RadioGroup>

          {selectedAction !== "cancel-current" && (
            <div className="flex items-center space-x-2 mt-4 pt-4 border-t">
              <Checkbox
                id="remember"
                checked={rememberChoice}
                onCheckedChange={(checked) =>
                  setRememberChoice(checked === true)
                }
              />
              <Label
                htmlFor="remember"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Remember my choice
              </Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleContinue} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
