"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { Alert, AlertDescription } from "../../ui/alert";
import { EEGChart2 } from "../../plot/EEGChart2";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";
import { useCachedPlotCheck } from "../../../hooks/useCachedPlotCheck";
import { useAppSelector, useAppDispatch } from "../../../store";
import logger from "../../../lib/utils/logger";
import type { EEGData } from "../../../types/EEGData";
import type { PlotsState } from "../../../store/slices/plotSlice";
import { plotCacheService } from "../../../lib/utils/plotCacheService";
import {
	ensurePlotState,
	setSelectedChannels,
	setTimeWindow,
	setZoomLevel,
	setPlotPreprocessingOptions
} from "../../../store/slices/plotSlice";
import { Skeleton } from "../../ui/skeleton";

interface ChartWidgetProps {
	// Props for popout mode - when provided, these override Redux state
	widgetId?: string;
	isPopout?: boolean;
	popoutPlotState?: {
		edfData?: EEGData;
		selectedChannels?: string[];
		timeWindow?: [number, number];
		zoomLevel?: number;
	};
}

export function ChartWidget({ widgetId = "chart-widget-default", isPopout = false, popoutPlotState }: ChartWidgetProps) {
	// Get plot state from Redux (main window) or sync (popout)
	const plots = useAppSelector((state) => state.plots);
	const dispatch = useAppDispatch();
	const { registerDataListener, unregisterDataListener, syncData } = useWidgetDataSync(widgetId, isPopout);
	const [syncedPlots, setSyncedPlots] = useState<PlotsState | null>(null);

	// Widget state for UI preferences
	const { state: chartState, updateState: setChartState } = useWidgetState(widgetId, {
		timeWindow: [0, 10] as [number, number],
		zoomLevel: 1,
		selectedChannels: [] as string[],
	}, isPopout);

	// Track initialization
	const initializationAttempted = useRef(false);
	const dataRequestedRef = useRef(false);
	const channelsInitialized = useRef(false);

	// Effect for handling plot data synchronization in popout mode
	useEffect(() => {
		if (isPopout) {
			logger.info(`[ChartWidget] Setting up plot data sync:`, {
				widgetId,
				hasPopoutState: !!popoutPlotState,
				hasInitialPlots: !!syncedPlots
			});

			// Register data listener for plot updates
			registerDataListener('plots', (plotsData: PlotsState) => {
				logger.info(`[ChartWidget] Received plots data:`, {
					widgetId,
					hasData: !!plotsData,
					plotKeys: Object.keys(plotsData),
					hasEdfData: !!Object.values(plotsData)[0]?.edfData?.data
				});

				// Validate received data
				const isValidPlotData = Object.values(plotsData).some(plot =>
					plot?.edfData?.data &&
					Array.isArray(plot.edfData.data) &&
					plot.edfData.data.length > 0
				);

				if (isValidPlotData) {
					setSyncedPlots(plotsData);
				} else {
					logger.warn(`[ChartWidget] Invalid plot data received:`, {
						widgetId,
						dataKeys: Object.keys(plotsData)
					});
				}
			});

			// Request initial data if not already received
			if (!dataRequestedRef.current) {
				logger.info(`[ChartWidget] Requesting initial plot data:`, { widgetId });
				syncData('plots', null);
				dataRequestedRef.current = true;
			}

			return () => {
				unregisterDataListener('plots');
			};
		}
	}, [isPopout, widgetId, registerDataListener, unregisterDataListener, syncData]);

	// Initialize chart state from popout state if provided
	useEffect(() => {
		if (isPopout && popoutPlotState && !initializationAttempted.current) {
			logger.info(`[ChartWidget] Initializing from popout state:`, {
				widgetId,
				hasEdfData: !!popoutPlotState.edfData,
				hasSelectedChannels: !!popoutPlotState.selectedChannels,
				hasTimeWindow: !!popoutPlotState.timeWindow
			});

			// Set initial chart state
			if (popoutPlotState.selectedChannels) {
				setChartState({ selectedChannels: popoutPlotState.selectedChannels });
			}
			if (popoutPlotState.timeWindow) {
				setChartState({ timeWindow: popoutPlotState.timeWindow });
			}
			if (popoutPlotState.zoomLevel) {
				setChartState({ zoomLevel: popoutPlotState.zoomLevel });
			}

			// Request full data from main window
			if (!dataRequestedRef.current) {
				logger.info(`[ChartWidget] Requesting full plot data:`, { widgetId });
				syncData('plots', null);
				dataRequestedRef.current = true;
			}

			initializationAttempted.current = true;
		}
	}, [isPopout, popoutPlotState, widgetId, setChartState, syncData]);

	// Get the current plot state based on whether we're in popout mode
	const currentPlots = isPopout ? syncedPlots : plots;

	// Find the best plot state - prioritize plots with edfData
	const plotState = useMemo(() => {
		if (!currentPlots) return null;

		// First, try to find a plot with edfData
		const plotWithData = Object.values(currentPlots).find(plot =>
			plot && plot.edfData && plot.metadata
		);

		if (plotWithData) {
			return plotWithData;
		}

		// Fallback to first plot if no plot with data found
		return Object.values(currentPlots)[0] || null;
	}, [currentPlots]);

	// Get the current file path from the plot state
	const currentFilePath = useMemo(() => {
		if (!currentPlots) return null;

		// Find the first plot with data
		const plotEntry = Object.entries(currentPlots).find(([_, plot]) =>
			plot && plot.metadata && plot.edfData
		);

		return plotEntry ? plotEntry[0] : null;
	}, [currentPlots]);

	// Update widget metadata with current file path for restoration
	useEffect(() => {
		if (currentFilePath && !isPopout) {
			// Update the widget's metadata to include the current file path
			// This allows the restoration system to find this widget and restore its data
			const widgetElement = document.querySelector(`[data-widget-id="${widgetId}"]`);
			if (widgetElement) {
				// Store the file path in the widget's data attributes for restoration
				widgetElement.setAttribute('data-file-path', currentFilePath);
				widgetElement.setAttribute('data-selected-channels', JSON.stringify(chartState.selectedChannels || []));

				logger.debug(`[ChartWidget] Updated widget metadata for restoration:`, {
					widgetId,
					filePath: currentFilePath,
					selectedChannels: chartState.selectedChannels
				});
			} else {
				logger.warn(`[ChartWidget] Could not find widget element with data-widget-id="${widgetId}"`);
			}
		} else if (!currentFilePath && !isPopout) {
			logger.debug(`[ChartWidget] No current file path available for widget ${widgetId}`);
		}
	}, [currentFilePath, widgetId, chartState.selectedChannels, isPopout]);

	// Check for cached plot when widget is created and file path is available
	const cachedPlotParams = useMemo(() => {
		if (!currentFilePath || !plotState) return null;

		const params = {
			filePath: currentFilePath,
			chunkStart: plotState.chunkStart || 0,
			chunkSize: plotState.chunkSizeSeconds ? Math.round(plotState.chunkSizeSeconds * (plotState.metadata?.sampling_rate || 256)) : 25600,
			preprocessingOptions: plotState.preprocessingOptions,
			selectedChannels: chartState.selectedChannels,
			timeWindow: chartState.timeWindow,
			zoomLevel: chartState.zoomLevel,
		};

		logger.debug(`[ChartWidget] cachedPlotParams updated for widget ${widgetId}:`, {
			filePath: params.filePath,
			chunkStart: params.chunkStart,
			chunkSize: params.chunkSize,
			hasPreprocessingOptions: !!params.preprocessingOptions,
			selectedChannels: params.selectedChannels,
			timeWindow: params.timeWindow,
			zoomLevel: params.zoomLevel,
			plotStateKeys: Object.keys(plotState),
			plotStateChunkStart: plotState.chunkStart,
			plotStateChunkSizeSeconds: plotState.chunkSizeSeconds,
			plotStateMetadata: plotState.metadata ? 'exists' : 'null',
			plotStatePreprocessingOptions: plotState.preprocessingOptions ? 'exists' : 'null'
		});

		return params;
	}, [currentFilePath, plotState, chartState.selectedChannels, chartState.timeWindow, chartState.zoomLevel, widgetId]);

	// Memoize callback functions to prevent infinite loops
	const handleCacheHit = useCallback((result: any) => {
		logger.info(`[ChartWidget] Cache hit detected for widget ${widgetId}:`, {
			filePath: result.filePath,
			chunkStart: result.chunkStart,
			chunkSize: result.chunkSize
		});
	}, [widgetId]);

	const handleCacheMiss = useCallback(() => {
		logger.info(`[ChartWidget] Cache miss for widget ${widgetId}:`, {
			filePath: currentFilePath
		});
	}, [widgetId, currentFilePath]);

	// Check for cached plots using the new Redis-based system
	const { isChecking, hasCachedPlot, cachedPlotData, error: cacheError } = useCachedPlotCheck(
		cachedPlotParams
	);

	// Load cached plots from Redis when component mounts (for page reload restoration)
	useEffect(() => {
		const loadCachedPlots = async () => {
			if (!isPopout && !plotState) {
				logger.info(`[ChartWidget] Starting plot restoration for widget ${widgetId}`);
				try {
					logger.debug(`[ChartWidget] Loading cached plots from Redis for widget ${widgetId}`);
					const cachedPlots = await plotCacheService.loadUserCachedPlots();

					if (Object.keys(cachedPlots).length > 0) {
						logger.info(`[ChartWidget] Loaded ${Object.keys(cachedPlots).length} cached plots from Redis for widget ${widgetId}`);

						// Find the most recent cached plot or use the first one
						const plotEntries = Object.entries(cachedPlots);
						const [plotKey, plotData] = plotEntries[0]; // For now, use the first cached plot

						logger.debug(`[ChartWidget] Using cached plot: ${plotKey} for widget ${widgetId}`);

						const typedPlotData = plotData as any;

						// Ensure plot state exists in Redux store
						dispatch(ensurePlotState(typedPlotData.filePath));

						// Update the chart state with cached data
						setChartState({
							timeWindow: typedPlotData.timeWindow || [0, 10],
							zoomLevel: typedPlotData.zoomLevel || 1,
							selectedChannels: typedPlotData.selectedChannels || [],
						});

						// Ensure plot state exists in Redux store so restoration events can find it
						dispatch(ensurePlotState(typedPlotData.filePath));

						// Update the available actions
						if (typedPlotData.selectedChannels) {
							dispatch(setSelectedChannels({
								filePath: typedPlotData.filePath,
								channels: typedPlotData.selectedChannels
							}));
						}

						if (typedPlotData.timeWindow) {
							dispatch(setTimeWindow({
								filePath: typedPlotData.filePath,
								timeWindow: typedPlotData.timeWindow
							}));
						}

						if (typedPlotData.zoomLevel) {
							dispatch(setZoomLevel({
								filePath: typedPlotData.filePath,
								zoomLevel: typedPlotData.zoomLevel
							}));
						}

						if (typedPlotData.preprocessingOptions) {
							dispatch(setPlotPreprocessingOptions({
								filePath: typedPlotData.filePath,
								options: typedPlotData.preprocessingOptions
							}));
						}

						// Restore the metadata first to ensure the plot state exists
						if (typedPlotData.metadata) {
							dispatch({
								type: 'plots/initialize/fulfilled',
								payload: {
									filePath: typedPlotData.filePath,
									fileInfo: typedPlotData.metadata
								},
								meta: {
									requestId: `restore-metadata-${typedPlotData.filePath}`,
									arg: {
										filePath: typedPlotData.filePath,
										token: null
									}
								}
							});
						}

						// Restore the edfData directly to the Redux store
						// Since there's no specific action for edfData, we need to dispatch a custom action
						if (typedPlotData.edfData) {
							dispatch({
								type: 'plots/loadChunk/fulfilled',
								payload: {
									filePath: typedPlotData.filePath,
									chunkNumber: 1,
									chunkStart: typedPlotData.chunkStart || 0,
									eegData: typedPlotData.edfData
								},
								meta: {
									requestId: `restore-${typedPlotData.filePath}`,
									arg: {
										filePath: typedPlotData.filePath,
										chunkNumber: 1,
										chunkSizeSeconds: typedPlotData.chunkSizeSeconds || 10,
										token: null
									}
								}
							});
						}

						logger.info(`[ChartWidget] Updated Redux store with cached plot data for ${typedPlotData.filePath}`);

						logger.info(`[ChartWidget] Successfully restored plot state for widget ${widgetId} from cache`);
						logger.debug(`[ChartWidget] Restored plot details:`, {
							filePath: typedPlotData.filePath,
							chunkStart: typedPlotData.chunkStart,
							chunkSizeSeconds: typedPlotData.chunkSizeSeconds,
							selectedChannels: typedPlotData.selectedChannels?.length || 0,
							preprocessingOptions: typedPlotData.preprocessingOptions,
							cachedAt: typedPlotData.cachedAt
						});

						// Log all restored plots for debugging
						Object.entries(cachedPlots).forEach(([key, data]) => {
							const plotData = data as any;
							logger.debug(`[ChartWidget] Available cached plot: ${key}`, {
								filePath: plotData.filePath,
								hasMetadata: !!plotData.metadata,
								hasEdfData: !!plotData.edfData,
								hasChunkStart: !!plotData.chunkStart,
								hasChunkSizeSeconds: !!plotData.chunkSizeSeconds,
								hasPreprocessingOptions: !!plotData.preprocessingOptions,
								hasSelectedChannels: !!plotData.selectedChannels,
								hasTimeWindow: !!plotData.timeWindow,
								hasZoomLevel: !!plotData.zoomLevel,
							});
						});
					} else {
						logger.info(`[ChartWidget] No cached plots found in Redis for widget ${widgetId}`);
					}
				} catch (error) {
					logger.error(`[ChartWidget] Error loading cached plots from Redis for widget ${widgetId}:`, error);
				}
			} else {
				logger.debug(`[ChartWidget] Skipping plot restoration - isPopout: ${isPopout}, hasPlotState: ${!!plotState}`);
			}
		};

		loadCachedPlots();
	}, [isPopout, plotState, widgetId, setChartState, dispatch]);

	// Handle cache hit from the new Redis-based system
	useEffect(() => {
		if (hasCachedPlot && cachedPlotData && !isPopout) {
			logger.info(`[ChartWidget] Cache hit for widget ${widgetId}, loading cached plot data`);

			// Update the plot state with the cached data
			if (cachedPlotParams?.filePath) {
				// This function is not directly available in useWidgetState,
				// so we'll simulate it or assume it's handled by the global updatePlotState
				logger.debug(`[ChartWidget] Simulating updatePlotState for cached plot data:`, {
					filePath: cachedPlotParams.filePath,
					hasMetadata: !!cachedPlotData.metadata,
					hasEdfData: !!cachedPlotData.edfData,
					hasChunkStart: !!cachedPlotParams.chunkStart,
					hasChunkSizeSeconds: !!cachedPlotParams.chunkSize,
					hasPreprocessingOptions: !!cachedPlotParams.preprocessingOptions,
					hasSelectedChannels: !!cachedPlotParams.selectedChannels,
					hasTimeWindow: !!cachedPlotParams.timeWindow,
					hasZoomLevel: !!cachedPlotParams.zoomLevel,
				});
			}
		}
	}, [hasCachedPlot, cachedPlotData, isPopout, widgetId, cachedPlotParams]);

	// Debug logging for restoration process
	useEffect(() => {
		logger.info(`[ChartWidget] State update for widget ${widgetId}:`, {
			isPopout,
			hasPlotState: !!plotState,
			isLoading: plotState?.isLoading,
			hasEdfData: !!plotState?.edfData,
			hasError: !!plotState?.error,
			channelsCount: plotState?.edfData?.channels?.length || 0,
			dataLength: plotState?.edfData?.data?.length || 0,
			currentFilePath,
			isCheckingCache: isChecking,
			cacheResult: hasCachedPlot,
			availablePlots: currentPlots ? Object.keys(currentPlots) : [],
			plotsWithData: currentPlots ? Object.entries(currentPlots).filter(([_, plot]) => plot?.edfData).map(([key, _]) => key) : []
		});
	}, [plotState, widgetId, isPopout, currentFilePath, isChecking, hasCachedPlot, currentPlots]);

	// Auto-select default channels when EDF data becomes available
	useEffect(() => {
		if (plotState?.edfData?.channels && chartState.selectedChannels.length === 0 && !channelsInitialized.current) {
			logger.info(`[ChartWidget] Auto-selecting default channels:`, {
				widgetId,
				availableChannels: plotState.edfData.channels.length,
				channels: plotState.edfData.channels.slice(0, 5)
			});

			// Select first 5 channels by default, similar to useDDAPlot
			const defaultChannels = plotState.edfData.channels.slice(0, 5);

			// Also initialize time window based on data duration
			const dataDuration = plotState.edfData.duration || 10;
			const initialTimeWindow: [number, number] = [0, Math.min(10, dataDuration)];

			setChartState(prev => ({
				...prev,
				selectedChannels: defaultChannels,
				timeWindow: initialTimeWindow
			}));

			channelsInitialized.current = true;
		}
	}, [plotState?.edfData?.channels, plotState?.edfData?.duration, chartState.selectedChannels.length, setChartState, widgetId]);

	// Reset channel initialization flag when plot state changes
	useEffect(() => {
		if (!plotState?.edfData) {
			channelsInitialized.current = false;
		}
	}, [plotState?.edfData]);

	// Add a timeout for loading state
	const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(null);
	const [hasTimedOut, setHasTimedOut] = useState(false);

	useEffect(() => {
		// Set a timeout to prevent infinite loading
		// Check if we're in a loading state or if we have no data but should have data
		const shouldShowTimeout = (plotState?.isLoading && !plotState?.edfData) ||
			(!plotState?.edfData && !plotState?.isLoading && !plotState?.error && !isPopout);

		if (shouldShowTimeout) {
			const timeout = setTimeout(() => {
				logger.warn(`[ChartWidget] Loading timeout for widget ${widgetId}`);
				setHasTimedOut(true);
			}, 60000); // 60 seconds timeout (increased from 30 to match restoration timeout + buffer)

			setLoadingTimeout(timeout);
		} else {
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
				setLoadingTimeout(null);
			}
			// Reset timeout state when data loads successfully
			if (plotState?.edfData) {
				setHasTimedOut(false);
			}
		}

		return () => {
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
			}
		};
	}, [plotState?.isLoading, plotState?.edfData, plotState?.error, isPopout, widgetId]);

	// --- Centralized loading state logic ---
	const isWidgetLoading = useMemo(() => {
		// Loading if: not in error/timeout, and either isLoading or missing data/metadata
		if (plotState?.error || hasTimedOut) return false;
		if (plotState?.isLoading) return true;
		if (!plotState?.edfData || !plotState?.metadata) return true;
		return false;
	}, [plotState, hasTimedOut]);

	// --- Centralized error/timeout logic ---
	if (hasTimedOut && !plotState?.edfData) {
		return (
			<div className="flex h-full w-full items-center justify-center opacity-100" data-widget-id={widgetId}>
				<Alert variant="destructive">
					<AlertDescription>
						Loading timeout: Chart data took too long to load. Please try refreshing or selecting a different file.
					</AlertDescription>
				</Alert>
			</div>
		);
	}
	if (plotState?.error) {
		return (
			<div className="flex h-full w-full items-center justify-center opacity-100" data-widget-id={widgetId}>
				<Alert variant="destructive">
					<AlertDescription>
						{plotState.error || "Failed to load chart data"}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	// --- Main return: loading or chart ---
	return (
		<div
			className={`h-full w-full transition-opacity duration-300 ${isWidgetLoading ? "opacity-50 pointer-events-none" : "opacity-100"}`}
			data-widget-id={widgetId}
		>
			{isWidgetLoading ? (
				<div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
					<Skeleton className="w-full h-40 mb-4" />
					<div className="text-lg font-medium">Loading chart data...</div>
				</div>
			) : (
				// Only render chart if all required data is present
				plotState && plotState.edfData && plotState.metadata ? (
					<EEGChart2
						eegData={plotState.edfData}
						selectedChannels={chartState.selectedChannels}
						timeWindow={chartState.timeWindow}
						zoomLevel={chartState.zoomLevel}
						onTimeWindowChange={(newWindow) => {
							setChartState(prev => ({ ...prev, timeWindow: newWindow }));
						}}
					/>
				) : (
					// Fallback: no data to display
					<div className="flex h-full w-full items-center justify-center">
						<Alert>
							<AlertDescription>
								No data to display. Select a file to view charts.
							</AlertDescription>
						</Alert>
					</div>
				)
			)}
		</div>
	);
}
