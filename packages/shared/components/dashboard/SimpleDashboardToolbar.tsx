"use client";

import React, { useState } from "react";
import { Button } from "../ui/button";
import { Plus, FileText, BarChart3, Settings, Activity, TrendingUp } from "lucide-react";
import { SimpleWidget } from "./SimpleDashboardGrid";
import { FileBrowserWidget } from "./widgets/FileBrowserWidget";
import { DDAWidget } from "./widgets/DDAWidget";
import { ChartWidget } from "./widgets/ChartWidget";
import { DDAHeatmapWidget } from "./widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "./widgets/DDALinePlotWidget";
import { useAppDispatch } from "../../store";
import { useToast } from "../ui/use-toast";
import { useLoadingManager } from "../../hooks/useLoadingManager";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";
import { useEDFPlot } from "../../contexts/EDFPlotContext";
import { ChannelSelectionDialog } from "../dialog/ChannelSelectionDialog";

interface SimpleDashboardToolbarProps {
	onAddWidget: (widget: SimpleWidget) => void;
	className?: string;
	onFileSelect?: (filePath: string) => void;
}

export function SimpleDashboardToolbar({ onAddWidget, className, onFileSelect }: SimpleDashboardToolbarProps) {
	const { data: session } = useUnifiedSessionData();
	const dispatch = useAppDispatch();
	const { toast } = useToast();
	const loadingManager = useLoadingManager();
	const { setSelectedFilePath } = useEDFPlot();
	const [channelDialogOpen, setChannelDialogOpen] = useState(false);
	const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

	const handleFileSelect = async (filePath: string) => {
		console.log('[SimpleDashboardToolbar] handleFileSelect called with:', filePath);
		setPendingFilePath(filePath);
		setChannelDialogOpen(true);
		setSelectedFilePath(filePath);
		console.log('[SimpleDashboardToolbar] channelDialogOpen should be true:', true);
	};

	const createWidget = (type: string) => {
		const id = `widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		let content: React.ReactNode;
		let title: string;
		let size = { width: 300, height: 200 };

		switch (type) {
			case 'file-browser':
				title = 'File Browser';
				size = { width: 350, height: 400 };
				content = (
					<FileBrowserWidget
						onFileSelect={onFileSelect}
						maxHeight="100%"
					/>
				);
				break;

			case 'dda-form':
				title = 'DDA Form';
				size = { width: 350, height: 400 };
				content = <DDAWidget />;
				break;

			case 'chart':
				title = 'Data Visualization';
				size = { width: 400, height: 280 };
				content = <ChartWidget />;
				break;

			case 'dda-heatmap':
				title = 'DDA Heatmap';
				size = { width: 400, height: 300 };
				content = <DDAHeatmapWidget />;
				break;

			case 'dda-line-plot':
				title = 'DDA Line Plot';
				size = { width: 400, height: 300 };
				content = <DDALinePlotWidget />;
				break;

			default:
				title = 'Custom Widget';
				content = (
					<div className="flex items-center justify-center h-full">
						<div className="text-center text-muted-foreground">
							<Settings className="h-8 w-8 mx-auto mb-2" />
							<p>Custom widget content</p>
						</div>
					</div>
				);
		}

		const widget: SimpleWidget = {
			id,
			title,
			content,
			position: { x: 20, y: 20 },
			size,
			minSize: { width: 180, height: 120 },
			maxSize: { width: 800, height: 800 },
			type
		};

		onAddWidget(widget);
	};

	return (
		<div className={`flex items-center gap-2 px-2 py-1 border-b bg-background/95 backdrop-blur ${className}`}>
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('file-browser')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<FileText className="h-3 w-3" />
					File Browser
				</Button>

				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('dda-form')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<Settings className="h-3 w-3" />
					DDA Form
				</Button>

				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('chart')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<BarChart3 className="h-3 w-3" />
					Chart
				</Button>

				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('dda-heatmap')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<Activity className="h-3 w-3" />
					DDA Heatmap
				</Button>

				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('dda-line-plot')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<TrendingUp className="h-3 w-3" />
					DDA Line Plot
				</Button>

				<Button
					variant="outline"
					size="sm"
					onClick={() => createWidget('custom')}
					className="gap-1 h-7 px-2 text-xs"
				>
					<Plus className="h-3 w-3" />
					Custom
				</Button>
			</div>
			{/* Channel Selection Dialog */}
			{pendingFilePath && (
				<ChannelSelectionDialog
					open={channelDialogOpen}
					onOpenChange={open => {
						setChannelDialogOpen(open);
						if (!open) setPendingFilePath(null);
					}}
					filePath={pendingFilePath}
				/>
			)}
		</div>
	);
}
