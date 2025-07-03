"use client";

import { useMemo, useState } from 'react';
import { useAppSelector } from '../../../store';
import { DDAPlot } from '../../plot/DDAPlot';
import { Card } from '../../ui/card';
import { Alert, AlertDescription } from '../../ui/alert';

interface DDALinePlotWidgetContainerProps {
	widgetId?: string;
	isPopout?: boolean;
	[key: string]: any; // Allow other props
}

export function DDALinePlotWidgetContainer(props: DDALinePlotWidgetContainerProps) {
	const plots = useAppSelector(state => state.plots);
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

	const activeFilePath = useMemo(() => {
		// Find the most recently fetched file path
		let latestTime = 0;
		let activePath = '';
		for (const [filePath, plotState] of Object.entries(plots)) {
			if (plotState && plotState.lastFetchTime && plotState.lastFetchTime > latestTime) {
				latestTime = plotState.lastFetchTime;
				activePath = filePath;
			}
		}
		return activePath;
	}, [plots]);

	if (!activeFilePath) {
		return (
			<Card className="h-full flex items-center justify-center p-4">
				<Alert>
					<AlertDescription>
						No active file. Please load a file to see the DDA Line Plot.
					</AlertDescription>
				</Alert>
			</Card>
		);
	}

	return <DDAPlot {...props} filePath={activeFilePath} selectedChannels={selectedChannels} onChannelSelectionChange={setSelectedChannels} setSelectedChannels={setSelectedChannels} />;
}
