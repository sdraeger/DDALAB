"use client";

import React, { useEffect } from 'react';
import { useUnifiedSession } from 'shared/hooks/useUnifiedSession';
import { ModernDashboardGrid } from 'shared/components/dashboard/ModernDashboardGrid';
import { ModernDashboardToolbar } from 'shared/components/dashboard/ModernDashboardToolbar';
import { useModernDashboard } from 'shared/hooks/useModernDashboard';
import { Button } from 'shared/components/ui/button';
import { Save, RefreshCw, Trash2, Sparkles } from 'lucide-react';
import { useToast } from 'shared/components/ui/use-toast';
import { useAppDispatch } from 'shared/store';
import { initializePlot, loadChunk, ensurePlotState } from 'shared/store/slices/plotSlice';
import { useLoadingManager } from 'shared/hooks/useLoadingManager';
import { useDashboardRestoration } from 'shared/hooks/useDashboardRestoration';
import { usePlotCaching } from 'shared/hooks/usePlotCaching';

export default function Dashboard() {
	const { user, status } = useUnifiedSession();
	const { toast } = useToast();
	const dispatch = useAppDispatch();
	const loadingManager = useLoadingManager();

	// Add dashboard restoration hook
	useDashboardRestoration();

	// Add plot caching hook to automatically cache plots when they are generated
	usePlotCaching({ enabled: true, ttl: 3600 }); // Cache for 1 hour

	const handleFileSelect = async (filePath: string) => {
		// In local mode, we'll use a placeholder token since the API will handle it
		const token = user?.isLocalMode ? "local-mode-token" : (user as any)?.accessToken;

		// Add debugging
		console.log("[handleFileSelect] Starting file selection:", {
			filePath,
			hasToken: !!token,
			isLocalMode: user?.isLocalMode,
			user: user
		});

		if (!token) {
			toast({
				title: "Authentication Error",
				description: "Please log in to load files",
				variant: "destructive",
			});
			return;
		}

		const loadingId = `file-select-${filePath}`;
		const fileName = filePath.split('/').pop() || 'file';

		try {
			// Start loading with global overlay for file selection
			loadingManager.startFileLoad(
				loadingId,
				`Loading ${fileName}...`,
				true // Show global overlay
			);

			// Set a timeout to prevent indefinite loading
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => {
					reject(new Error(`File load timeout: ${fileName} took too long to load`));
				}, 45000); // 45 second timeout
			});

			// Ensure plot state exists for this file
			console.log("[handleFileSelect] Dispatching ensurePlotState");
			dispatch(ensurePlotState(filePath));

			// Update loading message for metadata phase
			loadingManager.updateProgress(loadingId, 25, `Loading metadata for ${fileName}...`);

			// Initialize plot metadata with timeout protection
			console.log("[handleFileSelect] Dispatching initializePlot");
			const initPromise = dispatch(initializePlot({ filePath, token }));
			const initResult = await Promise.race([initPromise, timeoutPromise]) as any;

			console.log("[handleFileSelect] initializePlot result:", {
				status: initResult.meta.requestStatus,
				payload: initResult.payload,
				error: initResult.error
			});

			if (initResult.meta.requestStatus === 'fulfilled') {
				// Update loading message for data phase
				loadingManager.updateProgress(loadingId, 60, `Loading data for ${fileName}...`);

				// Load the first chunk with timeout protection
				console.log("[handleFileSelect] Dispatching loadChunk");
				const loadPromise = dispatch(loadChunk({
					filePath,
					chunkNumber: 1,
					chunkSizeSeconds: 10,
					token,
				}));
				const loadResult = await Promise.race([loadPromise, timeoutPromise]) as any;

				console.log("[handleFileSelect] loadChunk result:", {
					status: loadResult.meta.requestStatus,
					payload: loadResult.payload,
					error: loadResult.error
				});

				if (loadResult.meta.requestStatus === 'fulfilled') {
					// Complete loading
					loadingManager.updateProgress(loadingId, 100, `Successfully loaded ${fileName}`);

					// Stop loading after a brief success display
					setTimeout(() => {
						loadingManager.stop(loadingId);
					}, 800);

					toast({
						title: "File Loaded",
						description: `Successfully loaded data from ${fileName}`,
						duration: 3000,
					});
				} else {
					console.error("[handleFileSelect] loadChunk failed:", loadResult.error);
					throw new Error(`Failed to load data for ${fileName}: ${loadResult.error?.message || 'Unknown error'}`);
				}
			} else {
				console.error("[handleFileSelect] initializePlot failed:", initResult.error);
				throw new Error(`Failed to initialize ${fileName}: ${initResult.error?.message || 'Unknown error'}`);
			}
		} catch (error) {
			console.error("[handleFileSelect] Error loading file:", error);

			// Always stop loading on error
			loadingManager.stop(loadingId);

			// Provide user-friendly error message
			const errorMessage = error instanceof Error ? error.message : `Failed to load ${fileName}`;

			toast({
				title: "Load Error",
				description: errorMessage,
				variant: "destructive",
				duration: 5000,
			});
		}
	};

	// Initialize modern dashboard with default configuration
	const {
		widgets,
		layout,
		config,
		isLoading,
		isSaving,
		saveStatus,
		isLayoutInitialized,
		addWidget,
		removeWidget,
		updateWidget,
		updateLayout,
		saveLayout,
		loadLayout,
		clearLayout,
		onBreakpointChange,
	} = useModernDashboard({
		config: {
			// Custom configuration can be provided here
			autoSaveDelay: 1500, // Faster auto-save for better UX
			margin: [12, 12], // Slightly larger margins
			containerPadding: [16, 16], // More padding
		},
		widgetCallbacks: {
			onFileSelect: handleFileSelect,
		},
	});

	// Handle messages from popped-out widgets
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;

			if (event.data.type === 'SWAP_IN_MODERN_WIDGET') {
				const { widgetId } = event.data;
				if (widgetId) {
					updateWidget(widgetId, { metadata: { isPoppedOut: false } });

					toast({
						title: "Widget Returned",
						description: `The widget has been returned to your dashboard.`,
						duration: 3000,
					});
				}
			}
		};

		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [updateWidget, toast]);

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
				title: 'Layout Reloaded',
				description: 'Your saved layout has been reloaded.',
				duration: 2000,
			});
		} catch (error) {
			// Error handling is done in the hook
		}
	};

	const handleClearLayout = async () => {
		try {
			await clearLayout();
		} catch (error) {
			// Error handling is done in the hook
		}
	};

	const handleAddWidget = (type: string, widgetConfig?: any) => {
		// Find a good position for the new widget
		const position = {
			x: (widgets.length * 2) % config.cols.lg,
			y: 0, // Let react-grid-layout auto-place vertically
		};

		addWidget(type, widgetConfig, position);
	};

	return (
		<div className="flex h-full w-full flex-col bg-gradient-to-br from-background to-muted/20">
			{/* Header */}
			<div className="relative z-10 flex h-[72px] flex-shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 sm:px-6 backdrop-blur-sm">
				<ModernDashboardToolbar onAddWidget={handleAddWidget} />

				{/* Layout controls */}
				{user && (
					<div className="flex flex-shrink-0 items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={handleManualSave}
							disabled={isSaving || !user}
							className="gap-2"
						>
							<Save className="h-4 w-4" />
							{isSaving ? "Saving..." : "Save Layout"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleManualLoad}
							disabled={isLoading}
							className="gap-2"
						>
							<RefreshCw className="h-4 w-4" />
							Reload
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleClearLayout}
							className="gap-2 text-destructive hover:text-destructive"
						>
							<Trash2 className="h-4 w-4" />
							Clear
						</Button>
					</div>
				)}
			</div>

			{/* Main Content */}
			<div className="relative flex-1 w-full min-w-0">
				{/* Layout Loading State */}
				{!isLayoutInitialized && user && (
					<div className="absolute inset-0 flex items-center justify-center p-6 bg-background/80 backdrop-blur-sm z-50">
						<div className="mx-auto max-w-md text-center">
							<RefreshCw className="mx-auto mb-4 h-8 w-8 text-primary animate-spin" />
							<h2 className="mb-2 text-lg font-semibold">Loading Your Dashboard</h2>
							<p className="text-sm text-muted-foreground">
								Restoring your saved layout and widgets...
							</p>
						</div>
					</div>
				)}

				{/* Empty State */}
				{widgets.length === 0 && !isLoading && isLayoutInitialized && (
					<div className="absolute inset-0 flex items-center justify-center p-6">
						<div className="mx-auto max-w-md text-center">
							<Sparkles className="mx-auto mb-4 h-12 w-12 text-primary opacity-50" />
							<h2 className="mb-2 text-xl font-semibold">Welcome to Your Dashboard</h2>
							<p className="mb-6 leading-relaxed text-muted-foreground">
								Start by adding a widget to organize your workspace. You can drag, resize, and
								customize widgets to fit your needs.
							</p>
							<Button onClick={() => handleAddWidget("file-browser")} className="gap-2">
								<Sparkles className="h-4 w-4" />
								Add a Widget
							</Button>
						</div>
					</div>
				)}

				{/* Dashboard Grid */}
				<ModernDashboardGrid
					widgets={widgets}
					layout={layout}
					config={config}
					onLayoutChange={updateLayout}
					onWidgetRemove={removeWidget}
					onWidgetUpdate={updateWidget}
					onBreakpointChange={onBreakpointChange}
					className="w-full h-full"
				/>
			</div>
		</div>
	);
}
