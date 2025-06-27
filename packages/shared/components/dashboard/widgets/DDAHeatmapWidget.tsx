"use client";

import { useState, useEffect } from "react";
import { useAppSelector } from "../../../store";
import { Activity, Settings, RotateCcw } from "lucide-react";
import { DDAHeatmap } from "../../plot/DDAHeatmap";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { LoadingOverlay } from "../../ui/loading-overlay";

export function DDAHeatmapWidget() {
	const plots = useAppSelector(state => state.plots);
	const loadingManager = useLoadingManager();

	// Find the most recent plot with DDA results (Q matrix)
	const plotWithDDA = Object.entries(plots).find(([filePath, plotState]) =>
		plotState?.ddaResults?.Q && Array.isArray(plotState.ddaResults.Q) && plotState.ddaResults.Q.length > 0
	);

	const [filePath, plotState] = plotWithDDA || [null, null];
	const ddaResults = plotState?.ddaResults;
	const Q = ddaResults?.Q;
	const hasData = Q && Array.isArray(Q) && Q.length > 0;

	// Local state for heatmap processing
	const [isProcessing, setIsProcessing] = useState(false);
	const [heatmapData, setHeatmapData] = useState<any[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Process Q matrix into heatmap data
	const processQMatrix = async (matrix: any[][]) => {
		if (!matrix || !Array.isArray(matrix) || matrix.length === 0) {
			return [];
		}

		const loadingId = `heatmap-widget-${Date.now()}`;
		setIsProcessing(true);
		setError(null);

		try {
			loadingManager.startDDAProcessing(
				loadingId,
				`Processing ${matrix.length}×${matrix[0]?.length || 0} DDA heatmap...`
			);

			// Simulate processing time for visibility
			await new Promise(resolve => setTimeout(resolve, 1000));

			const points: any[] = [];
			matrix.forEach((row, rowIndex) => {
				if (Array.isArray(row)) {
					row.forEach((value, colIndex) => {
						if (typeof value === "number" && !isNaN(value)) {
							points.push({
								x: colIndex,
								y: rowIndex,
								value: value,
							});
						}
					});
				}
			});

			loadingManager.updateProgress(loadingId, 100, "Heatmap generated successfully!");
			setTimeout(() => loadingManager.stop(loadingId), 500);

			return points;
		} catch (err) {
			loadingManager.stop(loadingId);
			setError(err instanceof Error ? err.message : "Failed to process heatmap");
			return [];
		} finally {
			setIsProcessing(false);
		}
	};

	// Process data when Q matrix changes
	useEffect(() => {
		if (hasData && Q) {
			processQMatrix(Q).then(setHeatmapData);
		} else {
			setHeatmapData([]);
		}
	}, [Q, hasData]);

	const handleRefresh = () => {
		if (hasData && Q) {
			processQMatrix(Q).then(setHeatmapData);
		}
	};

	if (!hasData) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-sm">
						<Activity className="h-4 w-4" />
						DDA Heatmap
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 flex items-center justify-center">
					<div className="text-center text-muted-foreground">
						<Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
						<p className="text-sm">No DDA results available</p>
						<p className="text-xs mt-1">Run DDA analysis to see results</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-sm">
						<Activity className="h-4 w-4" />
						DDA Heatmap
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 flex flex-col items-center justify-center">
					<div className="text-center text-destructive">
						<p className="text-sm">Error processing heatmap</p>
						<p className="text-xs mt-1">{error}</p>
						<Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2">
							<RotateCcw className="h-3 w-3 mr-1" />
							Retry
						</Button>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-full flex flex-col relative">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<CardTitle className="flex items-center gap-2 text-sm">
						<Activity className="h-4 w-4" />
						DDA Heatmap
					</CardTitle>
					<div className="flex items-center gap-2">
						<Badge variant="secondary" className="text-xs">
							{Q.length}×{Q[0]?.length || 0}
						</Badge>
						<Button variant="ghost" size="sm" onClick={handleRefresh}>
							<RotateCcw className="h-3 w-3" />
						</Button>
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex-1 p-0 relative overflow-hidden">
				{isProcessing && (
					<LoadingOverlay
						show={true}
						message="Processing DDA Heatmap..."
						type="dda-processing"
						variant="modal"
						size="lg"
					/>
				)}

				{!isProcessing && heatmapData.length > 0 && (
					<div className="h-full w-full">
						<DDAHeatmap
							data={heatmapData}
							height={300}
							onClose={() => { }} // No close button in widget
						/>
					</div>
				)}

				{!isProcessing && heatmapData.length === 0 && (
					<div className="flex items-center justify-center h-full text-muted-foreground">
						<div className="text-center">
							<Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
							<p className="text-sm">No heatmap data</p>
						</div>
					</div>
				)}
			</CardContent>

			{/* Info overlay */}
			{filePath && !isProcessing && (
				<div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded-md p-2 text-xs">
					<div className="font-medium">{filePath.split('/').pop()}</div>
					<div className="text-muted-foreground">
						{heatmapData.length} data points
					</div>
				</div>
			)}
		</Card>
	);
}
