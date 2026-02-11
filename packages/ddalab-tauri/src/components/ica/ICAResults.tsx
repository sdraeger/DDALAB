import React, { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ICAComponentCard } from "./ICAComponentCard";
import { ICATimeSeries, ICATopography, ICASpectrum } from "./ICAVisualizations";
import { ICAReconstructionView } from "./ICAReconstructionView";
import {
  Activity,
  BarChart3,
  LineChart,
  Wand2,
  GitCompareArrows,
} from "lucide-react";
import type { ICAResult, ReconstructResponse } from "@/types/ica";

type ViewMode = "time" | "weights" | "spectrum" | "reconstruction";

interface ICAResultsProps {
  result: ICAResult;
  onComponentSelect?: (componentId: number) => void;
  markedComponents?: Set<number>;
  onToggleMarked?: (componentId: number) => void;
  onAutoMarkArtifacts?: () => void;
  reconstructedData?: ReconstructResponse | null;
}

export function ICAResults({
  result,
  onComponentSelect,
  markedComponents = new Set(),
  onToggleMarked,
  onAutoMarkArtifacts,
  reconstructedData = null,
}: ICAResultsProps) {
  const [selectedComponent, setSelectedComponent] = useState<number>(0);
  const [viewMode, setViewMode] = useState<ViewMode>("time");

  const selectedData = useMemo(() => {
    return result.results.components[selectedComponent] ?? null;
  }, [result, selectedComponent]);

  const handleComponentClick = (componentId: number) => {
    setSelectedComponent(componentId);
    onComponentSelect?.(componentId);
  };

  const markedCount = markedComponents.size;
  const totalComponents = result.results.components.length;

  return (
    <div className="flex h-full">
      {/* Component list — left panel */}
      <div className="w-56 border-r flex flex-col flex-shrink-0">
        <div className="p-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Components</h2>
            {markedCount > 0 && (
              <Badge
                variant="secondary"
                className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 text-[10px]"
              >
                {markedCount} marked
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalComponents} ICs from {result.results.channel_names.length} ch
          </p>
          {onAutoMarkArtifacts && (
            <Button
              size="sm"
              variant="outline"
              className="w-full mt-2"
              onClick={onAutoMarkArtifacts}
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              Auto-mark Artifacts
            </Button>
          )}
        </div>
        <div
          className="flex-1 overflow-y-auto p-2 space-y-1"
          role="listbox"
          aria-label="Independent components"
        >
          {result.results.components.map((comp) => (
            <ICAComponentCard
              key={comp.component_id}
              component={comp}
              channelNames={result.results.channel_names}
              isSelected={selectedComponent === comp.component_id}
              isMarked={markedComponents.has(comp.component_id)}
              onClick={() => handleComponentClick(comp.component_id)}
              onToggleMarked={() => onToggleMarked?.(comp.component_id)}
              variant="row"
            />
          ))}
        </div>
      </div>

      {/* Visualization — right panel */}
      {selectedData && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4">
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <TabsList className="grid w-full max-w-lg flex-shrink-0 grid-cols-4">
              <TabsTrigger value="time" className="flex items-center gap-1.5">
                <LineChart className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Time Series</span>
                <span className="sm:hidden">Time</span>
              </TabsTrigger>
              <TabsTrigger
                value="weights"
                className="flex items-center gap-1.5"
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Channel Weights</span>
                <span className="sm:hidden">Weights</span>
              </TabsTrigger>
              <TabsTrigger
                value="spectrum"
                className="flex items-center gap-1.5"
              >
                <Activity className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Spectrum</span>
                <span className="sm:hidden">Spec</span>
              </TabsTrigger>
              <TabsTrigger
                value="reconstruction"
                className="flex items-center gap-1.5"
                disabled={!reconstructedData}
              >
                <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Reconstruction</span>
                <span className="sm:hidden">Recon</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="time"
              className="flex-1 min-h-0 mt-4 overflow-hidden"
              style={{ contain: "strict" }}
            >
              <ICATimeSeries
                component={selectedData}
                sampleRate={result.results.sample_rate}
              />
            </TabsContent>

            <TabsContent
              value="weights"
              className="flex-1 min-h-0 mt-4 overflow-hidden"
              style={{ contain: "strict" }}
            >
              <ICATopography
                component={selectedData}
                channelNames={result.results.channel_names}
              />
            </TabsContent>

            <TabsContent
              value="spectrum"
              className="flex-1 min-h-0 mt-4 overflow-hidden"
              style={{ contain: "strict" }}
            >
              <ICASpectrum component={selectedData} />
            </TabsContent>

            <TabsContent
              value="reconstruction"
              className="flex-1 min-h-0 mt-4 overflow-hidden"
              style={{ contain: "strict" }}
            >
              {reconstructedData ? (
                <ICAReconstructionView
                  result={result}
                  reconstructedData={reconstructedData}
                  sampleRate={result.results.sample_rate}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <p className="text-sm">
                    Mark components as artifacts and click &quot;Remove
                    Components&quot; to see reconstruction results.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

export default ICAResults;
