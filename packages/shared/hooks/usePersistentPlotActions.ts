import { useCallback } from "react";
import { usePersistentPlots } from "../contexts/PersistentPlotsContext";
import { useToast } from "../components/ui/use-toast";

export function usePersistentPlotActions() {
  const { addPlot, openPlots, removePlot } = usePersistentPlots();
  const { toast } = useToast();

  const openEEGPlot = useCallback((filePath: string, fileName?: string) => {
    // Extract filename from path if not provided
    const displayName = fileName || filePath.split('/').pop() || filePath;
    
    // Check if plot already exists
    const existingPlot = openPlots.find(plot => plot.filePath === filePath);
    if (existingPlot) {
      toast({
        title: "Plot Already Open",
        description: `${displayName} is already open. Bringing it to front.`,
      });
      return existingPlot.id;
    }

    const plotId = addPlot({
      filePath,
      fileName: displayName,
      plotType: "eeg",
      isMinimized: false,
      position: { 
        x: Math.max(0, (window.innerWidth - 1000) / 2), 
        y: Math.max(0, (window.innerHeight - 700) / 2) 
      },
      size: { width: 1000, height: 700 },
    });

    toast({
      title: "Plot Opened",
      description: `${displayName} is now open and will persist across navigation.`,
    });

    return plotId;
  }, [addPlot, openPlots, toast]);

  const openDDAPlot = useCallback((filePath: string, fileName?: string) => {
    const displayName = fileName || filePath.split('/').pop() || filePath;
    
    const existingPlot = openPlots.find(plot => plot.filePath === filePath && plot.plotType === "dda");
    if (existingPlot) {
      toast({
        title: "Plot Already Open",
        description: `DDA plot for ${displayName} is already open.`,
      });
      return existingPlot.id;
    }

    const plotId = addPlot({
      filePath,
      fileName: `DDA - ${displayName}`,
      plotType: "dda",
      isMinimized: false,
      position: { 
        x: Math.max(0, (window.innerWidth - 800) / 2), 
        y: Math.max(0, (window.innerHeight - 600) / 2) 
      },
      size: { width: 800, height: 600 },
    });

    toast({
      title: "DDA Plot Opened",
      description: `DDA plot for ${displayName} is now open.`,
    });

    return plotId;
  }, [addPlot, openPlots, toast]);

  const closePlot = useCallback((plotId: string) => {
    const plot = openPlots.find(p => p.id === plotId);
    if (plot) {
      removePlot(plotId);
      toast({
        title: "Plot Closed",
        description: `${plot.fileName} has been closed.`,
      });
    }
  }, [removePlot, openPlots, toast]);

  const closeAllPlots = useCallback(() => {
    const count = openPlots.length;
    openPlots.forEach(plot => removePlot(plot.id));
    if (count > 0) {
      toast({
        title: "All Plots Closed",
        description: `Closed ${count} plot${count > 1 ? 's' : ''}.`,
      });
    }
  }, [openPlots, removePlot, toast]);

  const getOpenPlotForFile = useCallback((filePath: string, plotType?: "eeg" | "dda") => {
    return openPlots.find(plot => 
      plot.filePath === filePath && 
      (plotType ? plot.plotType === plotType : true)
    );
  }, [openPlots]);

  return {
    openEEGPlot,
    openDDAPlot,
    closePlot,
    closeAllPlots,
    getOpenPlotForFile,
    openPlots,
  };
} 