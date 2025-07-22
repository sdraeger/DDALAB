import React from "react";
import { FileBrowserWidget } from "../../components/dashboard/widgets/FileBrowserWidget";
import { DDAWidget } from "../../components/dashboard/widgets/DDAWidget";
import { ChartWidget } from "../../components/dashboard/widgets/ChartWidget";
import { DDAHeatmapWidget } from "../../components/dashboard/widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "../../components/dashboard/widgets/DDALinePlotWidget";
import { Settings } from "lucide-react";

// Accept onFileSelect as an optional prop
export function createWidgetContent(type?: string, onFileSelect?: (filePath: string) => void): React.ReactNode {
	switch (type) {
		case 'file-browser':
			return (
				<FileBrowserWidget
					onFileSelect={onFileSelect}
					maxHeight="100%"
				/>
			);

		case 'dda-form':
			return <DDAWidget />;

		case 'chart':
			return <ChartWidget />;

		case 'dda-heatmap':
			return <DDAHeatmapWidget />;

		case 'dda-line-plot':
			return <DDALinePlotWidget />;

		case 'custom':
		default:
			return (
				<div className="flex items-center justify-center h-full">
					<div className="text-center text-muted-foreground">
						<Settings className="h-8 w-8 mx-auto mb-2" />
						<p>Custom widget content</p>
					</div>
				</div>
			);
	}
}
