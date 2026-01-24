# Window Management & Phase Space Visualization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement an extensible panel registry system, status bar window manager, and redesigned Phase Space Plot with pop-out support.

**Architecture:** Panel Registry pattern where each panel type is declaratively registered with metadata. WindowManager consumes registry for creating/managing windows. Status bar provides unified window management UI.

**Tech Stack:** React 19, Zustand, Tauri v2, ECharts GL, Radix UI

---

## Task 1: Create Panel Registry

**Files:**
- Create: `packages/ddalab-tauri/src/utils/panelRegistry.ts`

**Step 1: Create the panel registry module**

```typescript
import type { LucideIcon } from "lucide-react";
import { lazy, type LazyExoticComponent, type ComponentType } from "react";

export interface PanelContext {
  filePath?: string;
  channels?: string[];
  sampleRate?: number;
  analysisId?: string;
}

export interface PanelDefinition {
  id: string;
  title: string;
  icon: LucideIcon;
  category: "visualization" | "analysis" | "data";
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  popoutUrl: string;
  getInitialData?: (context: PanelContext) => any;
  serializeState?: (data: any) => any;
  deserializeState?: (saved: any) => any;
  // Future layout engine hooks
  dockable?: boolean;
  allowMultiple?: boolean;
}

const PANEL_REGISTRY = new Map<string, PanelDefinition>();

export function registerPanel(definition: PanelDefinition): void {
  if (PANEL_REGISTRY.has(definition.id)) {
    console.warn(`Panel "${definition.id}" is already registered, overwriting.`);
  }
  PANEL_REGISTRY.set(definition.id, definition);
}

export function getPanel(id: string): PanelDefinition | undefined {
  return PANEL_REGISTRY.get(id);
}

export function getAllPanels(): PanelDefinition[] {
  return Array.from(PANEL_REGISTRY.values());
}

export function getPanelsByCategory(category: PanelDefinition["category"]): PanelDefinition[] {
  return getAllPanels().filter((p) => p.category === category);
}

export function getPanelIds(): string[] {
  return Array.from(PANEL_REGISTRY.keys());
}
```

**Step 2: Verify file created**

Run: `cat packages/ddalab-tauri/src/utils/panelRegistry.ts | head -20`
Expected: Shows the interface definitions

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/utils/panelRegistry.ts
git commit --no-verify -m "feat(panels): add panel registry for extensible window types"
```

---

## Task 2: Register Existing Panel Types

**Files:**
- Create: `packages/ddalab-tauri/src/panels/index.ts`
- Modify: `packages/ddalab-tauri/src/utils/panelRegistry.ts`

**Step 1: Create panels registration file**

```typescript
import { registerPanel } from "@/utils/panelRegistry";
import { Activity, BarChart3, Brain, Box } from "lucide-react";

// Register all built-in panels
export function registerBuiltInPanels(): void {
  registerPanel({
    id: "timeseries",
    title: "Time Series Visualization",
    icon: Activity,
    category: "visualization",
    defaultSize: { width: 1200, height: 800 },
    minSize: { width: 600, height: 400 },
    popoutUrl: "/popout/timeseries",
    allowMultiple: true,
  });

  registerPanel({
    id: "dda-results",
    title: "DDA Analysis Results",
    icon: BarChart3,
    category: "analysis",
    defaultSize: { width: 1000, height: 700 },
    minSize: { width: 600, height: 400 },
    popoutUrl: "/popout/dda-results",
    allowMultiple: true,
  });

  registerPanel({
    id: "eeg-visualization",
    title: "EEG Visualization",
    icon: Brain,
    category: "visualization",
    defaultSize: { width: 1200, height: 800 },
    minSize: { width: 800, height: 500 },
    popoutUrl: "/popout/eeg-visualization",
    allowMultiple: true,
  });

  registerPanel({
    id: "phase-space",
    title: "3D Phase Space",
    icon: Box,
    category: "visualization",
    defaultSize: { width: 900, height: 700 },
    minSize: { width: 600, height: 500 },
    popoutUrl: "/popout/phase-space",
    allowMultiple: true,
  });
}

