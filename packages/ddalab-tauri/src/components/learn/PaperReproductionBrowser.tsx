"use client";

import { memo, useState, useCallback, useMemo } from "react";
import { FileSearch, BookOpen, Play, Search, ExternalLink } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { usePaperRecipesIndex } from "@/hooks/useLearn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaperRecipe } from "@/types/learn";

export const PaperReproductionBrowser = memo(
  function PaperReproductionBrowser() {
    const activeRecipeId = useAppStore((s) => s.learn.activeRecipeId);
    const setActiveRecipeId = useAppStore((s) => s.setActiveRecipeId);
    const { data: recipes, isLoading } = usePaperRecipesIndex();
    const [searchQuery, setSearchQuery] = useState("");

    const filteredRecipes = useMemo(() => {
      if (!recipes) return [];
      if (!searchQuery.trim()) return recipes;

      const query = searchQuery.toLowerCase();
      return recipes.filter(
        (recipe: PaperRecipe) =>
          recipe.citation.authors.toLowerCase().includes(query) ||
          recipe.citation.title.toLowerCase().includes(query) ||
          recipe.citation.journal.toLowerCase().includes(query) ||
          recipe.description.toLowerCase().includes(query),
      );
    }, [recipes, searchQuery]);

    const handleRunRecipe = useCallback(
      (recipeId: string) => {
        setActiveRecipeId(recipeId);
      },
      [setActiveRecipeId],
    );

    const handleSearchChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
      },
      [],
    );

    if (isLoading) {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Paper Reproductions
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Reproduce DDA results from published research
            </p>
          </div>
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading paper recipes...
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Paper Reproductions
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Reproduce DDA results from published research
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by author, title, or journal..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-9"
          />
        </div>

        {(!recipes || recipes.length === 0) && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-3">
            <BookOpen className="h-12 w-12 opacity-40" />
            <p className="text-sm">
              No paper recipes available yet. Check back soon!
            </p>
          </div>
        )}

        {recipes && recipes.length > 0 && filteredRecipes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-3">
            <Search className="h-12 w-12 opacity-40" />
            <p className="text-sm">No recipes match your search.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRecipes.map((recipe: PaperRecipe) => (
            <Card key={recipe.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FileSearch className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-base leading-tight">
                      {recipe.citation.title}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {recipe.citation.authors} ({recipe.citation.year})
                    </p>
                    <p className="text-xs text-muted-foreground italic">
                      {recipe.citation.journal}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription>{recipe.description}</CardDescription>

                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {recipe.dataset.source === "sample-data"
                      ? "Sample Data"
                      : "OpenNeuro"}
                  </Badge>
                  {recipe.citation.doi && (
                    <a
                      href={`https://doi.org/${recipe.citation.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      DOI
                    </a>
                  )}
                </div>

                {activeRecipeId === recipe.id ? (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                    Recipe execution coming soon. The full reproduction pipeline
                    is under development.
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => handleRunRecipe(recipe.id)}
                    >
                      <Play className="h-4 w-4" />
                      Run Recipe
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  },
);
