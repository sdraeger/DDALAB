"use client";

import { useState, useEffect } from "react";
import { useAppSelector } from "../../../store";
import { BarChart3 } from "lucide-react";
import { EEGChart } from "../../plot/EEGChart";

export function ChartWidget() {
	const plots = useAppSelector(state => state.plots);

	// Find the most recently loaded file
	const latestFilePath = Object.keys(plots).find(filePath =>
		plots[filePath]?.metadata && plots[filePath]?.edfData
	);

	const plotState = latestFilePath ? plots[latestFilePath] : null;
	const hasData = plotState?.edfData !== null;
	const eegData = plotState?.edfData;
	const metadata = plotState?.metadata;

	// State for time window management
	const [timeWindow, setTimeWindow] = useState<[number, number]>([0, 10]);

	// Update time window when new data is loaded
	useEffect(() => {
		if (eegData?.duration) {
			// Show the first 10 seconds or the full duration if less than 10 seconds
			const endTime = Math.min(10, eegData.duration);
			setTimeWindow([0, endTime]);
		}
	}, [eegData?.duration]);

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
					zoomLevel={1}
					onTimeWindowChange={setTimeWindow}
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
