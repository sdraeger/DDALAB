"use client";

import { memo, useCallback, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { tutorials } from "@/data/tutorials";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const TutorialRunner = memo(function TutorialRunner() {
  const activeTutorialId = useAppStore((s) => s.learn.activeTutorialId);
  const tutorialProgress = useAppStore((s) => s.learn.tutorialProgress);
  const setActiveTutorialId = useAppStore((s) => s.setActiveTutorialId);
  const setTutorialProgress = useAppStore((s) => s.setTutorialProgress);

  const tutorial = useMemo(
    () => tutorials.find((t) => t.id === activeTutorialId),
    [activeTutorialId],
  );

  const progress = activeTutorialId
    ? tutorialProgress[activeTutorialId]
    : undefined;

  const currentStepIndex = progress?.currentStep ?? 0;
  const currentStep = tutorial?.steps[currentStepIndex];
  const totalSteps = tutorial?.steps.length ?? 0;
  const isLastStep = currentStepIndex >= totalSteps - 1;
  const isFirstStep = currentStepIndex === 0;

  const saveProgress = useCallback(
    (stepIndex: number, completed: boolean) => {
      if (!activeTutorialId) return;
      setTutorialProgress(activeTutorialId, {
        currentStep: stepIndex,
        completed,
        lastAccessedAt: Date.now(),
      });
    },
    [activeTutorialId, setTutorialProgress],
  );

  const handleNext = useCallback(() => {
    if (isLastStep) {
      saveProgress(currentStepIndex, true);
      setActiveTutorialId(null);
      return;
    }
    const nextStep = currentStepIndex + 1;
    saveProgress(nextStep, false);
  }, [isLastStep, currentStepIndex, saveProgress, setActiveTutorialId]);

  const handlePrevious = useCallback(() => {
    if (isFirstStep) return;
    const prevStep = currentStepIndex - 1;
    saveProgress(prevStep, false);
  }, [isFirstStep, currentStepIndex, saveProgress]);

  const handleClose = useCallback(() => {
    if (activeTutorialId) {
      saveProgress(currentStepIndex, false);
    }
    setActiveTutorialId(null);
  }, [activeTutorialId, currentStepIndex, saveProgress, setActiveTutorialId]);

  const handleSkip = useCallback(() => {
    setActiveTutorialId(null);
  }, [setActiveTutorialId]);

  if (!tutorial || !currentStep) return null;

  return (
    <div className="fixed top-16 right-4 z-50 w-96 rounded-lg border bg-card text-card-foreground shadow-lg">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            Step {currentStepIndex + 1} of {totalSteps}
          </Badge>
          <span className="text-sm font-medium truncate max-w-[180px]">
            {tutorial.title}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleClose}
          aria-label="Close tutorial"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-4 py-4 space-y-3">
        <h3 className="text-base font-semibold">{currentStep.title}</h3>

        {currentStep.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {currentStep.content}
          </p>
        )}

        {currentStep.type === "highlight" && currentStep.target && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
            Look for the highlighted element: {currentStep.target}
          </div>
        )}

        {currentStep.type === "action" && currentStep.actionDescription && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {currentStep.actionDescription}
          </div>
        )}

        {currentStep.type === "auto" && currentStep.autoAction && (
          <div className="rounded-md bg-purple-50 dark:bg-purple-950/30 px-3 py-2 text-sm text-purple-700 dark:text-purple-300">
            Auto-navigating: {currentStep.autoAction.type}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSkip}
          className="text-muted-foreground"
        >
          Skip
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrevious}
            disabled={isFirstStep}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            size="sm"
            onClick={handleNext}
            className={cn(
              "gap-1",
              isLastStep && "bg-green-600 hover:bg-green-700",
            )}
          >
            {isLastStep ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Complete
              </>
            ) : (
              <>
                Next
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="flex gap-1">
          {tutorial.steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index < currentStepIndex
                  ? "bg-primary"
                  : index === currentStepIndex
                    ? "bg-primary/60"
                    : "bg-muted",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
