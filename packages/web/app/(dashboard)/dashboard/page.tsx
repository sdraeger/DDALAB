"use client";

import React from "react";
import { SimpleDashboardGrid, SimpleWidget } from "shared/components/dashboard/SimpleDashboardGrid";
import { SimpleDashboardToolbar } from "shared/components/dashboard/SimpleDashboardToolbar";
import { usePersistentDashboard } from "shared/hooks/usePersistentDashboard";
import { Button } from "shared/components/ui/button";
import { Save, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "shared/components/ui/use-toast";
import { useUnifiedSessionData } from "shared/hooks";
import { useEDFPlot } from "shared/contexts/EDFPlotContext";
import { ChannelSelectionDialog } from "shared/components/dialog/ChannelSelectionDialog";
import { FileBrowserWidget } from "shared/components/dashboard/widgets/FileBrowserWidget";
import { useAppDispatch } from "shared/store";
import { ensurePlotState, initializePlot, loadChunk, setSelectedChannels } from "shared/store/slices/plotSlice";

export default function Dashboard() {
	const { data: session } = useUnifiedSessionData();
	const { toast } = useToast();
	const { setSelectedFilePath } = useEDFPlot();
	const dispatch = useAppDispatch();
	const [channelDialogOpen, setChannelDialogOpen] = React.useState(false);
	const [pendingFilePath, setPendingFilePath] = React.useState<string | null>(null);

	const handleFileSelect = (filePath: string) => {
		console.log('[Dashboard] handleFileSelect called with:', filePath);
		setPendingFilePath(filePath);
		setChannelDialogOpen(true);
		// Do NOT setSelectedFilePath here
	};

	const handleDialogConfirm = async (filePath: string, selectedChannels: string[]) => {
		setSelectedFilePath(filePath); // Only set after confirmation
		const token = session?.accessToken;
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
			dispatch(ensurePlotState(filePath));
			const initResult = await dispatch(initializePlot({ filePath, token }));
			if (initResult.meta.requestStatus === 'fulfilled') {
				await dispatch(loadChunk({ filePath, chunkNumber: 1, chunkSizeSeconds: 10, token }));
				// Set selected channels in Redux after loading chunk
				console.log('[Dashboard] Dispatching setSelectedChannels:', { filePath, channels: selectedChannels });
				dispatch(setSelectedChannels({ filePath, channels: selectedChannels }));
			}
		} catch (error) {
			console.error('Error loading file:', error);
			toast({
				title: "File Load Error",
				description: `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				variant: "destructive",
			});
		}
	};

	// Initialize with some default widgets
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
				<div className="space-y-4">
					<div className="text-sm text-muted-foreground">Browse and select files</div>
					<div className="space-y-2">
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Janet</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Julia</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Kotlin</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Lambda Calculus</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 LaTeX</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Lisp</span>
						</div>
					</div>
				</div>
			)
		},
		{
			id: "dda-form-default",
			title: "DDA Form",
			position: { x: 400, y: 20 },
			size: { width: 400, height: 350 },
			minSize: { width: 300, height: 250 },
			maxSize: { width: 600, height: 500 },
			type: "dda-form",
			content: (
				<div className="space-y-4">
					<div>
						<label className="text-sm font-medium">Selected File</label>
						<input
							type="text"
							placeholder="No file selected"
							className="w-full mt-1 px-3 py-2 border border-border rounded-md text-sm"
							readOnly
						/>
					</div>
					<div>
						<label className="text-sm font-medium">Selected Channels</label>
						<div className="mt-1 p-2 border border-border rounded-md text-sm text-muted-foreground">
							Loading channels...
						</div>
					</div>
					<div className="space-y-2">
						<button className="w-full bg-white text-black border border-gray-300 px-4 py-2 rounded text-sm">
							Loading channels...
						</button>
					</div>
					<div className="flex gap-2">
						<button className="px-3 py-1 text-sm">‹</button>
						<span className="px-3 py-1 text-sm">#</span>
						<span className="px-3 py-1 text-sm">1</span>
						<span className="px-3 py-1 text-sm">/0</span>
						<button className="px-3 py-1 text-sm">›</button>
					</div>
				</div>
			)
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
		isLoading,
		isSaving,
		isLayoutLoaded
	} = usePersistentDashboard(initialWidgets, {
		autoSaveDelay: 2000, // 2 seconds auto-save delay
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
			// Reset to initial widgets (clear current layout)
			initialWidgets.forEach((widget, index) => {
				if (index < widgets.length) {
					updateWidget(widgets[index].id, widget);
				} else {
					addWidget(widget);
				}
			});
			// Remove any extra widgets
			widgets.slice(initialWidgets.length).forEach(widget => {
				removeWidget(widget.id);
			});

			toast({
				title: "Layout Cleared",
				description: "Layout has been reset to default.",
				duration: 2000,
			});
		} catch (error) {
			toast({
				title: "Error",
				description: "Failed to clear layout.",
				variant: "destructive",
				duration: 3000,
			});
		}
	};

	return (
		<div className="h-screen flex flex-col">
			<div className="flex items-center justify-between px-4 py-2 bg-background border-b">
				<SimpleDashboardToolbar onAddWidget={addWidget} className="flex-1" onFileSelect={handleFileSelect} />
				{/* Layout controls - show if user is logged in */}
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

			<div className="flex-1 overflow-hidden relative">
				{/* Loading overlay */}
				{(isLoading || (!isLayoutLoaded && session)) && (
					<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
						<div className="text-center">
							<RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2" />
							<p className="text-sm text-muted-foreground">
								{isLoading ? "Loading your layout..." : "Restoring your saved layout..."}
							</p>
						</div>
					</div>
				)}

				<SimpleDashboardGrid
					widgets={widgets.map(widget => {
						if (widget.type === 'file-browser') {
							return {
								...widget,
								content: <FileBrowserWidget onFileSelect={handleFileSelect} maxHeight="100%" />
							};
						}
						return widget;
					})}
					onWidgetUpdate={updateWidget}
					onWidgetRemove={removeWidget}
					onWidgetPopOut={popOutWidget}
					onWidgetSwapIn={swapInWidget}
					className="h-full"
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

				{/* Channel Selection Dialog */}
				{pendingFilePath && (
					<ChannelSelectionDialog
						open={channelDialogOpen}
						onOpenChange={open => {
							setChannelDialogOpen(open);
							if (!open) setPendingFilePath(null);
						}}
						filePath={pendingFilePath}
						onConfirm={handleDialogConfirm}
					/>
				)}
			</div>
		</div>
	);
}
