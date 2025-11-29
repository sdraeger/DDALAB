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
import { Checkbox } from "@/components/ui/checkbox";
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
  Info,
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
  SweepParameter,
  ParameterRange,
  SENSITIVITY_PRESETS,
  DEFAULT_PARAMETER_RANGES,
  SensitivityBaseConfig,
} from "@/types/sensitivity";
import { toast } from "@/components/ui/toaster";
import { ApiService } from "@/services/apiService";

export interface SensitivityAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiService: ApiService;
  baseConfig: SensitivityBaseConfig;
}

type PresetKey = keyof typeof SENSITIVITY_PRESETS;

export function SensitivityAnalysisDialog({
  open,
  onOpenChange,
  apiService,
  baseConfig,
}: SensitivityAnalysisDialogProps) {
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("standard");
  const [selectedParameters, setSelectedParameters] = useState<
    Set<SweepParameter>
  >(new Set(["window_length", "delay_num"]));
  const [customRanges, setCustomRanges] = useState<
    Record<SweepParameter, { min: number; max: number }>
  >({
    window_length: { min: 32, max: 256 },
    window_step: { min: 5, max: 50 },
    delay_min: { min: 1, max: 5 },
    delay_max: { min: 10, max: 50 },
    delay_num: { min: 10, max: 40 },
  });

  const [analysis, setAnalysis] = useState<SensitivityAnalysis | null>(null);
  const [report, setReport] = useState<SensitivityReport | null>(null);
  const [activeTab, setActiveTab] = useState("configure");

  const totalCombinations = useMemo(() => {
    const steps = SENSITIVITY_PRESETS[selectedPreset].steps;
    return Math.pow(steps, selectedParameters.size);
  }, [selectedPreset, selectedParameters]);

  const estimatedTime = useMemo(() => {
    // Rough estimate: 2 seconds per analysis
    const seconds = totalCombinations * 2;
    if (seconds < 60) return `~${seconds}s`;
    if (seconds < 3600) return `~${Math.round(seconds / 60)}min`;
    return `~${Math.round(seconds / 3600)}h`;
  }, [totalCombinations]);

  const handleParameterToggle = useCallback((param: SweepParameter) => {
    setSelectedParameters((prev) => {
      const next = new Set(prev);
      if (next.has(param)) {
        next.delete(param);
      } else {
        next.add(param);
      }
      return next;
    });
  }, []);

  const handleRangeChange = useCallback(
    (param: SweepParameter, field: "min" | "max", value: number) => {
      setCustomRanges((prev) => ({
        ...prev,
        [param]: { ...prev[param], [field]: value },
      }));
    },
    [],
  );

  const handleRunAnalysis = useCallback(async () => {
    if (baseConfig.channels.length === 0) {
      toast.error("Please select channels first");
      return;
    }

    const sweepParameters: ParameterRange[] = Array.from(
      selectedParameters,
    ).map((param) => ({
      parameter: param,
      min: customRanges[param].min,
      max: customRanges[param].max,
      steps: SENSITIVITY_PRESETS[selectedPreset].steps,
    }));

    const config: SensitivityConfig = {
      baseConfig,
      sweepParameters,
      maxConcurrent: 2,
    };

    setActiveTab("progress");
    setReport(null);

    try {
      const result = await runSensitivityAnalysis(
        apiService,
        config,
        (progress) => {
          setAnalysis({ ...progress });
        },
      );

      setAnalysis(result);

      if (result.status === "completed") {
        const sensitivityReport = generateSensitivityReport(result);
        setReport(sensitivityReport);
        setActiveTab("results");
        toast.success("Sensitivity analysis completed");
      } else {
        toast.error("Sensitivity analysis failed");
      }
    } catch (error) {
      toast.error(
        `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [
    apiService,
    baseConfig,
    selectedPreset,
    selectedParameters,
    customRanges,
  ]);

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
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Parameter Sensitivity Analysis
          </DialogTitle>
          <DialogDescription>
            Analyze how DDA results change with different parameter settings
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
            <TabsContent value="configure" className="space-y-6 px-1">
              {/* Preset Selection */}
              <div className="space-y-2">
                <Label>Analysis Depth</Label>
                <Select
                  value={selectedPreset}
                  onValueChange={(v) => setSelectedPreset(v as PresetKey)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SENSITIVITY_PRESETS).map(
                      ([key, preset]) => (
                        <SelectItem key={key} value={key}>
                          <div className="flex flex-col">
                            <span>{preset.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {preset.description}
                            </span>
                          </div>
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Parameter Selection */}
              <div className="space-y-3">
                <Label>Parameters to Analyze</Label>
                <div className="grid grid-cols-1 gap-3">
                  {(
                    Object.keys(DEFAULT_PARAMETER_RANGES) as SweepParameter[]
                  ).map((param) => (
                    <div
                      key={param}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border",
                        selectedParameters.has(param)
                          ? "border-primary bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedParameters.has(param)}
                          onCheckedChange={() => handleParameterToggle(param)}
                        />
                        <div>
                          <div className="font-medium capitalize">
                            {param.replace(/_/g, " ")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {DEFAULT_PARAMETER_RANGES[param].description}
                          </div>
                        </div>
                      </div>

                      {selectedParameters.has(param) && (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={customRanges[param].min}
                            onChange={(e) =>
                              handleRangeChange(
                                param,
                                "min",
                                Number(e.target.value),
                              )
                            }
                            className="w-20 h-8"
                            min={1}
                          />
                          <span className="text-muted-foreground">to</span>
                          <Input
                            type="number"
                            value={customRanges[param].max}
                            onChange={(e) =>
                              handleRangeChange(
                                param,
                                "max",
                                Number(e.target.value),
                              )
                            }
                            className="w-20 h-8"
                            min={1}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Analysis Summary</div>
                  <div className="text-xs text-muted-foreground">
                    {totalCombinations} parameter combinations
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{estimatedTime}</div>
                  <div className="text-xs text-muted-foreground">
                    estimated time
                  </div>
                </div>
              </div>

              {totalCombinations > 100 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-yellow-700 dark:text-yellow-300">
                    Large number of combinations. Consider reducing parameters
                    or using Quick Scan.
                  </span>
                </div>
              )}
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
                      report.stability.is_stable
                        ? "bg-green-500/10 border-green-500/20"
                        : "bg-yellow-500/10 border-yellow-500/20",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {report.stability.is_stable ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-yellow-500" />
                      )}
                      <span className="font-medium">
                        {report.stability.is_stable
                          ? "Results are stable"
                          : "Results show sensitivity to parameters"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Stability score:{" "}
                      {(report.stability.stability_score * 100).toFixed(1)}%
                      {report.stability.unstable_parameters.length > 0 && (
                        <>
                          {" "}
                          • Sensitive to:{" "}
                          {report.stability.unstable_parameters
                            .map((p) => p.replace(/_/g, " "))
                            .join(", ")}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Parameter Rankings */}
                  <div className="space-y-3">
                    <h3 className="font-medium">
                      Parameter Sensitivity Ranking
                    </h3>
                    <div className="space-y-2">
                      {report.parameter_rankings.map((ranking, index) => (
                        <div
                          key={ranking.parameter}
                          className="flex items-center gap-3 p-3 rounded-lg border"
                        >
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <div className="font-medium capitalize">
                              {ranking.parameter.replace(/_/g, " ")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Correlation: {ranking.correlation.toFixed(3)} •
                              Optimal: {ranking.optimal_value}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge
                              variant={
                                ranking.sensitivity_score > 0.5
                                  ? "destructive"
                                  : ranking.sensitivity_score > 0.2
                                    ? "default"
                                    : "secondary"
                              }
                            >
                              {ranking.sensitivity_score > 0.5
                                ? "High"
                                : ranking.sensitivity_score > 0.2
                                  ? "Medium"
                                  : "Low"}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div className="space-y-3">
                    <h3 className="font-medium">Recommendations</h3>
                    <div className="space-y-2">
                      {report.recommendations.map((rec) => (
                        <div
                          key={rec.parameter}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                        >
                          <Info className="h-4 w-4 mt-0.5 text-blue-500" />
                          <div>
                            <div className="font-medium capitalize">
                              {rec.parameter.replace(/_/g, " ")}:{" "}
                              {rec.recommended_value}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {rec.reason}
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
                  selectedParameters.size === 0 ||
                  baseConfig.channels.length === 0
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
