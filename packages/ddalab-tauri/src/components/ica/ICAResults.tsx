import React, { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ICAComponentCard } from "./ICAComponentCard";
import { ICATimeSeries, ICATopography, ICASpectrum } from "./ICAVisualizations";
import { Activity, BarChart3, LineChart, Info } from "lucide-react";
import type { ICAResult } from "@/types/ica";

type ViewMode = "time" | "topography" | "spectrum";

interface ICAResultsProps {
  result: ICAResult;
  onComponentSelect?: (componentId: number) => void;
  markedComponents?: Set<number>;
  onToggleMarked?: (componentId: number) => void;
}

export function ICAResults({
  result,
  onComponentSelect,
  markedComponents = new Set(),
  onToggleMarked,
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
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">ICA Results</h2>
          <p className="text-sm text-muted-foreground">
            {totalComponents} independent components from{" "}
            {result.results.channel_names.length} channels
          </p>
        </div>
        <div className="flex items-center gap-2">
          {markedCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
            >
              {markedCount} marked for removal
            </Badge>
          )}
        </div>
      </div>

      {/* Component Grid */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Click a component to view details. Mark components to remove
          artifacts.
        </div>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 max-h-52 overflow-y-auto p-1"
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
            />
          ))}
        </div>
      </div>

      {/* Visualization Tabs */}
      {selectedData && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            <TabsList className="grid w-full grid-cols-3 max-w-md flex-shrink-0">
              <TabsTrigger value="time" className="flex items-center gap-2">
                <LineChart className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Time Series</span>
                <span className="sm:hidden">Time</span>
              </TabsTrigger>
              <TabsTrigger
                value="topography"
                className="flex items-center gap-2"
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Topography</span>
                <span className="sm:hidden">Topo</span>
              </TabsTrigger>
              <TabsTrigger value="spectrum" className="flex items-center gap-2">
                <Activity className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Spectrum</span>
                <span className="sm:hidden">Spec</span>
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
              value="topography"
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
          </Tabs>
        </div>
      )}
    </div>
  );
}

export default ICAResults;
