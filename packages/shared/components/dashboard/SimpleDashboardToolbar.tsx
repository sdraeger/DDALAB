"use client";

import React from "react";
import { Button } from "../ui/button";
import { Plus, FileText, BarChart3, Settings, Activity, TrendingUp } from "lucide-react";
import { SimpleWidget } from "./SimpleDashboardGrid";
import { FileBrowserWidget } from "./widgets/FileBrowserWidget";
import { DDAWidget } from "./widgets/DDAWidget";
import { ChartWidget } from "./widgets/ChartWidget";
import { DDAHeatmapWidget } from "./widgets/DDAHeatmapWidget";
import { DDALinePlotWidget } from "./widgets/DDALinePlotWidget";
import { useAppDispatch } from "../../store";
import { initializePlot, loadChunk, ensurePlotState } from "../../store/slices/plotSlice";
import { useToast } from "../ui/use-toast";
import { useLoadingManager } from "../../hooks/useLoadingManager";
import { useUnifiedSessionData } from "../../hooks/useUnifiedSession";

interface SimpleDashboardToolbarProps {
	onAddWidget: (widget: SimpleWidget) => void;
	className?: string;
}

export function SimpleDashboardToolbar({ onAddWidget, className }: SimpleDashboardToolbarProps) {
	const { data: session } = useUnifiedSessionData();
	const dispatch = useAppDispatch();
	const { toast } = useToast();
	const loadingManager = useLoadingManager();

	const handleFileSelect = async (filePath: string) => {
		const token = session?.accessToken;
		console.log("[handleFileSelect] in handleFileSelect");
		console.log("[handleFileSelect] token", token);

		if (!token) {
			toast({
				title: "Authentication Error",
				description: "Please log in to load files.",
				variant: "destructive",
			});
			return;
		}

		const loadingId = `file-select-${filePath}`;

		try {
			// Start unified loading for the entire file selection process
			loadingManager.startFileLoad(
				loadingId,
				`Loading ${filePath.split('/').pop()}...`,
				true // Show global overlay for file loading
			);

			// Ensure plot state exists for this file
			dispatch(ensurePlotState(filePath));

			// Initialize plot metadata
			const initResult = await dispatch(initializePlot({ filePath, token }));

			if (initResult.meta.requestStatus === 'fulfilled') {
				// Update progress
				loadingManager.updateProgress(loadingId, 50, "Loading file data...");

				// Load the first chunk
				const loadResult = await dispatch(loadChunk({
					filePath,
					chunkNumber: 1,
					chunkSizeSeconds: 10,
					token,
				}));

				if (loadResult.meta.requestStatus === 'fulfilled') {
					// Complete loading with success
					loadingManager.updateProgress(loadingId, 100, "File loaded successfully!");

					// Small delay to show completion before hiding
					setTimeout(() => {
						loadingManager.stop(loadingId);
						toast({
							title: "File Loaded",
							description: `Successfully loaded data from ${filePath.split('/').pop()}`,
						});
					}, 500);
				} else {
					loadingManager.stop(loadingId);
					toast({
						title: "Data Load Error",
						description: "Failed to load file data chunk.",
						variant: "destructive",
					});
				}
			} else {
				loadingManager.stop(loadingId);
				toast({
					title: "Metadata Error",
					description: "Failed to load file metadata.",
					variant: "destructive",
				});
			}
		} catch (error) {
			console.error('Error loading file:', error);
			loadingManager.stop(loadingId);
			toast({
				title: "File Load Error",
				description: `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				variant: "destructive",
			});
		}
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
						onFileSelect={handleFileSelect}
						maxHeight="100%"
					/>
				);
				break;

			case 'dda-form':
				title = 'DDA Analysis Form';
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
		</div>
	);
}
