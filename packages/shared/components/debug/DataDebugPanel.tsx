import React from 'react';
import { useAppSelector } from '../../store';
import { selectPlotEdfData } from '../../store/slices/plotSlice';

interface DataDebugPanelProps {
	filePath: string;
}

export function DataDebugPanel({ filePath }: DataDebugPanelProps) {
	const edfData = useAppSelector(state => selectPlotEdfData(state, filePath));

	if (!edfData) {
		return (
			<div className="p-4 border rounded bg-yellow-50">
				<h3 className="font-bold">No EDF Data</h3>
				<p>No data found for file: {filePath}</p>
			</div>
		);
	}

	return (
		<div className="p-4 border rounded bg-blue-50 text-xs">
			<h3 className="font-bold">EDF Data Debug Info</h3>
			<div className="space-y-1">
				<div><strong>Channels:</strong> {edfData.channels?.length || 0}</div>
				<div><strong>Data Arrays:</strong> {edfData.data?.length || 0}</div>
				<div><strong>First Channel Length:</strong> {edfData.data?.[0]?.length || 0}</div>
				<div><strong>Sample Rate:</strong> {edfData.sampleRate}</div>
				<div><strong>Duration:</strong> {edfData.duration}</div>
				<div><strong>Chunk Size:</strong> {edfData.chunkSize}</div>
				<div><strong>Total Samples:</strong> {edfData.totalSamples}</div>
				{edfData.data?.[0] && (
					<div>
						<strong>First 5 Samples:</strong> {edfData.data[0].slice(0, 5).join(', ')}
					</div>
				)}
			</div>
		</div>
	);
}
