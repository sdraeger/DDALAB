"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MousePointerClick,
  Navigation,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { tutorials } from "@/data/tutorials";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TutorialStep } from "@/types/learn";
import type { PrimaryNavTab, SecondaryNavTab } from "@/types/navigation";

const HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-primary",
  "ring-offset-2",
  "transition-shadow",
];
const AUTO_ADVANCE_DELAY = 1200;

function useElementHighlight(step: TutorialStep | undefined) {
  const prevElementRef = useRef<Element | null>(null);

  useEffect(() => {
    // Clean up previous highlight
    if (prevElementRef.current) {
      prevElementRef.current.classList.remove(...HIGHLIGHT_CLASSES);
      prevElementRef.current = null;
    }

    const target = step?.target;
    if (!target) return;

    // Small delay to let navigation complete before finding elements
    const timeout = setTimeout(() => {
      const element = document.querySelector(target);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add(...HIGHLIGHT_CLASSES);
        prevElementRef.current = element;
      }
    }, 200);

    return () => {
      clearTimeout(timeout);
      if (prevElementRef.current) {
        prevElementRef.current.classList.remove(...HIGHLIGHT_CLASSES);
        prevElementRef.current = null;
      }
    };
  }, [step?.id, step?.target]);
}

function useAutoAction(step: TutorialStep | undefined, onAdvance: () => void) {
  const setPrimaryNav = useAppStore((s) => s.setPrimaryNav);
  const setSecondaryNav = useAppStore((s) => s.setSecondaryNav);

  useEffect(() => {
    if (step?.type !== "auto" || !step.autoAction) return;

    const { type, payload } = step.autoAction;

    if (type === "navigate" && payload) {
      const primary = payload.primary as PrimaryNavTab | undefined;
      const secondary = payload.secondary as SecondaryNavTab | undefined;
      if (primary) setPrimaryNav(primary);
      if (secondary) {
        // Delay secondary nav slightly to let primary settle
        setTimeout(() => setSecondaryNav(secondary), 50);
      }
    }

    // Auto-advance after a brief pause so the user sees the navigation happen
    const timeout = setTimeout(onAdvance, AUTO_ADVANCE_DELAY);
    return () => clearTimeout(timeout);
  }, [
    step?.id,
    step?.type,
    step?.autoAction,
    onAdvance,
    setPrimaryNav,
    setSecondaryNav,
  ]);
}

function useCompletionCheck(
  step: TutorialStep | undefined,
  onAdvance: () => void,
) {
  const advancedRef = useRef(false);

  useEffect(() => {
    advancedRef.current = false;

    if (step?.type !== "action" || !step.completionCheck) return;

    const { storeKey, expectedValue } = step.completionCheck;
    const keys = storeKey.split(".");

    const unsubscribe = useAppStore.subscribe((state) => {
      if (advancedRef.current) return;

      // Walk the store key path (e.g. "fileManager.selectedFile")
      let value: unknown = state;
      for (const key of keys) {
        if (value && typeof value === "object") {
          value = (value as Record<string, unknown>)[key];
        } else {
          value = undefined;
          break;
        }
      }

      const satisfied =
        expectedValue === "non-null" ? value != null : value === expectedValue;

      if (satisfied) {
        advancedRef.current = true;
        // Defer to next tick to avoid store update inside subscriber
        setTimeout(onAdvance, 0);
      }
    });

    return unsubscribe;
  }, [step?.id, step?.type, step?.completionCheck, onAdvance]);
}

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

  // Interactive behaviors
  useElementHighlight(currentStep);
  useAutoAction(currentStep, handleNext);
  useCompletionCheck(currentStep, handleNext);

  if (!tutorial || !currentStep) return null;

  const stepTypeIcon = {
    narrative: null,
    highlight: <Eye className="h-3.5 w-3.5" />,
    action: <MousePointerClick className="h-3.5 w-3.5" />,
    auto: <Navigation className="h-3.5 w-3.5" />,
  };

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
        <div className="flex items-center gap-2">
          {stepTypeIcon[currentStep.type] && (
            <span className="text-muted-foreground">
              {stepTypeIcon[currentStep.type]}
            </span>
          )}
          <h3 className="text-base font-semibold">{currentStep.title}</h3>
        </div>

        {currentStep.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {currentStep.content}
          </p>
        )}

        {currentStep.type === "highlight" && currentStep.target && (
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <Eye className="h-4 w-4 flex-shrink-0" />
            Look at the highlighted element in the app
          </div>
        )}

        {currentStep.type === "action" && currentStep.actionDescription && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <MousePointerClick className="h-4 w-4 flex-shrink-0" />
            <span>{currentStep.actionDescription}</span>
          </div>
        )}

        {currentStep.type === "action" && currentStep.completionCheck && (
          <p className="text-xs text-muted-foreground italic">
            This step will auto-advance when you complete the action.
          </p>
        )}

        {currentStep.type === "auto" && (
          <div className="rounded-md bg-purple-50 dark:bg-purple-950/30 px-3 py-2 text-sm text-purple-700 dark:text-purple-300 flex items-center gap-2">
            <Navigation className="h-4 w-4 flex-shrink-0" />
            Navigating automatically...
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
          {currentStep.type !== "auto" && (
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
          )}
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