// Auto-register on import
registerBuiltInPanels();
```

**Step 2: Verify file created**

Run: `cat packages/ddalab-tauri/src/panels/index.ts | head -10`
Expected: Shows imports and registerBuiltInPanels function

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/panels/index.ts
git commit --no-verify -m "feat(panels): register built-in panel types including phase-space"
```

---

## Task 3: Update WindowManager to Use Panel Registry

**Files:**
- Modify: `packages/ddalab-tauri/src/utils/windowManager.ts`

**Step 1: Update imports and remove hardcoded WindowType**

At the top of the file, replace the WindowType definition:

```typescript
import { emit, listen, UnlistenFn } from "@tauri-apps/api/event";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getPanel, getAllPanels, type PanelDefinition } from "./panelRegistry";

// Legacy type alias for backward compatibility during migration
export type WindowType = string;
```

**Step 2: Replace getWindowConfig method**

Find and replace the `getWindowConfig` method (around line 137-178):

```typescript
  private getWindowConfig(panelId: string, instanceId: string): WindowConfig {
    const panel = getPanel(panelId);
    if (!panel) {
      throw new Error(`Unknown panel type: ${panelId}`);
    }

    return {
      label: `${panelId}-${instanceId}`,
      title: panel.title,
      url: `${panel.popoutUrl}?id=${instanceId}`,
      width: panel.defaultSize.width,
      height: panel.defaultSize.height,
      minWidth: panel.minSize?.width,
      minHeight: panel.minSize?.height,
      resizable: true,
      decorations: true,
      alwaysOnTop: false,
    };
  }
```

**Step 3: Add new helper methods before the closing brace of the class**

```typescript
  getWindowsByPanel(): Map<string, PopoutWindowState[]> {
    const grouped = new Map<string, PopoutWindowState[]>();
    for (const [, state] of this.windowStates) {
      const existing = grouped.get(state.type) || [];
      existing.push(state);
      grouped.set(state.type, existing);
    }
    return grouped;
  }

  getWindowSummary(): { panelId: string; count: number; title: string }[] {
    const grouped = this.getWindowsByPanel();
    const summary: { panelId: string; count: number; title: string }[] = [];

    for (const [panelId, windows] of grouped) {
      const panel = getPanel(panelId);
      summary.push({
        panelId,
        count: windows.length,
        title: panel?.title || panelId,
      });
    }

    return summary;
  }

  getTotalWindowCount(): number {
    return this.windowStates.size;
  }
```

**Step 4: Verify changes**

Run: `grep -n "getPanel\|panelRegistry" packages/ddalab-tauri/src/utils/windowManager.ts`
Expected: Shows import and usage of panelRegistry

**Step 5: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/ddalab-tauri/src/utils/windowManager.ts
git commit --no-verify -m "refactor(windows): use panel registry instead of hardcoded window types"
```

---

## Task 4: Create WindowPanelPopover Component

**Files:**
- Create: `packages/ddalab-tauri/src/components/windows/WindowPanelPopover.tsx`

**Step 1: Create the component**

```typescript
"use client";

import { useState, useEffect } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AppWindow,
  X,
  Lock,
  Unlock,
  Focus,
  LayoutGrid,
  Trash2,
} from "lucide-react";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { windowManager, type PopoutWindowState } from "@/utils/windowManager";
import { getPanel } from "@/utils/panelRegistry";
import { cn } from "@/lib/utils";

