import { useState, useEffect } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";
import { Bar } from "react-chartjs-2";
import { useSession } from "next-auth/react";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useToast } from "../ui/use-toast";
import { Button } from "../ui/button";
import { ArtifactIdentifier } from "../ui/ArtifactIdentifier";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ArtifactInfo {
  artifact_id: string;
  name: string;
  file_path: string;
  created_at: string;
  user_id: number;
  shared_by_user_id?: number;
}

interface Plot {
  id: string;
  artifactId: string;
  title: string;
  data: { labels: string[]; datasets: { label: string; data: number[] }[] };
  artifactInfo?: ArtifactInfo;
}

interface Layout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PlotGrid = () => {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);

  // Fetch plots (artifact visualizations)
  const { data: plotData, error } = useApiQuery<Plot[]>({
    url: "/api/plots",
    method: "GET",
    token: session?.accessToken,
    responseType: "json",
    enabled: !!session?.accessToken,
  });

  // Save layout changes
  const saveLayout = async (newLayouts: Layout[]) => {
    if (!session?.accessToken) return;
    try {
      await fetch("/api/layouts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ layouts: newLayouts }),
      });
      setLayouts(newLayouts);
      toast({ title: "Success", description: "Layout saved" });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to save layout",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (plotData) {
      setPlots(plotData);
      // Initialize layouts if not set
      setLayouts(
        plotData.map((plot, index) => ({
          i: plot.id,
          x: (index % 4) * 3,
          y: Math.floor(index / 4) * 4,
          w: 3,
          h: 4,
        }))
      );
    }
  }, [plotData]);

  if (error) {
    toast({
      title: "Error",
      description: "Failed to load plots",
      variant: "destructive",
    });
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl mb-4">Arrange Plots</h2>
      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: layouts }}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 10, sm: 6 }}
        rowHeight={100}
        onLayoutChange={(newLayouts: Layout[]) => saveLayout(newLayouts)}
        isResizable={true}
        draggableHandle=".drag-handle"
      >
        {plots.map((plot) => (
          <div key={plot.id} className="bg-white dark:bg-gray-800 border rounded p-2 space-y-2">
            {/* Artifact Identification */}
            {plot.artifactInfo && (
              <ArtifactIdentifier
                artifact={plot.artifactInfo}
                variant="compact"
                className="bg-gray-50 dark:bg-gray-700 rounded p-2"
              />
            )}

            <div className="drag-handle bg-gray-200 dark:bg-gray-600 p-2 cursor-move rounded">
              {plot.title}
            </div>
            <Bar
              data={plot.data}
              options={{ responsive: true, maintainAspectRatio: false }}
            />
          </div>
        ))}
      </ResponsiveGridLayout>
      <Button
        className="mt-4"
        onClick={() => saveLayout(layouts)}
        disabled={!session?.accessToken}
      >
        Save Layout
      </Button>
    </div>
  );
};
