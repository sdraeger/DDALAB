"use client";

import { memo, useCallback } from "react";
import { Rocket, Brain, FileSearch, Clock, ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/appStore";
import { tutorials } from "@/data/tutorials";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TutorialProgress } from "@/types/learn";

const iconMap: Record<string, LucideIcon> = {
  Rocket,
  Brain,
  FileSearch,
};

function getProgressBadge(progress: TutorialProgress | undefined) {
  if (!progress) {
    return <Badge variant="muted">Not Started</Badge>;
  }
  if (progress.completed) {
    return <Badge variant="success">Completed</Badge>;
  }
  return <Badge variant="default">In Progress</Badge>;
}

export const TutorialList = memo(function TutorialList() {
  const tutorialProgress = useAppStore((s) => s.learn.tutorialProgress);
  const activeTutorialId = useAppStore((s) => s.learn.activeTutorialId);
  const setActiveTutorialId = useAppStore((s) => s.setActiveTutorialId);

  const handleStartTutorial = useCallback(
    (tutorialId: string) => {
      setActiveTutorialId(tutorialId);
    },
    [setActiveTutorialId],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Tutorials</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Interactive guides to help you learn DDALAB
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tutorials.map((tutorial) => {
          const Icon = iconMap[tutorial.icon] ?? Rocket;
          const progress = tutorialProgress[tutorial.id];

          return (
            <Card
              key={tutorial.id}
              className={cn(
                "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                activeTutorialId === tutorial.id && "border-primary",
              )}
              onClick={() => handleStartTutorial(tutorial.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {tutorial.title}
                      </CardTitle>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{tutorial.estimatedMinutes} min</span>
                      </div>
                    </div>
                  </div>
                  {getProgressBadge(progress)}
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-4">
                  {tutorial.description}
                </CardDescription>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {tutorial.steps.length} steps
                  </span>
                  <Button variant="ghost" size="sm" className="gap-1">
                    {progress && !progress.completed ? "Resume" : "Start"}
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
});
