"use client";

import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Square,
  Settings2,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  runSensitivityAnalysis,
  generateSensitivityReport,
  cancelSensitivityAnalysis,
} from "@/services/sensitivityService";
import {
  SensitivityConfig,
  SensitivityAnalysis,
  SensitivityReport,
  ParameterSet,
  DDAModelParams,
  PARAMETER_SET_TEMPLATES,
  SensitivityBaseConfig,
} from "@/types/sensitivity";
import { toast } from "@/components/ui/toaster";

export interface SensitivityAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseConfig: SensitivityBaseConfig;
}

type TemplateKey = keyof typeof PARAMETER_SET_TEMPLATES;

function generateId(): string {
  return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createParameterSetFromTemplate(
  templateKey: TemplateKey,
  name?: string,
): ParameterSet {
  const template = PARAMETER_SET_TEMPLATES[templateKey];
  return {
    id: generateId(),
    name: name || templateKey.replace(/_/g, " "),
    params: { ...template },
  };
}

function formatDelays(delays: number[]): string {
  return delays.join(", ");
}

function parseDelays(input: string): number[] {
  return input
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

export function SensitivityAnalysisDialog({
  open,
  onOpenChange,
  baseConfig,
}: SensitivityAnalysisDialogProps) {
  const [parameterSets, setParameterSets] = useState<ParameterSet[]>([
    createParameterSetFromTemplate("default", "Default"),
    createParameterSetFromTemplate("short_window", "Short Window"),
    createParameterSetFromTemplate("long_window", "Long Window"),
  ]);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SensitivityAnalysis | null>(null);
  const [report, setReport] = useState<SensitivityReport | null>(null);
  const [activeTab, setActiveTab] = useState("configure");

  const editingSet = useMemo(
    () => parameterSets.find((p) => p.id === editingSetId),
    [parameterSets, editingSetId],
  );

  const handleAddFromTemplate = useCallback((templateKey: TemplateKey) => {
    const newSet = createParameterSetFromTemplate(templateKey);
    setParameterSets((prev) => [...prev, newSet]);
  }, []);

  const handleAddCustom = useCallback(() => {
    const newSet: ParameterSet = {
      id: generateId(),
      name: `Custom ${parameterSets.length + 1}`,
      params: {
        window_length: 100,
        window_step: 10,
        delays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        model_dimension: 4,
        polynomial_order: 4,
        nr_tau: 2,
      },
    };
    setParameterSets((prev) => [...prev, newSet]);
    setEditingSetId(newSet.id);
  }, [parameterSets.length]);

  const handleDuplicateSet = useCallback((set: ParameterSet) => {
    const newSet: ParameterSet = {
      id: generateId(),
      name: `${set.name} (copy)`,
      params: { ...set.params, delays: [...set.params.delays] },
    };
    setParameterSets((prev) => [...prev, newSet]);
  }, []);

  const handleRemoveSet = useCallback((id: string) => {
    setParameterSets((prev) => prev.filter((p) => p.id !== id));
    setEditingSetId((prevId) => (prevId === id ? null : prevId));
  }, []);

  const handleUpdateSet = useCallback(
    (id: string, updates: Partial<ParameterSet>) => {
      setParameterSets((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  const handleUpdateParams = useCallback(
    (id: string, paramUpdates: Partial<DDAModelParams>) => {
      setParameterSets((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, params: { ...p.params, ...paramUpdates } } : p,
        ),
      );
    },
    [],
  );

  const handleRunAnalysis = useCallback(async () => {
    if (baseConfig.channels.length === 0) {
      toast.error("Please select channels first");
      return;
    }

    if (parameterSets.length === 0) {
      toast.error("Please add at least one parameter set");
      return;
    }

    const config: SensitivityConfig = {
      baseConfig,
      parameterSets,
      maxConcurrent: 2,
    };

    setActiveTab("progress");
    setReport(null);
    setEditingSetId(null);

    try {
      const result = await runSensitivityAnalysis(config, (progress) => {
        setAnalysis({ ...progress });
      });

      setAnalysis(result);

      if (result.status === "completed") {
        const sensitivityReport = generateSensitivityReport(result);
        setReport(sensitivityReport);
        setActiveTab("results");
        toast.success("Sensitivity analysis completed");
      } else if (result.status === "cancelled") {
        toast.info("Sensitivity analysis cancelled");
      } else {
        toast.error("Sensitivity analysis failed");
      }
    } catch (error) {
      toast.error(
        `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [baseConfig, parameterSets]);

  const handleCancel = useCallback(() => {
    if (analysis?.id) {
      cancelSensitivityAnalysis(analysis.id);
      setAnalysis((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    }
  }, [analysis?.id]);

  const isRunning = analysis?.status === "running";
  const progressPercent = analysis
    ? (analysis.progress.completed / analysis.progress.total) * 100
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Parameter Sensitivity Analysis
          </DialogTitle>
          <DialogDescription>
            Compare DDA results across different parameter configurations
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="configure" disabled={isRunning}>
              <Settings2 className="h-4 w-4 mr-2" />
              Configure
            </TabsTrigger>
            <TabsTrigger value="progress">
              <BarChart3 className="h-4 w-4 mr-2" />
              Progress
            </TabsTrigger>
            <TabsTrigger value="results" disabled={!report}>
              <TrendingUp className="h-4 w-4 mr-2" />
              Results
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            <TabsContent value="configure" className="space-y-4 px-1">
              {/* Add Parameter Set */}
              <div className="flex items-center gap-2">
                <Select
                  onValueChange={(v) => handleAddFromTemplate(v as TemplateKey)}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Add from template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(PARAMETER_SET_TEMPLATES).map((key) => (
                      <SelectItem key={key} value={key}>
                        {key.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleAddCustom}>
                  <Plus className="h-4 w-4 mr-1" />
                  Custom
                </Button>
              </div>

              {/* Parameter Sets List */}
              <div className="space-y-3">
                <Label>Parameter Sets ({parameterSets.length})</Label>
                {parameterSets.map((set) => (
                  <div
                    key={set.id}
                    className={cn(
                      "p-3 rounded-lg border",
                      editingSetId === set.id
                        ? "border-primary bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {editingSetId === set.id ? (
                          <Input
                            value={set.name}
                            onChange={(e) =>
                              handleUpdateSet(set.id, { name: e.target.value })
                            }
                            className="h-7 w-40"
                          />
                        ) : (
                          <span
                            className="font-medium cursor-pointer hover:text-primary"
                            onClick={() => setEditingSetId(set.id)}
                          >
                            {set.name}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDuplicateSet(set)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleRemoveSet(set.id)}
                          disabled={parameterSets.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {editingSetId === set.id ? (
                      <div className="space-y-3 mt-3 pt-3 border-t">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Window Length</Label>
                            <Input
                              type="number"
                              value={set.params.window_length}
                              onChange={(e) =>
                                handleUpdateParams(set.id, {
                                  window_length:
                                    parseInt(e.target.value) || 100,
                                })
                              }
                              className="h-8 mt-1"
                              min={10}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Window Step</Label>
                            <Input
                              type="number"
                              value={set.params.window_step}
                              onChange={(e) =>
                                handleUpdateParams(set.id, {
                                  window_step: parseInt(e.target.value) || 10,
                                })
                              }
                              className="h-8 mt-1"
                              min={1}
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">
                            Delays (comma-separated)
                          </Label>
                          <Input
                            value={formatDelays(set.params.delays)}
                            onChange={(e) =>
                              handleUpdateParams(set.id, {
                                delays: parseDelays(e.target.value),
                              })
                            }
                            className="h-8 mt-1 font-mono text-sm"
                            placeholder="1, 2, 3, 4, 5..."
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Model Dimension</Label>
                            <Input
                              type="number"
                              value={set.params.model_dimension ?? 4}
                              onChange={(e) =>
                                handleUpdateParams(set.id, {
                                  model_dimension:
                                    parseInt(e.target.value) || 4,
                                })
                              }
                              className="h-8 mt-1"
                              min={1}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Polynomial Order</Label>
                            <Input
                              type="number"
                              value={set.params.polynomial_order ?? 4}
                              onChange={(e) =>
                                handleUpdateParams(set.id, {
                                  polynomial_order:
                                    parseInt(e.target.value) || 4,
                                })
                              }
                              className="h-8 mt-1"
                              min={1}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Nr Tau</Label>
                            <Input
                              type="number"
                              value={set.params.nr_tau ?? 2}
                              onChange={(e) =>
                                handleUpdateParams(set.id, {
                                  nr_tau: parseInt(e.target.value) || 2,
                                })
                              }
                              className="h-8 mt-1"
                              min={1}
                            />
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingSetId(null)}
                        >
                          Done
                        </Button>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>
                          Window: {set.params.window_length} / step{" "}
                          {set.params.window_step}
                        </div>
                        <div className="truncate">
                          Delays: [{formatDelays(set.params.delays)}]
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Analysis Summary</div>
                  <div className="text-xs text-muted-foreground">
                    {parameterSets.length} parameter set
                    {parameterSets.length !== 1 ? "s" : ""} to compare
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="progress" className="space-y-4 px-1">
              {analysis ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Progress</span>
                      <span className="text-sm text-muted-foreground">
                        {analysis.progress.completed} /{" "}
                        {analysis.progress.total}
                      </span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <div className="text-2xl font-bold">
                        {analysis.progress.completed}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Completed
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <div className="text-2xl font-bold text-red-500">
                        {analysis.progress.failed}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Failed
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <div className="text-2xl font-bold">
                        {analysis.progress.total -
                          analysis.progress.completed -
                          analysis.progress.failed}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Remaining
                      </div>
                    </div>
                  </div>

                  {isRunning && (
                    <div className="flex items-center justify-center gap-2 py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        Running analysis...
                      </span>
                    </div>
                  )}

                  {analysis.status === "completed" && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-700 dark:text-green-300">
                        Analysis completed successfully
                      </span>
                    </div>
                  )}

                  {analysis.status === "cancelled" && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm text-yellow-700 dark:text-yellow-300">
                        Analysis was cancelled
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mb-4 opacity-50" />
                  <p>No analysis running</p>
                  <p className="text-sm">Configure and start an analysis</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="results" className="space-y-4 px-1">
              {report ? (
                <>
                  {/* Stability Assessment */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border",
                      report.summary.is_stable
                        ? "bg-green-500/10 border-green-500/20"
                        : "bg-yellow-500/10 border-yellow-500/20",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {report.summary.is_stable ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                      <span className="font-medium">
                        {report.summary.is_stable
                          ? "Results are stable across parameter sets"
                          : "Results vary significantly across parameter sets"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Overall mean Q: {report.summary.overall_mean_q.toFixed(4)}{" "}
                      | Variance:{" "}
                      {report.summary.variance_across_sets.toFixed(4)}
                    </p>
                  </div>

                  {/* Best Parameters */}
                  {report.best_params && (
                    <div className="p-4 rounded-lg border bg-primary/5 border-primary/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="default">Best</Badge>
                        <span className="font-medium">
                          {report.best_params.name}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <div>
                          Window: {report.best_params.params.window_length} /
                          step {report.best_params.params.window_step}
                        </div>
                        <div>
                          Delays: [
                          {formatDelays(report.best_params.params.delays)}]
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Comparison Table */}
                  <div className="space-y-3">
                    <h3 className="font-medium">Parameter Set Comparison</h3>
                    <div className="space-y-2">
                      {report.comparisons
                        .sort((a, b) => b.mean_q - a.mean_q)
                        .map((comparison, index) => (
                          <div
                            key={comparison.parameter_set_id}
                            className="flex items-center gap-3 p-3 rounded-lg border"
                          >
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                              {index + 1}
                            </div>
                            <div className="flex-1">
                              <div className="font-medium">
                                {comparison.parameter_set_name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Window: {comparison.params.window_length} |
                                Delays: {comparison.params.delays.length}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono text-sm">
                                Q: {comparison.mean_q.toFixed(4)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                std: {comparison.std_q.toFixed(4)}
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <TrendingUp className="h-12 w-12 mb-4 opacity-50" />
                  <p>No results yet</p>
                  <p className="text-sm">Run an analysis to see results</p>
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="mt-4">
          {isRunning ? (
            <Button variant="destructive" onClick={handleCancel}>
              <Square className="h-4 w-4 mr-2" />
              Cancel Analysis
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                onClick={handleRunAnalysis}
                disabled={
                  parameterSets.length === 0 || baseConfig.channels.length === 0
                }
              >
                <Play className="h-4 w-4 mr-2" />
                Run Analysis
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
