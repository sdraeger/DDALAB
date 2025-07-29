"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "../../../store";
import { TrendingUp, Settings, RotateCcw, Plus, Minus } from "lucide-react";
import { Button } from "../../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Badge } from "../../ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { LoadingOverlay } from "../../ui/loading-overlay";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { PlotState } from "../../../store/slices/plotSlice";
import { isEqual } from 'lodash';
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useCurrentEdfFile } from "../../../hooks/useCurrentEdfFile";

interface DDALinePlotWidgetProps {
	widgetId?: string;
	isPopout?: boolean;
}

interface DDALinePlotState {
	plotMode: "all" | "average" | "individual";
	selectedRow: number;
	maxDisplayRows: number;
}

export function DDALinePlotWidget({
	widgetId = 'dda-lineplot-widget-default',
	isPopout = false
}: DDALinePlotWidgetProps = {}) {
	console.log('[DDALinePlotWidget] Component rendered');

	const {
		currentFilePath,
		currentPlotState,
		currentEdfData,
		currentChunkMetadata,
		selectFile,
		selectChannels,
	} = useCurrentEdfFile();

	const loadingManager = useLoadingManager();
	const workerRef = useRef<Worker | null>(null);
	const chartRef = useRef<HTMLDivElement | null>(null);
	const uplotInstance = useRef<uPlot | null>(null);
	const lastProcessedQRef = useRef<any>(null);

	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Synchronized widget state
	const { state: widgetState, updateState: setWidgetState } = useWidgetState<DDALinePlotState>(
		widgetId,
		{
			plotMode: "average",
			selectedRow: 0,
			maxDisplayRows: 5,
		},
		isPopout
	);
	const { plotMode, selectedRow, maxDisplayRows } = widgetState;

	// Use currentPlotState only if it exists and has the required properties
	const plotWithDDA = currentPlotState && currentPlotState.ddaResults && currentPlotState.ddaResults.Q && Array.isArray(currentPlotState.ddaResults.Q) && currentPlotState.ddaResults.Q.length > 0 ? currentPlotState : null;
	const Q = plotWithDDA?.ddaResults?.Q;
	const hasData = Q && Array.isArray(Q) && Q.length > 0;

	console.log('[DDALinePlotWidget] DDA data check:', {
		currentFilePath,
		currentPlotState: !!currentPlotState,
		hasDdaResults: !!currentPlotState?.ddaResults,
		ddaResultsQ: currentPlotState?.ddaResults?.Q,
		plotWithDDA: !!plotWithDDA,
		Q: Q,
		hasData: hasData,
		QLength: Q?.length,
		QFirstRowLength: Q?.[0]?.length,
		// Check if file paths match
		storedFilePath: currentPlotState?.ddaResults?.file_path,
		pathMatch: currentFilePath === currentPlotState?.ddaResults?.file_path,
	});
	const hasPlottableData = useMemo(() => {
		if (!hasData || !Q) return false;
		return Q.some(row => row.some(val => val !== null));
	}, [Q, hasData]);

	// Prepare data for uPlot
	const getUPlotData = () => {
		if (!Q || !hasPlottableData) return null;
		const length = Q[0].length;
		const x = Array.from({ length }, (_, i) => i);
		let ySeries: number[][] = [];
		if (plotMode === "all") {
			ySeries = Q.slice(0, maxDisplayRows).map(row => row.map(val => val == null ? NaN : val));
		} else if (plotMode === "average") {
			const avg = Q[0].map((_, colIdx) => {
				let sum = 0;
				let count = 0;
				for (let row = 0; row < Q.length; row++) {
					const val = Q[row][colIdx];
					if (val !== null && val !== undefined) {
						sum += val;
						count++;
					}
				}
				return count > 0 ? sum / count : NaN;
			});
			ySeries = [avg];
		} else if (plotMode === "individual") {
			ySeries = [Q[selectedRow].map(val => val == null ? NaN : val)];
		}
		return [x, ...ySeries];
	};

	// uPlot options
	const getUPlotOpts = (seriesCount: number) => ({
		width: 800,
		height: 300,
		scales: { x: { time: false } },
		axes: [
			{ label: "Time Step", stroke: "#555" },
			{ label: "Q Value", stroke: "#555" },
		],
		series: [
			{ label: "Time" },
			...Array.from({ length: seriesCount }, (_, i) => ({
				label: plotMode === "all" ? `Channel ${i + 1}` : plotMode === "average" ? "Average" : `Channel ${selectedRow + 1}`,
				stroke: `hsl(${(i * 60) % 360}, 70%, 50%)`,
				width: 2,
				points: { show: false },
			})),
		],
	});

	// Render uPlot
	useEffect(() => {
		if (!hasPlottableData || !Q) {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
				uplotInstance.current = null;
			}
			return;
		}
		const data = getUPlotData();
		if (!data) return;
		const opts = getUPlotOpts(data.length - 1);
		if (uplotInstance.current) {
			uplotInstance.current.destroy();
		}
		uplotInstance.current = new uPlot(opts as any, data as any, chartRef.current!);
		return () => {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
				uplotInstance.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [Q, plotMode, maxDisplayRows, selectedRow, hasPlottableData]);

	const handleRefresh = () => {
		lastProcessedQRef.current = null;
		setError(null);
	};

	const increaseRows = () => {
		if (Q) {
			setWidgetState((prev: DDALinePlotState) => ({
				...prev,
				maxDisplayRows: Math.min(prev.maxDisplayRows + 1, Q.length)
			}));
		}
	};

	const decreaseRows = () => {
		setWidgetState((prev: DDALinePlotState) => ({
			...prev,
			maxDisplayRows: Math.max(prev.maxDisplayRows - 1, 1)
		}));
	};

	if ((!hasData || !hasPlottableData) && !isProcessing) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<TrendingUp className="h-5 w-5" />
							<span>DDA Line Plot</span>
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent className="flex-grow flex items-center justify-center">
					<div className="text-center text-muted-foreground">
						<p>No plottable DDA data available.</p>
						<p className="text-xs">
							{hasData && !hasPlottableData
								? "The analysis completed, but resulted in no valid data points."
								: "Run DDA to see results."}
						</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-full flex flex-col">
			<LoadingOverlay show={isProcessing} message="Processing DDA data..." />
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<TrendingUp className="h-5 w-5" />
						<span>DDA Line Plot</span>
					</div>
					<Button variant="ghost" size="sm" onClick={handleRefresh}>
						<RotateCcw className="h-4 w-4" />
					</Button>
				</CardTitle>
				<div className="text-xs text-muted-foreground">
					{Q ? `Matrix: ${Q.length}  ${Q[0]?.length || 0}` : 'No data'}
				</div>
			</CardHeader>
			<CardContent className="flex-grow flex flex-col">
				{error && (
					<div className="text-red-500 text-sm p-4 bg-red-500/10 rounded-md">
						<strong>Error:</strong> {error}
					</div>
				)}
				<div className="flex-grow min-h-0">
					<div ref={chartRef} style={{ width: "100%", height: 300 }} />
				</div>
				<div className="flex items-center justify-between pt-2">
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">Mode</span>
						<Select
							value={plotMode}
							onValueChange={(value) =>
								setWidgetState((prev: DDALinePlotState) => ({ ...prev, plotMode: value as any }))
							}
						>
							<SelectTrigger className="h-8 w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All Channels</SelectItem>
								<SelectItem value="average">Average</SelectItem>
								<SelectItem value="individual">Individual</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{plotMode === "all" && (
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Channels</span>
							<Button variant="outline" size="icon" className="h-8 w-8" onClick={decreaseRows}>
								<Minus className="h-4 w-4" />
							</Button>
							<Badge variant="secondary" className="h-8 text-sm">{maxDisplayRows}</Badge>
							<Button variant="outline" size="icon" className="h-8 w-8" onClick={increaseRows}>
								<Plus className="h-4 w-4" />
							</Button>
						</div>
					)}

					{plotMode === "individual" && (
						<div className="flex items-center gap-2">
							<span className="text-xs text-muted-foreground">Channel</span>
							<Select
								value={String(selectedRow)}
								onValueChange={(value) =>
									setWidgetState((prev: DDALinePlotState) => ({ ...prev, selectedRow: parseInt(value, 10) }))
								}
							>
								<SelectTrigger className="h-8 w-40">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Q?.map((_, index) => (
										<SelectItem key={index} value={String(index)}>
											Channel {index + 1}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