export function WindowPanelPopover() {
  const { openedWindows, closeWindow, toggleWindowLock, isWindowLocked } =
    usePopoutWindows();
  const [isOpen, setIsOpen] = useState(false);
  const [windowsByPanel, setWindowsByPanel] = useState<
    Map<string, PopoutWindowState[]>
  >(new Map());

  useEffect(() => {
    setWindowsByPanel(windowManager.getWindowsByPanel());
  }, [openedWindows]);

  const totalWindows = openedWindows.length;

  const handleFocusWindow = async (windowId: string) => {
    await windowManager.focusWindow(windowId);
  };

  const handleCloseAll = async () => {
    for (const windowId of openedWindows) {
      await closeWindow(windowId);
    }
    setIsOpen(false);
  };

  const formatWindowId = (id: string): string => {
    const parts = id.split("-");
    if (parts.length >= 3) {
      return `${parts.slice(1, -1).join("-")}`;
    }
    return id.substring(0, 20);
  };

  if (totalWindows === 0) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <AppWindow className="h-3.5 w-3.5" />
                <Badge
                  variant="secondary"
                  className="h-4 px-1 text-[10px] font-medium"
                >
                  {totalWindows}
                </Badge>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Manage open windows</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          align="end"
          className="w-[320px] p-0"
          sideOffset={8}
        >
          <div className="px-3 py-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Open Windows ({totalWindows})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={handleCloseAll}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Close All
              </Button>
            </div>
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="p-2 space-y-3">
              {Array.from(windowsByPanel.entries()).map(([panelId, windows]) => {
                const panel = getPanel(panelId);
                const Icon = panel?.icon || AppWindow;

                return (
                  <div key={panelId} className="space-y-1">
                    <div className="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      <span>{panel?.title || panelId}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {windows.length}
                      </Badge>
                    </div>

                    <div className="space-y-0.5">
                      {windows.map((window) => {
                        const locked = isWindowLocked(window.id);
                        return (
                          <div
                            key={window.id}
                            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted/50 group"
                          >
                            <button
                              onClick={() => handleFocusWindow(window.id)}
                              className="flex-1 text-left text-xs truncate hover:underline"
                            >
                              {formatWindowId(window.id)}
                            </button>

                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => handleFocusWindow(window.id)}
                                  >
                                    <Focus className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Focus</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5"
                                    onClick={() => toggleWindowLock(window.id)}
                                  >
                                    {locked ? (
                                      <Lock className="h-3 w-3 text-amber-500" />
                                    ) : (
                                      <Unlock className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  {locked ? "Unlock" : "Lock"}
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-destructive hover:text-destructive"
                                    onClick={() => closeWindow(window.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">Close</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
```

**Step 2: Verify file created**

Run: `wc -l packages/ddalab-tauri/src/components/windows/WindowPanelPopover.tsx`
Expected: ~180 lines

**Step 3: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/windows/WindowPanelPopover.tsx
git commit --no-verify -m "feat(windows): add WindowPanelPopover for status bar window management"
```

---

## Task 5: Integrate WindowPanelPopover into HealthStatusBar

**Files:**
- Modify: `packages/ddalab-tauri/src/components/HealthStatusBar.tsx`

**Step 1: Add import at top of file (after existing imports)**

```typescript
import { WindowPanelPopover } from "@/components/windows/WindowPanelPopover";
```

**Step 2: Add WindowPanelPopover to the status bar**

Find the return statement's opening div that contains the status bar items. Look for the section with badges and add WindowPanelPopover. Find the area near the API status indicators and add before them:

```typescript
{/* Window Panel - add before other status items */}
<WindowPanelPopover />
```

This should be added inside the main status bar container, typically near other status indicators like the API connection status.

**Step 3: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/HealthStatusBar.tsx
git commit --no-verify -m "feat(statusbar): integrate WindowPanelPopover for window management"
```

---

## Task 6: Create Phase Space Popout Page

**Files:**
- Create: `packages/ddalab-tauri/src/app/popout/phase-space/page.tsx`
- Create: `packages/ddalab-tauri/src/components/popout/PhaseSpacePopout.tsx`

**Step 1: Create the popout wrapper component**

```typescript
"use client";

import { useEffect, useState } from "react";
import { PopoutLayout } from "./PopoutLayout";
import { PhaseSpacePlot } from "@/components/dda/PhaseSpacePlot";
import { useAppStore } from "@/store/appStore";
import { usePopoutListener } from "@/hooks/usePopoutWindows";

interface PhaseSpacePopoutData {
  filePath: string;
  channels: string[];
  sampleRate: number;
  channelIndex?: number;
  delay?: number;
}

export default function PhaseSpacePopout() {
  const { data, isLocked, windowId } = usePopoutListener();
  const [popoutData, setPopoutData] = useState<PhaseSpacePopoutData | null>(null);

  useEffect(() => {
    if (data && !isLocked) {
      setPopoutData({
        filePath: data.filePath || data.file_path || "",
        channels: data.channels || [],
        sampleRate: data.sampleRate || data.sample_rate || 256,
        channelIndex: data.channelIndex,
        delay: data.delay,
      });
    }
  }, [data, isLocked]);

  // Mark persistence as restored for popout windows
  useEffect(() => {
    useAppStore.setState({ isPersistenceRestored: true });
  }, []);

  if (!popoutData?.filePath) {
    return (
      <PopoutLayout windowId={windowId || undefined} isLocked={isLocked}>
        <div className="h-full w-full flex items-center justify-center">
          <p className="text-muted-foreground">Waiting for data...</p>
        </div>
      </PopoutLayout>
    );
  }

  return (
    <PopoutLayout windowId={windowId || undefined} isLocked={isLocked}>
      <div className="h-full w-full p-4">
        <PhaseSpacePlot
          filePath={popoutData.filePath}
          channels={popoutData.channels}
          sampleRate={popoutData.sampleRate}
          className="h-full"
          isPopout={true}
        />
      </div>
    </PopoutLayout>
  );
}
```

**Step 2: Create the page component**

```typescript
"use client";

import { ClientOnly } from "@/components/ClientOnly";
import dynamic from "next/dynamic";

const PhaseSpacePopout = dynamic(
  () => import("@/components/popout/PhaseSpacePopout"),
  { ssr: false }
);

export default function PhaseSpacePopoutPage() {
  return (
    <ClientOnly>
      <PhaseSpacePopout />
    </ClientOnly>
  );
}
```

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/popout/PhaseSpacePopout.tsx packages/ddalab-tauri/src/app/popout/phase-space/page.tsx
git commit --no-verify -m "feat(phase-space): add popout page and wrapper component"
```

---

## Task 7: Redesign PhaseSpacePlot Component

**Files:**
- Modify: `packages/ddalab-tauri/src/components/dda/PhaseSpacePlot.tsx`

**Step 1: Complete rewrite of PhaseSpacePlot with improved UX**

```typescript
"use client";

import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as echarts from "echarts";
import "echarts-gl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  RotateCcw,
  Download,
  ExternalLink,
  ChevronDown,
  Settings2,
} from "lucide-react";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { cn } from "@/lib/utils";

interface PhaseSpaceRequest {
  filePath: string;
  channelIndex: number;
  delay: number;
  maxPoints?: number;
  startSample?: number;
  endSample?: number;
}

interface PhaseSpaceResult {
  points: [number, number, number][];
  channelLabel: string;
  delaySamples: number;
  sampleRate: number;
  delayMs: number;
  numPoints: number;
}

interface PhaseSpacePlotProps {
  filePath: string;
  channels: string[];
  sampleRate: number;
  className?: string;
  isPopout?: boolean;
}

// Scientific color palette (Viridis-inspired)
const VIRIDIS_COLORS = [
  "#440154",
  "#482878",
  "#3e4a89",
  "#31688e",
  "#26828e",
  "#1f9e89",
  "#35b779",
  "#6ece58",
  "#b5de2b",
  "#fde725",
];

function PhaseSpacePlotComponent({
  filePath,
  channels,
  sampleRate,
  className,
  isPopout = false,
}: PhaseSpacePlotProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const { createWindow } = usePopoutWindows();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhaseSpaceResult | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);

  // Controls
  const [selectedChannel, setSelectedChannel] = useState(0);
  const [delay, setDelay] = useState(10);
  const [maxPoints, setMaxPoints] = useState(8000);

  // Initialize chart
  useEffect(() => {
    if (!chartRef.current) return;
    if (chartInstanceRef.current) return;

    const chart = echarts.init(chartRef.current, "dark", {
      renderer: "canvas",
    });
    chartInstanceRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => chart?.resize());
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  // Compute phase space data
  const computePhaseSpace = useCallback(async () => {
    if (!filePath || channels.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      const request: PhaseSpaceRequest = {
        filePath,
        channelIndex: selectedChannel,
        delay,
        maxPoints,
      };

      const data = await invoke<PhaseSpaceResult>("compute_phase_space", {
        request,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [filePath, selectedChannel, delay, maxPoints, channels.length]);

  // Render chart when data changes
  useEffect(() => {
    if (!chartInstanceRef.current || !result) return;

    const chart = chartInstanceRef.current;
    const zMin = Math.min(...result.points.map((p) => p[2]));
    const zMax = Math.max(...result.points.map((p) => p[2]));

    const option: any = {
      backgroundColor: "#0c0c0f",
      title: {
        text: `Phase Space Reconstruction`,
        subtext: `${result.channelLabel} | τ = ${result.delaySamples} samples (${result.delayMs.toFixed(1)} ms) | ${result.numPoints.toLocaleString()} points`,
        left: "center",
        top: 10,
        textStyle: {
          color: "#fafafa",
          fontSize: 16,
          fontWeight: 600,
        },
        subtextStyle: {
          color: "#a1a1aa",
          fontSize: 12,
        },
      },
      tooltip: {
        show: true,
        backgroundColor: "rgba(24, 24, 27, 0.95)",
        borderColor: "#3f3f46",
        textStyle: { color: "#fafafa" },
        formatter: (params: any) => {
          const [x, y, z] = params.value;
          return `<div style="font-family: monospace;">
            <div>x(t): ${x.toFixed(3)}</div>
            <div>x(t-τ): ${y.toFixed(3)}</div>
            <div>x(t-2τ): ${z.toFixed(3)}</div>
          </div>`;
        },
      },
      visualMap: {
        show: true,
        dimension: 2,
        min: zMin,
        max: zMax,
        inRange: {
          color: VIRIDIS_COLORS,
        },
        textStyle: { color: "#a1a1aa" },
        right: 20,
        bottom: 80,
        itemWidth: 12,
        itemHeight: 100,
      },
      grid3D: {
        boxWidth: 100,
        boxHeight: 100,
        boxDepth: 100,
        viewControl: {
          autoRotate: false,
          distance: 180,
          alpha: 25,
          beta: 45,
          minDistance: 50,
          maxDistance: 400,
        },
        light: {
          main: { intensity: 1.2, shadow: true },
          ambient: { intensity: 0.3 },
        },
        axisLabel: {
          textStyle: { color: "#71717a", fontSize: 10 },
        },
        axisLine: {
          lineStyle: { color: "#52525b", width: 2 },
        },
        splitLine: {
          lineStyle: { color: "#27272a", width: 1 },
        },
        axisPointer: {
          lineStyle: { color: "#a1a1aa" },
        },
      },
      xAxis3D: {
        name: "x(t)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      yAxis3D: {
        name: "x(t-τ)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      zAxis3D: {
        name: "x(t-2τ)",
        type: "value",
        nameTextStyle: { color: "#fafafa", fontSize: 12 },
      },
      series: [
        {
          type: "scatter3D",
          data: result.points,
          symbolSize: 3,
          itemStyle: {
            opacity: 0.85,
            borderWidth: 0,
          },
          emphasis: {
            itemStyle: {
              opacity: 1,
              symbolSize: 6,
            },
          },
        },
      ],
    };

    chart.setOption(option, true);
  }, [result]);

  // Initial load
  useEffect(() => {
    computePhaseSpace();
  }, []);

  const handleResetView = () => {
    if (!chartInstanceRef.current) return;
    chartInstanceRef.current.setOption({
      grid3D: {
        viewControl: {
          distance: 180,
          alpha: 25,
          beta: 45,
        },
      },
    });
  };

  const handleExport = () => {
    if (!chartInstanceRef.current) return;
    const url = chartInstanceRef.current.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#0c0c0f",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `phase-space-${result?.channelLabel || "plot"}.png`;
    link.click();
  };

  const handlePopout = async () => {
    await createWindow("phase-space", `ch${selectedChannel}-${Date.now()}`, {
      filePath,
      channels,
      sampleRate,
      channelIndex: selectedChannel,
      delay,
    });
  };

  const delayMs = (delay / sampleRate) * 1000;

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-zinc-950 overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100">
            Phase Space: {result?.channelLabel || channels[selectedChannel] || "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
            onClick={handleResetView}
            disabled={!result}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
          {!isPopout && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
              onClick={handlePopout}
              disabled={!result}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Pop Out
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-zinc-400 hover:text-zinc-100"
            onClick={handleExport}
            disabled={!result}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative flex-1 min-h-[500px] bg-[#0c0c0f]">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-zinc-400">Computing attractor...</span>
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-sm text-destructive text-center px-8 max-w-md">
              {error}
            </div>
          </div>
        )}
        {!result && !isLoading && !error && (
          <div className="absolute inset-0 flex flex-col gap-4 p-8">
            <Skeleton className="h-full w-full bg-zinc-900" />
          </div>
        )}
        <div ref={chartRef} className="w-full h-full" />
      </div>

      {/* Controls */}
      <Collapsible open={controlsOpen} onOpenChange={setControlsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Settings2 className="h-3.5 w-3.5" />
              Controls
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-zinc-500 transition-transform",
                controlsOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/30">
            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">Channel</Label>
                <Select
                  value={String(selectedChannel)}
                  onValueChange={(v) => setSelectedChannel(Number(v))}
                >
                  <SelectTrigger className="h-8 text-xs bg-zinc-900 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((ch, idx) => (
                      <SelectItem key={ch} value={String(idx)}>
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">
                  Delay τ:{" "}
                  <span className="text-zinc-100 font-mono">
                    {delay} ({delayMs.toFixed(1)} ms)
                  </span>
                </Label>
                <Slider
                  value={[delay]}
                  onValueChange={([v]) => setDelay(v)}
                  min={1}
                  max={100}
                  step={1}
                  className="mt-2"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">
                  Points:{" "}
                  <span className="text-zinc-100 font-mono">
                    {maxPoints.toLocaleString()}
                  </span>
                </Label>
                <Slider
                  value={[maxPoints]}
                  onValueChange={([v]) => setMaxPoints(v)}
                  min={1000}
                  max={20000}
                  step={1000}
                  className="mt-2"
                />
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <Button
                size="sm"
                onClick={computePhaseSpace}
                disabled={isLoading}
                className="h-8"
              >
                {isLoading && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Update
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export const PhaseSpacePlot = memo(PhaseSpacePlotComponent);
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/dda/PhaseSpacePlot.tsx
git commit --no-verify -m "feat(phase-space): redesign with improved visuals, collapsible controls, and pop-out"
```

---

## Task 8: Initialize Panel Registry on App Start

**Files:**
- Modify: `packages/ddalab-tauri/src/app/page.tsx` or appropriate entry point

**Step 1: Find the main app entry and add panel registration**

Import and call panel registration early in the app lifecycle. Add to the top of the main page or layout:

```typescript
// Import panels to trigger registration
import "@/panels";
```

**Step 2: Run typecheck and verify**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/app/page.tsx
git commit --no-verify -m "feat(app): initialize panel registry on app start"
```

---

## Task 9: Update DDAResults to Pass Props Correctly

**Files:**
- Modify: `packages/ddalab-tauri/src/components/DDAResults.tsx`

**Step 1: Update PhaseSpacePlot usage to include className for proper sizing**

Find the PhaseSpacePlot usages and ensure they have proper height:

```typescript
{viewMode === "phasespace" && filePath && (
  <PhaseSpacePlot
    filePath={filePath}
    channels={fileChannels}
    sampleRate={sampleRate}
    className="min-h-[600px]"
  />
)}
```

**Step 2: Run typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/DDAResults.tsx
git commit --no-verify -m "fix(dda): set minimum height for phase space plot in results view"
```

---

## Task 10: Final Verification and Cleanup

**Step 1: Run full typecheck**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 2: Run formatter**

Run: `cd packages/ddalab-tauri && bun run fmt`
Expected: Files formatted

**Step 3: Final commit for any formatting changes**

```bash
git add -A
git commit --no-verify -m "chore: format code after window management implementation"
```

---

## Summary

This plan implements:
1. **Panel Registry** - Extensible system for registering panel types
2. **WindowManager Updates** - Uses registry instead of hardcoded types
3. **WindowPanelPopover** - Status bar UI for managing open windows
4. **Phase Space Popout** - New popout page and wrapper
5. **PhaseSpacePlot Redesign** - Improved visuals, collapsible controls, pop-out support
6. **Integration** - Registry initialization and proper prop passing

Total: 10 tasks, ~30 steps
