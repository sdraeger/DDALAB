"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "shared/components/ui/button";
import { ArrowLeft, Copy } from "lucide-react";
import { WidgetFactoryService } from "shared/services/WidgetFactoryService";
import { IDashboardWidget } from "shared/types/dashboard";
import { useToast } from "shared/components/ui/use-toast";
import { cn } from "shared/lib/utils/misc";
import { useWidgetDataSync } from "shared/hooks/useWidgetDataSync";
import { useAppDispatch } from "shared/store";
import { ensurePlotState } from "shared/store/slices/plotSlice";
import logger from "shared/lib/utils/logger";

interface SerializableModernWidget {
	id: string;
	title: string;
	type: string;
	metadata?: Record<string, any>;
	constraints?: any;
	supportsPopout?: boolean;
	popoutPreferences?: any;
}

type PopoutSize = 'normal' | 'large' | 'fullscreen';

export default function ModernWidgetPopoutPage() {
	const params = useParams();
	const searchParams = useSearchParams();
	const router = useRouter();
	const { data: session } = useSession();
	const { toast } = useToast();
	const dispatch = useAppDispatch();

	const [widget, setWidget] = useState<IDashboardWidget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [popoutSize, setPopoutSize] = useState<PopoutSize>('large');

	const widgetId = params?.id as string;
	const storageKey = searchParams?.get('storageKey');
	const widgetFactory = WidgetFactoryService.getInstance();
	const { registerDataListener, unregisterDataListener, syncData } = useWidgetDataSync(widgetId, true);

	// Effect for handling data synchronization from the main window
	useEffect(() => {
		if (!widgetId) return;

		const handlePlotsData = (plotsData: any) => {
			logger.info(`[Popout] Received plots data:`, {
				widgetId,
				hasData: !!plotsData,
				dataKeys: plotsData ? Object.keys(plotsData) : null,
				plotStates: plotsData ? Object.entries(plotsData).map(([key, value]: [string, any]) => ({
					key,
					hasEdfData: !!value?.edfData,
					hasMetadata: !!value?.metadata,
					isLoading: value?.isLoading,
					error: value?.error
				})) : null
			});

			if (plotsData && Object.keys(plotsData).length > 0) {
				logger.info(`[Popout] Dispatching plots data to Redux...`, {
					widgetId,
					plotKeys: Object.keys(plotsData)
				});

				// Ensure plot state exists for each file path
				Object.keys(plotsData).forEach(filePath => {
					dispatch(ensurePlotState(filePath));
				});

				// Update each plot's state
				Object.entries(plotsData).forEach(([filePath, plotState]: [string, any]) => {
					if (!plotState) {
						logger.warn(`[Popout] Plot state is null for ${filePath}`);
						return;
					}

					Object.entries(plotState).forEach(([key, value]) => {
						if (key !== 'isLoading' && key !== 'error') { // Skip transient state
							const action = {
								type: `plots/set${key.charAt(0).toUpperCase() + key.slice(1)}`,
								payload: { filePath, [key]: value }
							};
							logger.info(`[Popout] Dispatching action:`, {
								widgetId,
								actionType: action.type,
								filePath,
								hasValue: !!value
							});
							dispatch(action);
						}
					});
				});
			} else {
				logger.warn(`[Popout] No plot data received or empty data object`, {
					widgetId,
					timestamp: Date.now()
				});
			}
		};

		// Handle data request from main window
		const handleDataRequest = () => {
			logger.info(`[Popout] Received data request from main window`, {
				widgetId,
				timestamp: Date.now()
			});
			// We don't need to do anything here as the popout window is the data receiver
		};

		// Register data listeners
		const cleanup = registerDataListener('plots', handlePlotsData);
		const requestCleanup = registerDataListener('REQUEST_PLOTS_DATA', handleDataRequest);

		// Request initial data from main window
		logger.info(`[Popout] Requesting initial data...`, {
			widgetId,
			timestamp: Date.now()
		});
		syncData('plots', null);

		return () => {
			if (cleanup) cleanup();
			if (requestCleanup) requestCleanup();
			unregisterDataListener('plots');
			unregisterDataListener('REQUEST_PLOTS_DATA');
		};
	}, [widgetId, dispatch, registerDataListener, unregisterDataListener, syncData]);


	// Effect for initializing the widget from localStorage
	useEffect(() => {
		if (!widgetId) {
			setError("Widget ID not provided");
			return;
		}

		if (!storageKey) {
			setError("Storage key not provided");
			return;
		}

		const storedWidget = localStorage.getItem(storageKey);

		logger.info(`[Popout] Initializing widget from localStorage:`, {
			widgetId,
			storageKey,
			hasStoredData: !!storedWidget,
			storedData: storedWidget ? JSON.parse(storedWidget) : null
		});

		if (storedWidget) {
			try {
				const parsedWidget: SerializableModernWidget = JSON.parse(storedWidget);

				logger.info(`[Popout] Parsed widget data:`, {
					widgetId,
					type: parsedWidget.type,
					hasMetadata: !!parsedWidget.metadata,
					metadataKeys: parsedWidget.metadata ? Object.keys(parsedWidget.metadata) : null,
					hasPopoutPlotState: !!parsedWidget.metadata?.popoutPlotState
				});

				// Initialize plot state if available
				if (parsedWidget.metadata?.popoutPlotState) {
					const { selectedChannels, timeWindow, zoomLevel, edfMetadata } = parsedWidget.metadata.popoutPlotState;
					logger.info(`[Popout] Initializing plot state:`, {
						widgetId,
						hasEdfMetadata: !!edfMetadata,
						hasSelectedChannels: !!selectedChannels,
						hasTimeWindow: !!timeWindow,
						hasZoomLevel: !!zoomLevel
					});

					// Create a placeholder plot state with metadata
					const plotState = {
						'popped-out-file': {
							selectedChannels: selectedChannels || [],
							timeWindow: timeWindow || [0, 10],
							zoomLevel: zoomLevel || 1,
							metadata: {
								file_path: 'popped-out-file',
								num_chunks: 1,
								chunk_size: edfMetadata.sampleRate, // Use sampleRate as chunk size
								total_samples: edfMetadata.sampleRate * edfMetadata.duration,
								sampling_rate: edfMetadata.sampleRate,
								total_duration: edfMetadata.duration,
								availableChannels: edfMetadata.channels
							},
							isLoading: true, // Set to true until we receive the actual data
							isMetadataLoading: false,
							isHeatmapProcessing: false,
							error: null,
							chunkSizeSeconds: edfMetadata.duration,
							currentChunkNumber: 1,
							totalChunks: 1,
							chunkStart: 0,
							absoluteTimeWindow: [0, edfMetadata.duration],
							showHeatmap: false,
							ddaHeatmapData: null,
							ddaResults: null,
							annotations: null,
							showSettingsDialog: false,
							showZoomSettingsDialog: false,
							preprocessingOptions: null
						}
					};

					// Ensure plot state exists
					dispatch(ensurePlotState('popped-out-file'));

					// Update plot state
					Object.entries(plotState['popped-out-file']).forEach(([key, value]) => {
						if (key !== 'isLoading' && key !== 'error') { // Skip transient state
							const action = {
								type: `plots/set${key.charAt(0).toUpperCase() + key.slice(1)}`,
								payload: { filePath: 'popped-out-file', [key]: value }
							};
							logger.info(`[Popout] Dispatching action:`, {
								widgetId,
								actionType: action.type,
								hasValue: !!value
							});
							dispatch(action);
						}
					});
				}

				const recreatedWidget = widgetFactory.createWidget(parsedWidget.type, {
					id: parsedWidget.id,
					title: parsedWidget.title,
					metadata: parsedWidget.metadata,
					isPopout: true,
					popoutSize: popoutSize,
				});

				setWidget(recreatedWidget);

				const defaultSize = parsedWidget.popoutPreferences?.defaultSize || 'large';
				setPopoutSize(defaultSize);

			} catch (err) {
				logger.error(`[Popout] Error parsing widget data:`, {
					widgetId,
					error: err,
					storedData: storedWidget
				});
				setError("Failed to parse widget data");
			}
		} else {
			setError("Widget data not found");
		}

		// Clean up storage when window is closed
		const handleUnload = () => {
			localStorage.removeItem(storageKey);
		};
		window.addEventListener('unload', handleUnload);
		return () => {
			window.removeEventListener('unload', handleUnload);
			localStorage.removeItem(storageKey);
		};
	}, [widgetId, storageKey, widgetFactory, popoutSize, dispatch]);


	// Effect for handling window messages (e.g., pop-in)
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;

			if (event.data.type === 'SWAP_IN_MODERN_WIDGET') {
				// This message is handled by the main window, not the pop-out.
				// The pop-out initiates the swap via handleSwapIn.
			}
		};
		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);


	const handleSwapIn = useCallback(() => {
		if (window.opener && widget) {
			window.opener.postMessage(
				{
					type: "SWAP_IN_MODERN_WIDGET",
					widgetId: widget.id,
				},
				window.location.origin
			);
			window.close();
		}
	}, [widget]);

	const handleCopyWidgetInfo = useCallback(() => {
		if (!widget) return;

		const widgetInfo = `Widget: ${widget.title}\nType: ${widget.type}\nID: ${widget.id}`;
		navigator.clipboard.writeText(widgetInfo).then(() => {
			toast({
				title: "Widget Info Copied",
				description: "Widget information has been copied to clipboard.",
				duration: 2000,
			});
		});
	}, [widget, toast]);

	const toggleSize = (size: PopoutSize) => {
		setPopoutSize(size);
	};

	const getSizeClasses = () => {
		switch (popoutSize) {
			case 'normal':
				return 'max-w-4xl mx-auto';
			case 'large':
				return 'max-w-7xl mx-auto';
			case 'fullscreen':
				return 'w-full h-full';
			default:
				return 'max-w-7xl mx-auto';
		}
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey) {
				if (event.key === 'c') {
					handleCopyWidgetInfo();
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleCopyWidgetInfo]);

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center min-h-screen bg-muted">
				<div className="text-center p-8 bg-background rounded-lg shadow-xl">
					<h2 className="text-2xl font-bold text-destructive mb-4">Widget Error</h2>
					<p className="text-muted-foreground mb-6">{error}</p>
					<Button onClick={() => router.push('/dashboard')}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Return to Dashboard
					</Button>
				</div>
			</div>
		);
	}

	if (!widget) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-muted">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
					<p className="text-lg font-semibold">Loading Widget...</p>
					<p className="text-muted-foreground">Please wait a moment</p>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("popout-widget-page bg-background flex flex-col h-screen overflow-hidden", getSizeClasses())}>
			{/* Header */}
			<header className="flex items-center justify-between p-3 border-b bg-muted/40 flex-shrink-0">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={handleSwapIn} title="Return to Dashboard">
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div>
						<h1 className="text-lg font-semibold">{widget.title}</h1>
						<p className="text-sm text-muted-foreground">{widget.type}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button variant={popoutSize === 'normal' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('normal')}>Normal</Button>
					<Button variant={popoutSize === 'large' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('large')}>Large</Button>
					<Button variant={popoutSize === 'fullscreen' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('fullscreen')}>Fullscreen</Button>
					<Button variant="ghost" size="icon" onClick={handleCopyWidgetInfo} title="Copy Widget Info (Cmd/Ctrl+C)">
						<Copy className="h-5 w-5" />
					</Button>
				</div>
			</header>

			{/* Widget Content */}
			<main className="flex-1 overflow-auto p-4">
				<div className="h-full w-full">
					{widget.content}
				</div>
			</main>
		</div>
	);
}
