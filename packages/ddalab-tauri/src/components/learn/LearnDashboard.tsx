"use client";

import { memo, useCallback } from "react";
import { GraduationCap, BookOpen, Download, FileSearch } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { tutorials } from "@/data/tutorials";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SecondaryNavTab } from "@/types/navigation";

interface DashboardCard {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  countLabel: string;
  tab: SecondaryNavTab;
}

export const LearnDashboard = memo(function LearnDashboard() {
  const sampleDataIndex = useAppStore((s) => s.learn.sampleDataIndex);
  const recipesIndex = useAppStore((s) => s.learn.recipesIndex);
  const setSecondaryNav = useAppStore((s) => s.setSecondaryNav);

  const handleNavigate = useCallback(
    (tab: SecondaryNavTab) => {
      setSecondaryNav(tab);
    },
    [setSecondaryNav],
  );

  const cards: DashboardCard[] = [
    {
      title: "Tutorials",
      description:
        "Interactive step-by-step guides to help you learn DDALAB from the basics to advanced analysis.",
      icon: GraduationCap,
      count: tutorials.length,
      countLabel: "tutorials available",
      tab: "tutorials",
    },
    {
      title: "Sample Data",
      description:
        "Download example neurophysiology datasets for tutorials and experimentation.",
      icon: Download,
      count: sampleDataIndex?.length ?? 0,
      countLabel: "datasets available",
      tab: "sample-data",
    },
    {
      title: "Paper Reproductions",
      description:
        "Browse and reproduce DDA results from published research papers.",
      icon: FileSearch,
      count: recipesIndex?.length ?? 0,
      countLabel: "recipes available",
      tab: "papers",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <BookOpen className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Learn</h2>
          <p className="text-sm text-muted-foreground">
            Tutorials, sample data, and paper reproductions
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.tab}
              className="cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
              onClick={() => handleNavigate(card.tab)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{card.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>{card.description}</CardDescription>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-primary">
                    {card.count} {card.countLabel}
                  </span>
                  <Button variant="ghost" size="sm">
                    Explore
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
