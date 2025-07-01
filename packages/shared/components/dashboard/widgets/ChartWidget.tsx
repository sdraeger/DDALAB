"use client";

import { useState, useEffect } from "react";
import { useAppSelector } from "../../../store";
import { BarChart3 } from "lucide-react";
import { EEGChart } from "../../plot/EEGChart";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";

interface ChartWidgetProps {
	// Props for popout mode - when provided, these override Redux state
	widgetId?: string;
	isPopout?: boolean;
	popoutPlotState?: {
		edfData?: any;
		metadata?: any;
		selectedChannels?: string[];
		filePath?: string;
		timeWindow?: [number, number];
		zoomLevel?: number;
	};
}

interface ChartState {
	timeWindow: [number, number];
	zoomLevel: number;
	selectedChannels: string[];
}

export function ChartWidget({
	widgetId = 'chart-widget-default',
	isPopout = false,
	popoutPlotState
}: ChartWidgetProps = {}) {
	const reduxPlots = useAppSelector(state => state.plots);

	// Data synchronization for cross-window communication
	const { registerDataListener, unregisterDataListener } = useWidgetDataSync(
		widgetId,
		isPopout
	);

	// Local state for synchronized plot data (used in popout mode)
	const [syncedPlots, setSyncedPlots] = useState<any>(null);

	// Synchronized chart state
	const { state: chartState, updateState: setChartState } = useWidgetState<ChartState>(
		widgetId,
		{
			timeWindow: popoutPlotState?.timeWindow || [0, 10],
			zoomLevel: popoutPlotState?.zoomLevel || 1,
			selectedChannels: popoutPlotState?.selectedChannels || [],
		},
		isPopout
	);

	// Register listener for plot data updates in popout mode
	useEffect(() => {
		if (isPopout) {
			const handlePlotDataUpdate = (plots: any) => {
				setSyncedPlots(plots);
			};

			registerDataListener('plots', handlePlotDataUpdate);

			return () => {
				unregisterDataListener('plots');
			};
		}
	}, [isPopout, registerDataListener, unregisterDataListener]);

	// Determine which plots data to use
	const effectivePlots = isPopout ? (syncedPlots || reduxPlots) : reduxPlots;

	// Use popout data if in popout mode and available, otherwise use synchronized/Redux data
	let latestFilePath: string | undefined;
	let plotState: any;

	if (isPopout && popoutPlotState && !syncedPlots) {
		// Use the provided popout data initially
		latestFilePath = popoutPlotState.filePath;
		plotState = {
			edfData: popoutPlotState.edfData,
			metadata: popoutPlotState.metadata,
			selectedChannels: chartState.selectedChannels.length > 0
				? chartState.selectedChannels
				: popoutPlotState.selectedChannels,
		};
	} else {
		// Find the most recently loaded file from effective plots
		latestFilePath = Object.keys(effectivePlots).find(filePath =>
			effectivePlots[filePath]?.metadata && effectivePlots[filePath]?.edfData
		);
		plotState = latestFilePath ? effectivePlots[latestFilePath] : null;
	}
	const hasData = plotState?.edfData !== null;
	const eegData = plotState?.edfData;
	const metadata = plotState?.metadata;

	// Use synchronized time window from state
	const timeWindow = chartState.timeWindow;

	// Update time window when new data is loaded
	useEffect(() => {
		if (eegData?.duration) {
			// Show the first 10 seconds or the full duration if less than 10 seconds
			const endTime = Math.min(10, eegData.duration);
			setChartState(prev => ({ ...prev, timeWindow: [0, endTime] }));
		}
	}, [eegData?.duration, setChartState]);

	// Get available channels - prefer selected channels if any, otherwise use all channels
	const selectedChannels = plotState?.selectedChannels?.length
		? plotState.selectedChannels
		: eegData?.channels?.slice(0, 8) || []; // Limit to first 8 channels for better visibility

	if (hasData && eegData && selectedChannels.length > 0) {
		return (
			<div className="h-full w-full relative">
				<EEGChart
					eegData={eegData}
					selectedChannels={selectedChannels}
					timeWindow={timeWindow}
					zoomLevel={chartState.zoomLevel}
					onTimeWindowChange={(newTimeWindow) =>
						setChartState(prev => ({ ...prev, timeWindow: newTimeWindow }))
					}
					height="100%"
					className="w-full h-full"
				/>

				{/* Info overlay */}
				<div className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm rounded-md p-2 text-xs">
					<div className="font-medium">{latestFilePath?.split('/').pop()}</div>
					<div className="text-muted-foreground">
						{selectedChannels.length} channels • {eegData.sampleRate}Hz
					</div>
				</div>
			</div>
		);
	}

	if (hasData && eegData && selectedChannels.length === 0) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center text-muted-foreground">
					<BarChart3 className="h-12 w-12 mx-auto mb-2 text-primary" />
					<p className="font-medium">No Channels Selected</p>
					<p className="text-xs">File: {latestFilePath?.split('/').pop()}</p>
					<p className="text-xs">Available: {eegData?.channels?.length || metadata?.availableChannels?.length || 0} channels</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center h-full">
			<div className="text-center text-muted-foreground">
				<BarChart3 className="h-12 w-12 mx-auto mb-2" />
				<p>No data to display</p>
				<p className="text-xs">Select a file to view charts</p>
			</div>
		</div>
	);
}
