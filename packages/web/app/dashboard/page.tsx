"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { SimpleDashboardGrid, SimpleWidget } from "shared/components/dashboard/SimpleDashboardGrid";
import { SimpleDashboardToolbar } from "shared/components/dashboard/SimpleDashboardToolbar";
import { usePersistentDashboard } from "shared/hooks/usePersistentDashboard";
import { FileBrowserWidget } from "shared/components/dashboard/widgets/FileBrowserWidget";
import { DDAWidget } from "shared/components/dashboard/widgets/DDAWidget";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
import { useAppDispatch, useAppSelector } from "shared/store";
import { initializePlot, loadChunk, ensurePlotState } from "shared/store/slices/plotSlice";
import { useToast } from "shared/components/ui/use-toast";
import { Button } from "shared/components/ui/button";
import { Save, RefreshCw, Trash2 } from "lucide-react";

export default function Dashboard() {
	const { data: session } = useSession();
	const dispatch = useAppDispatch();
	const { toast } = useToast();

	// Access plot state to handle file selection
	const {
		isLoading: plotIsLoading,
		error: plotError,
		latestFilePath,
		metadata
	} = useAppSelector((state) => state.plots);

	const handleFileSelect = async (filePath: string) => {
		const token = session?.accessToken;

		if (!token) {
			toast({
				title: "Authentication Error",
				description: "Please log in to load files.",
				variant: "destructive",
			});
			return;
		}

		try {
			// Ensure plot state exists for this file
			dispatch(ensurePlotState(filePath));

			// Initialize plot metadata
			const initResult = await dispatch(initializePlot({ filePath, token }));

			if (initResult.meta.requestStatus === 'fulfilled') {
				// Load the first chunk
				const loadResult = await dispatch(loadChunk({
					filePath,
					chunkNumber: 1,
					chunkSizeSeconds: 10,
					token,
				}));

				if (loadResult.meta.requestStatus === 'fulfilled') {
					toast({
						title: "File Loaded",
						description: `Successfully loaded data from ${filePath.split('/').pop()}`,
						duration: 3000,
					});
				} else {
					toast({
						title: "Data Load Error",
						description: "Failed to load file data chunk.",
						variant: "destructive",
						duration: 4000,
					});
				}
			} else {
				toast({
					title: "Metadata Error",
					description: "Failed to load file metadata.",
					variant: "destructive",
					duration: 4000,
				});
			}
		} catch (error) {
			console.error("Error loading file:", error);
			toast({
				title: "Load Error",
				description: "Failed to load the selected file",
				variant: "destructive",
				duration: 4000,
			});
		}
	};

	// Initialize with some default widgets that match the original layout
	const initialWidgets: SimpleWidget[] = [
		{
			id: "file-browser-default",
			title: "File Browser",
			position: { x: 20, y: 20 },
			size: { width: 350, height: 400 },
			minSize: { width: 250, height: 300 },
			maxSize: { width: 500, height: 600 },
			type: "file-browser",
			content: (
				<FileBrowserWidget
					onFileSelect={handleFileSelect}
					maxHeight="100%"
				/>
			)
		},
		{
			id: "dda-form-default",
			title: "DDA Analysis Form",
			position: { x: 390, y: 20 },
			size: { width: 350, height: 400 },
			minSize: { width: 300, height: 350 },
			maxSize: { width: 500, height: 600 },
			type: "dda-form",
			content: <DDAWidget />
		}
	];

	const {
		widgets,
		updateWidget,
		addWidget,
		removeWidget,
		popOutWidget,
		swapInWidget,
		saveLayout,
		loadLayout,
		clearSavedLayout,
		isLoading,
		isSaving,
		isLayoutLoaded
	} = usePersistentDashboard(initialWidgets, {
		autoSaveDelay: 3000, // 3 seconds auto-save delay
		enableAutoSave: true,
		enableCache: true,
	});

	const handleManualSave = async () => {
		try {
			await saveLayout();
		} catch (error) {
			// Error handling is done in the hook
		}
	};

	const handleManualLoad = async () => {
		try {
			await loadLayout();
			toast({
				title: "Layout Reloaded",
				description: "Your saved layout has been reloaded.",
				duration: 2000,
			});
		} catch (error) {
			// Error handling is done in the hook
		}
	};

	const handleClearLayout = async () => {
		try {
			await clearSavedLayout();
		} catch (error) {
			// Error handling is done in the hook
		}
	};

	return (
		<ProtectedRoute>
			{/* Ensure full height expansion with proper flex layout */}
			<div className="h-full w-full flex flex-col">
				<div className="flex items-center justify-between px-4 py-2 bg-background border-b">
					<SimpleDashboardToolbar onAddWidget={addWidget} className="flex-1" />
					{/* Layout controls */}
					{session && isLayoutLoaded && (
						<div className="flex items-center gap-2 ml-4">
							<Button
								variant="outline"
								size="sm"
								onClick={handleManualSave}
								disabled={isSaving || !session}
								className="gap-1"
							>
								<Save className="h-3 w-3" />
								{isSaving ? "Saving..." : "Save Layout"}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleManualLoad}
								disabled={isLoading}
								className="gap-1"
							>
								<RefreshCw className="h-3 w-3" />
								Reload
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={handleClearLayout}
								className="gap-1 text-destructive hover:text-destructive"
							>
								<Trash2 className="h-3 w-3" />
								Clear
							</Button>
						</div>
					)}
				</div>

				<div className="flex-1 w-full relative">
					{/* Loading overlay */}
					{isLoading && (
						<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
							<div className="text-center">
								<RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
								<p className="text-sm text-muted-foreground">Loading your layout...</p>
							</div>
						</div>
					)}

					<SimpleDashboardGrid
						widgets={widgets}
						onWidgetUpdate={updateWidget}
						onWidgetRemove={removeWidget}
						onWidgetPopOut={popOutWidget}
						onWidgetSwapIn={swapInWidget}
						className="w-full h-full"
						gridSize={10}
						enableSnapping={false}
						enableCollisionDetection={false}
					/>

					{/* Auto-save indicator */}
					{isSaving && (
						<div className="absolute bottom-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm flex items-center gap-2">
							<RefreshCw className="h-3 w-3 animate-spin" />
							Auto-saving...
						</div>
					)}
				</div>
			</div>
		</ProtectedRoute>
	);
}
