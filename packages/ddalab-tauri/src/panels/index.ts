import { registerPanel } from "@/utils/panelRegistry";
import { Activity, BarChart3, Brain, Box, FileText } from "lucide-react";

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

  registerPanel({
    id: "file-viewer",
    title: "File Viewer",
    icon: FileText,
    category: "data",
    defaultSize: { width: 1200, height: 800 },
    minSize: { width: 800, height: 600 },
    popoutUrl: "/popout/file-viewer",
    allowMultiple: true,
    dockable: true,
  });
}

// Auto-register on import
registerBuiltInPanels();
