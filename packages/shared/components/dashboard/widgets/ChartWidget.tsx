"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";

import { Alert, AlertDescription } from "../../ui/alert";
import { EEGChart } from "../../plot/EEGChart";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";
import { useAppSelector } from "../../../store";
import logger from "../../../lib/utils/logger";
import type { EEGData } from "../../../types/EEGData";
import type { PlotState, PlotsState } from "../../../store/slices/plotSlice";

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

	// Render loading state
	if (isPopout && !syncedPlots && !popoutPlotState?.edfData) {
		return (
			<div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
				<div className="text-lg font-medium">Loading chart data...</div>
			</div>
		);
	}

	// Render error state
	if (isPopout && !syncedPlots?.['popped-out-file']?.edfData?.data && !popoutPlotState?.edfData?.data) {
		return (
			<div className="flex flex-col items-center justify-center h-full p-4 space-y-4">
				<div className="text-lg font-medium text-destructive">No data to display</div>
				<div className="text-sm text-muted-foreground">
					Please ensure the data is loaded in the main window.
				</div>
			</div>
		);
	}

	// Get the current plot state based on whether we're in popout mode
	const currentPlots = isPopout ? syncedPlots : plots;
	const plotState = currentPlots ? Object.values(currentPlots)[0] : null;

	// Show loading state while waiting for data in popout mode
	if (isPopout && !plotState?.edfData?.data) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<div className="text-center">
					<div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
					<p className="text-sm text-muted-foreground">Loading data...</p>
				</div>
			</div>
		);
	}

	// Show error state
	if (plotState?.error) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Alert variant="destructive">
					<AlertDescription>
						{plotState.error || "Failed to load chart data"}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	// Ensure we have valid plot data
	if (!plotState || !plotState.edfData || !plotState.metadata) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Alert>
					<AlertDescription>
						No data to display. Select a file to view charts.
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	// Extract data for the chart
	const { edfData, metadata } = plotState;
	const { selectedChannels, timeWindow, zoomLevel } = chartState;

	// Validate required data
	if (!edfData || !metadata) {
		logger.warn(`[ChartWidget] Missing required data:`, {
			widgetId,
			hasEdfData: !!edfData,
			hasMetadata: !!metadata
		});
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Alert>
					<AlertDescription>
						Loading chart data...
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	// Validate data structure
	if (!Array.isArray(edfData.data) || edfData.data.length === 0 || !Array.isArray(edfData.channels) || edfData.channels.length === 0) {
		logger.error(`[ChartWidget] Invalid EEG data structure:`, {
			widgetId,
			hasData: Array.isArray(edfData.data),
			dataLength: edfData.data?.length,
			hasChannels: Array.isArray(edfData.channels),
			channelsLength: edfData.channels?.length
		});
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Alert variant="destructive">
					<AlertDescription>
						Invalid EEG data structure
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	// Ensure we have valid time window
	const validTimeWindow = Array.isArray(timeWindow) && timeWindow.length === 2 &&
		typeof timeWindow[0] === 'number' && typeof timeWindow[1] === 'number' &&
		timeWindow[0] >= 0 && timeWindow[1] > timeWindow[0];

	if (!validTimeWindow) {
		logger.warn(`[ChartWidget] Invalid time window:`, {
			widgetId,
			timeWindow,
			isArray: Array.isArray(timeWindow),
			length: timeWindow?.length
		});
		// Reset to default time window
		setChartState(prev => ({ ...prev, timeWindow: [0, 10] }));
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Alert>
					<AlertDescription>
						Resetting invalid time window...
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="h-full w-full">
			<EEGChart
				eegData={edfData}
				selectedChannels={selectedChannels}
				timeWindow={timeWindow}
				zoomLevel={zoomLevel}
				onTimeWindowChange={(newWindow) => {
					setChartState(prev => ({ ...prev, timeWindow: newWindow }));
				}}
			/>
		</div>
	);
}
