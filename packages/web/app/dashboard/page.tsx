"use client";

import React, { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { ProtectedRoute } from 'shared/components/higher-order/ProtectedRoute';
import { ModernDashboardGrid } from 'shared/components/dashboard/ModernDashboardGrid';
import { ModernDashboardToolbar } from 'shared/components/dashboard/ModernDashboardToolbar';
import { useModernDashboard } from 'shared/hooks/useModernDashboard';
import { Button } from 'shared/components/ui/button';
import { Save, RefreshCw, Trash2, Sparkles } from 'lucide-react';
import { useToast } from 'shared/components/ui/use-toast';
import { useAppDispatch } from 'shared/store';
import { initializePlot, loadChunk, ensurePlotState } from 'shared/store/slices/plotSlice';

export default function Dashboard() {
	const { data: session } = useSession();
	const { toast } = useToast();
	const dispatch = useAppDispatch();

	// Handle file selection - same logic as traditional dashboard
	const handleFileSelect = async (filePath: string) => {
		const token = session?.accessToken;
		if (!token) {
			toast({
				title: "Authentication Error",
				description: "Please log in to load files",
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

	// Initialize modern dashboard with default configuration
	const {
		widgets,
		layout,
		config,
		isLoading,
		isSaving,
		saveStatus,
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

				try {
					// Get the widget data from localStorage
					const storageKey = `modern-popped-widget-${widgetId}`;
					const storedWidget = localStorage.getItem(storageKey);

					if (storedWidget) {
						const parsedWidget = JSON.parse(storedWidget);

						// Find a good position for the returning widget
						const position = {
							x: (widgets.length * 2) % config.cols.lg,
							y: 0, // Let react-grid-layout auto-place vertically
						};

						// Add the widget back to the dashboard
						addWidget(parsedWidget.type, {
							id: parsedWidget.id,
							title: parsedWidget.title,
							metadata: parsedWidget.metadata,
						}, position);

						// Clean up localStorage
						localStorage.removeItem(storageKey);

						toast({
							title: "Widget Returned",
							description: `${parsedWidget.title} has been added back to your dashboard.`,
							duration: 3000,
						});
					}
				} catch (error) {
					console.error('Error handling widget swap-in:', error);
					toast({
						title: "Error",
						description: "Failed to return widget to dashboard.",
						variant: "destructive",
						duration: 3000,
					});
				}
			}
		};

		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, [widgets, config.cols.lg, addWidget, toast]);

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
		<ProtectedRoute>
			<div className="h-full w-full flex flex-col bg-gradient-to-br from-background to-muted/20">
				{/* Header - Fixed height to prevent layout shifts */}
				<div className="flex-shrink-0 h-[72px] flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm border-b border-border/50 relative z-[100]">
					<div className="flex items-center gap-4 min-w-0 flex-1">
						<div className="flex items-center gap-2 flex-shrink-0">
							<Sparkles className="h-5 w-5 text-primary" />
							<h1 className="text-lg font-semibold">Dashboard</h1>
						</div>
						{/* Toolbar container with proper positioning context */}
						<div className="relative">
							<ModernDashboardToolbar onAddWidget={handleAddWidget} />
						</div>
					</div>

					{/* Layout controls */}
					{session && (
						<div className="flex items-center gap-2 flex-shrink-0">
							<Button
								variant="outline"
								size="sm"
								onClick={handleManualSave}
								disabled={isSaving || !session}
								className="gap-2"
							>
								<Save className="h-4 w-4" />
								{isSaving ? 'Saving...' : 'Save Layout'}
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

				{/* Dashboard Content */}
				<div className="flex-1 relative min-h-[400px]">
					{/* Empty state */}
					{widgets.length === 0 && !isLoading && (
						<div className="absolute inset-0 flex items-center justify-center p-6">
							<div className="text-center max-w-md">
								<Sparkles className="h-12 w-12 text-primary mx-auto mb-4 opacity-50" />
								<h2 className="text-xl font-semibold mb-2">Welcome to Dashboard</h2>
								<p className="text-muted-foreground mb-6 leading-relaxed">
									Create your perfect workspace by adding widgets. Drag to rearrange, resize from corners,
									and enjoy smooth interactions powered by react-grid-layout.
								</p>
								<Button
									onClick={() => handleAddWidget('file-browser')}
									className="gap-2"
								>
									<Sparkles className="h-4 w-4" />
									Add Your First Widget
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
						isLoading={isLoading}
						isSaving={isSaving}
						saveStatus={saveStatus}
						className="h-full"
						events={{
							onBreakpointChange,
						}}
					/>
				</div>

				{/* Footer Info */}
				<div className="flex-shrink-0 h-[40px] flex items-center justify-between px-6 bg-background/50 backdrop-blur-sm border-t border-border/50">
					<div className="flex items-center gap-4 text-xs text-muted-foreground">
						<span>
							{widgets.length} widget{widgets.length !== 1 ? 's' : ''} •
							Grid: {config.cols.lg} columns •
							Auto-save: {config.autoSave ? 'enabled' : 'disabled'}
						</span>
					</div>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>Powered by react-grid-layout</span>
						{isSaving && (
							<div className="flex items-center gap-1">
								<div className="animate-spin rounded-full h-3 w-3 border-b border-primary" />
								<span>Saving...</span>
							</div>
						)}
					</div>
				</div>
			</div>
		</ProtectedRoute>
	);
}
