"use client";

import { useState, useEffect, useMemo } from "react";
import { useAppSelector } from "../../../store";
import { TrendingUp, Settings, RotateCcw, Plus, Minus } from "lucide-react";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { LoadingOverlay } from "../../ui/loading-overlay";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";
import { PlotState } from "../../../store/slices/plotSlice";

interface DDALinePlotWidgetProps {
	widgetId?: string;
	isPopout?: boolean;
}

interface DDALinePlotState {
	plotMode: "all" | "average" | "individual";
	selectedRow: number;
	maxDisplayRows: number;
	isProcessing: boolean;
	error: string | null;
}

export function DDALinePlotWidget({
	widgetId = 'dda-lineplot-widget-default',
	isPopout = false
}: DDALinePlotWidgetProps = {}) {
	const plots = useAppSelector(state => state.plots);
	const loadingManager = useLoadingManager();

	// Data synchronization for cross-window communication
	const { registerDataListener, unregisterDataListener } = useWidgetDataSync(
		widgetId,
		isPopout
	);

	// Local state for synchronized plot data (used in popout mode)
	const [syncedPlots, setSyncedPlots] = useState<any>(null);

	// Synchronized widget state
	const { state: widgetState, updateState: setWidgetState } = useWidgetState<DDALinePlotState>(
		widgetId,
		{
			plotMode: "average",
			selectedRow: 0,
			maxDisplayRows: 5,
			isProcessing: false,
			error: null,
		},
		isPopout
	);

	// Extract state variables for easier access
	const { plotMode, selectedRow, maxDisplayRows, isProcessing, error } = widgetState;

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
	const effectivePlots = isPopout ? (syncedPlots || plots) : plots;

	// Find the most recent plot with DDA results (Q matrix)
	const plotWithDDA = Object.entries(effectivePlots || {}).find(([filePath, plotState]) => {
		const state = plotState as PlotState;
		return state && state.ddaResults && state.ddaResults.Q &&
			Array.isArray(state.ddaResults.Q) && state.ddaResults.Q.length > 0;
	});

	const [filePath, rawPlotState] = plotWithDDA || [null, null];
	const plotState = rawPlotState as PlotState | null;
	const ddaResults = plotState?.ddaResults;
	const Q = ddaResults?.Q;
	const hasData = Q && Array.isArray(Q) && Q.length > 0;

	// Process Q matrix into line chart data
	const chartData = useMemo(() => {
		if (!Q || !Array.isArray(Q) || Q.length === 0) {
			return [];
		}

		const numCols = Q[0]?.length || 0;
		if (numCols === 0) return [];

		const data: any[] = [];

		for (let col = 0; col < numCols; col++) {
			const point: any = { x: col };

			if (plotMode === "average") {
				// Calculate average across all rows for this column
				const values = Q.map(row => row[col]).filter(val => typeof val === "number" && !isNaN(val));
				if (values.length > 0) {
					point.average = values.reduce((sum, val) => sum + val, 0) / values.length;
				}
			} else if (plotMode === "individual") {
				// Show selected row only
				if (selectedRow < Q.length && typeof Q[selectedRow][col] === "number") {
					point[`row_${selectedRow}`] = Q[selectedRow][col];
				}
			} else if (plotMode === "all") {
				// Show multiple rows (limited by maxDisplayRows)
				const rowsToShow = Math.min(maxDisplayRows, Q.length);
				for (let row = 0; row < rowsToShow; row++) {
					if (typeof Q[row][col] === "number" && !isNaN(Q[row][col])) {
						point[`row_${row}`] = Q[row][col];
					}
				}
			}

			data.push(point);
		}

		return data;
	}, [Q, plotMode, selectedRow, maxDisplayRows]);

	// Generate colors for lines
	const colors = [
		"#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
		"#06b6d4", "#84cc16", "#f97316", "#ec4899", "#6366f1"
	];

	const processQMatrix = async () => {
		if (!Q) return;

		const loadingId = `lineplot-widget-${Date.now()}`;
		setWidgetState(prev => ({ ...prev, isProcessing: true, error: null }));

		try {
			loadingManager.startDDAProcessing(
				loadingId,
				`Processing ${Q.length}×${Q[0]?.length || 0} DDA line plot...`
			);

			// Simulate processing time for visibility
			await new Promise(resolve => setTimeout(resolve, 800));

			loadingManager.updateProgress(loadingId, 100, "Line plot generated successfully!");
			setTimeout(() => loadingManager.stop(loadingId), 500);
		} catch (err) {
			loadingManager.stop(loadingId);
			setWidgetState(prev => ({
				...prev,
				error: err instanceof Error ? err.message : "Failed to process line plot"
			}));
		} finally {
			setWidgetState(prev => ({ ...prev, isProcessing: false }));
		}
	};

	useEffect(() => {
		if (hasData && Q) {
			processQMatrix();
		}
	}, [Q, hasData]);

	const handleRefresh = () => {
		if (hasData && Q) {
			processQMatrix();
		}
	};

	const increaseRows = () => {
		if (Q) {
			setWidgetState(prev => ({
				...prev,
				maxDisplayRows: Math.min(prev.maxDisplayRows + 1, Q.length)
			}));
		}
	};

	const decreaseRows = () => {
		setWidgetState(prev => ({
			...prev,
			maxDisplayRows: Math.max(prev.maxDisplayRows - 1, 1)
		}));
	};

	if (!hasData) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-sm">
						<TrendingUp className="h-4 w-4" />
						DDA Line Plot
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 flex items-center justify-center">
					<div className="text-center text-muted-foreground">
						<TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
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
						<TrendingUp className="h-4 w-4" />
						DDA Line Plot
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-1 flex flex-col items-center justify-center">
					<div className="text-center text-destructive">
						<p className="text-sm">Error processing line plot</p>
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
						<TrendingUp className="h-4 w-4" />
						DDA Line Plot
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

				{/* Controls */}
				<div className="flex items-center gap-2 pt-2">
					<Select value={plotMode} onValueChange={(value: any) =>
						setWidgetState(prev => ({ ...prev, plotMode: value }))
					}>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="average">Average</SelectItem>
							<SelectItem value="individual">Single Row</SelectItem>
							<SelectItem value="all">Multiple Rows</SelectItem>
						</SelectContent>
					</Select>

					{plotMode === "individual" && Q && (
						<Select value={selectedRow.toString()} onValueChange={(value) =>
							setWidgetState(prev => ({ ...prev, selectedRow: parseInt(value) }))
						}>
							<SelectTrigger className="w-20">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.from({ length: Q.length }, (_, i) => (
									<SelectItem key={i} value={i.toString()}>
										{i}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}

					{plotMode === "all" && Q && (
						<div className="flex items-center gap-1">
							<Button variant="outline" size="sm" onClick={decreaseRows} disabled={maxDisplayRows <= 1}>
								<Minus className="h-3 w-3" />
							</Button>
							<span className="text-xs px-2">{maxDisplayRows}</span>
							<Button variant="outline" size="sm" onClick={increaseRows} disabled={maxDisplayRows >= Q.length}>
								<Plus className="h-3 w-3" />
							</Button>
						</div>
					)}
				</div>
			</CardHeader>

			<CardContent className="flex-1 p-2 relative overflow-hidden">
				{isProcessing && (
					<LoadingOverlay
						show={true}
						message="Processing DDA Line Plot..."
						type="dda-processing"
						variant="modal"
						size="lg"
					/>
				)}

				{!isProcessing && chartData.length > 0 && (
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={chartData}>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="x" />
							<YAxis />
							<Tooltip />
							<Legend />

							{plotMode === "average" && (
								<Line
									type="monotone"
									dataKey="average"
									stroke={colors[0]}
									strokeWidth={2}
									dot={false}
									name="Average"
								/>
							)}

							{plotMode === "individual" && (
								<Line
									type="monotone"
									dataKey={`row_${selectedRow}`}
									stroke={colors[0]}
									strokeWidth={2}
									dot={false}
									name={`Row ${selectedRow}`}
								/>
							)}

							{plotMode === "all" && Array.from({ length: Math.min(maxDisplayRows, Q?.length || 0) }, (_, i) => (
								<Line
									key={i}
									type="monotone"
									dataKey={`row_${i}`}
									stroke={colors[i % colors.length]}
									strokeWidth={1.5}
									dot={false}
									name={`Row ${i}`}
								/>
							))}
						</LineChart>
					</ResponsiveContainer>
				)}

				{!isProcessing && chartData.length === 0 && (
					<div className="flex items-center justify-center h-full text-muted-foreground">
						<div className="text-center">
							<TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
							<p className="text-sm">No plot data available</p>
						</div>
					</div>
				)}
			</CardContent>

			{/* Info overlay */}
			{filePath && !isProcessing && (
				<div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded-md p-2 text-xs">
					<div className="font-medium">{filePath.split('/').pop()}</div>
					<div className="text-muted-foreground">
						{chartData.length} data points
					</div>
				</div>
			)}
		</Card>
	);
}
