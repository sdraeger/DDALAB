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
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ChartData } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useWidgetState } from "../../../hooks/useWidgetState";
import { useWidgetDataSync } from "../../../hooks/useWidgetDataSync";
import { PlotState } from "../../../store/slices/plotSlice";
import { isEqual } from 'lodash';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
	const plots = useAppSelector(state => state.plots);
	const loadingManager = useLoadingManager();
	const workerRef = useRef<Worker | null>(null);
	const chartRef = useRef<ChartJS<"line"> | null>(null);
	const lastProcessedQRef = useRef<any>(null);

	const [isProcessing, setIsProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [chartData, setChartData] = useState<ChartData<"line">>({
		labels: [],
		datasets: [],
	});

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

	// Find the most recent plot with DDA results (Q matrix)
	const plotWithDDA = useMemo(() => {
		return Object.values(plots as Record<string, PlotState>).find(
			(plotState) =>
				plotState &&
				plotState.ddaResults &&
				plotState.ddaResults.Q &&
				Array.isArray(plotState.ddaResults.Q) &&
				plotState.ddaResults.Q.length > 0
		);
	}, [plots]);

	const Q = plotWithDDA?.ddaResults?.Q;
	const hasData = Q && Array.isArray(Q) && Q.length > 0;
	const hasPlottableData = useMemo(() => {
		if (!hasData || !Q) return false;
		// Check if there is at least one non-null value in the entire matrix
		return Q.some(row => row.some(val => val !== null));
	}, [Q, hasData]);

	useEffect(() => {
		// Initialize worker
		workerRef.current = new Worker(
			new URL('../../../lib/workers/dda-line-plot.worker.ts', import.meta.url)
		);

		workerRef.current.onmessage = (event: MessageEvent) => {
			const { chartData: workerChartData, error: workerError } = event.data;
			setIsProcessing(false);
			if (workerError) {
				setError(workerError);
			} else if (workerChartData) {
				setChartData(workerChartData);
				// This direct update is often needed for react-chartjs-2
				if (chartRef.current) {
					chartRef.current.data = workerChartData;
					chartRef.current.update();
				}
			}
		};

		return () => {
			workerRef.current?.terminate();
			workerRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (hasData && workerRef.current) {
			const currentQ = Q;
			// Deep comparison to avoid reprocessing identical data
			if (!isEqual(currentQ, lastProcessedQRef.current)) {
				setIsProcessing(true);
				setError(null);
				workerRef.current.postMessage({
					Q: currentQ,
					plotMode,
					selectedRow,
					maxDisplayRows,
				});
				lastProcessedQRef.current = currentQ;
			}
		}
	}, [Q, hasData, plotMode, selectedRow, maxDisplayRows]);


	const handleRefresh = () => {
		lastProcessedQRef.current = null;
		if (hasData && workerRef.current) {
			setIsProcessing(true);
			setError(null);
			workerRef.current.postMessage({
				Q,
				plotMode,
				selectedRow,
				maxDisplayRows,
			});
			lastProcessedQRef.current = Q;
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
								: "Run a DDA analysis to see results."}
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
					{Q ? `Matrix: ${Q.length} × ${Q[0]?.length || 0}` : 'No data'}
				</div>
			</CardHeader>
			<CardContent className="flex-grow flex flex-col">
				{error && (
					<div className="text-red-500 text-sm p-4 bg-red-500/10 rounded-md">
						<strong>Error:</strong> {error}
					</div>
				)}
				<div className="flex-grow min-h-0">
					<Line ref={chartRef} data={chartData} options={{
						responsive: true,
						maintainAspectRatio: false,
						animation: false,
						scales: {
							x: {
								title: {
									display: true,
									text: "Time Step"
								}
							},
							y: {
								title: {
									display: true,
									text: "Value"
								}
							}
						},
						plugins: {
							legend: {
								position: 'top' as const,
							},
						}
					}} />
				</div>
				<div className="flex items-center justify-between pt-2">
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">Mode</span>
						<Select
							value={plotMode}
							onValueChange={(value) =>
								setWidgetState(prev => ({ ...prev, plotMode: value as any }))
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
									setWidgetState(prev => ({ ...prev, selectedRow: parseInt(value, 10) }))
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
