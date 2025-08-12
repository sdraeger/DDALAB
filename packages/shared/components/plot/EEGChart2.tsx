"use client";

import React, {
	useRef,
	useCallback,
	useEffect,
	useState,
} from "react";
import { EEGData } from "../../types/EEGData";
import { Annotation } from "../../types/annotation";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { CHANNEL_COLORS, stackEegData } from "../../lib/utils/eeg-utils";

interface EEGChartProps {
	// Core data props
	eegData: EEGData;
	selectedChannels: string[];

	// Time and zoom props
	timeWindow: [number, number];
	absoluteTimeWindow?: [number, number];
	zoomLevel: number;
	customZoomFactor?: number;
	onTimeWindowChange: (window: [number, number]) => void;

	// Styling props
	className?: string;
	height?: string | number;

	// Annotation props
	editMode?: boolean;
	onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
	onAnnotationDelete?: (id: number) => void;
	filePath?: string;
	annotations?: Annotation[];
	onAnnotationSelect?: (annotation: Annotation) => void;

	// Event handlers
	onChartClick?: (event: React.MouseEvent<HTMLCanvasElement>) => void;
}

const DEFAULT_HEIGHT = "400px";
const Y_AXIS_WIDTH = 80; // Space for the Y-axis labels

export function EEGChart2({
	eegData,
	selectedChannels,
	timeWindow,
	absoluteTimeWindow,
	zoomLevel,
	customZoomFactor = 0.05,
	onTimeWindowChange,
	className,
	height = DEFAULT_HEIGHT,
	editMode = false,
	onAnnotationAdd,
	onAnnotationDelete,
	filePath,
	annotations = [],
	onAnnotationSelect,
	onChartClick,
}: EEGChartProps) {
	// Refs
	const chartRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const uplotInstance = useRef<uPlot | null>(null);
	const resizeObserver = useRef<ResizeObserver | null>(null);

	// State for container dimensions
	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

	// Calculate container dimensions
	const updateContainerSize = useCallback(() => {
		if (containerRef.current) {
			const rect = containerRef.current.getBoundingClientRect();
			setContainerSize({
				width: rect.width,
				height: rect.height,
			});
		}
	}, []);

	// Set up resize observer
	useEffect(() => {
		if (containerRef.current) {
			resizeObserver.current = new ResizeObserver(() => {
				updateContainerSize();
			});
			resizeObserver.current.observe(containerRef.current);
			updateContainerSize();

			return () => {
				if (resizeObserver.current) {
					resizeObserver.current.disconnect();
				}
			};
		}
	}, [updateContainerSize]);

	const generatePlot = useCallback(() => {
		if (!eegData || !eegData.data || containerSize.width === 0 || containerSize.height === 0) {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
				uplotInstance.current = null;
			}
			return;
		}

		const { plotData, plotChannels } = stackEegData(eegData, selectedChannels);

		if (plotData.length <= 1 || plotData[0].length === 0) {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
				uplotInstance.current = null;
			}
			return;
		}

		// Calculate the vertical center for each channel to use as a tick position
		const ySplits = plotData.slice(1).map(seriesData => {
			// Using average value as the position for the label
			return seriesData.reduce((a, b) => a + b, 0) / seriesData.length;
		});

		// Create a map of position -> label for easy lookup
		const yValueToLabel = new Map(ySplits.map((split, i) => [split, plotChannels[i]]));

		const opts = {
			width: containerSize.width,
			height: containerSize.height,
			padding: [15, 0, 0, 0], // uPlot will calculate padding based on axis size
			scales: {
				x: { time: false },
				y: { show: false }, // The scale still exists, but the axis is configured below
			},
			axes: [
				{
					// X-Axis
					label: "Time (seconds)",
					stroke: "#555",
					grid: { stroke: "#e0e0e0", width: 1 },
				},
				{
					// Y-Axis (for channel labels)
					show: true,
					side: 3, // 3 = left
					stroke: "#555",
					size: Y_AXIS_WIDTH, // Allocate space for the labels
					grid: { show: false }, // Disable horizontal grid lines from this axis

					// Tell uPlot WHERE to draw ticks
					splits: (u: uPlot) => ySplits,

					// Tell uPlot WHAT to label the ticks with
					values: (u: uPlot, splits: number[]) =>
						splits.map(split => yValueToLabel.get(split) || ""),
				},
			],
			series: [
				{ label: "Time" },
				...plotChannels.map((name, i) => ({
					label: name,
					stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
					width: 1 / window.devicePixelRatio,
					points: { show: false },
				})),
			],
			cursor: {
				drag: { x: true, y: true, setScale: true },
			},
		};

		if (uplotInstance.current) {
			uplotInstance.current.destroy();
		}

		if (chartRef.current) {
			uplotInstance.current = new uPlot(opts as any, plotData as any, chartRef.current);
		}
	}, [eegData, selectedChannels, containerSize]);

	const handleChartClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
		onChartClick?.(event);
	}, [onChartClick]);

	const calculateDisplayInfo = useCallback(() => {
		const numChannels = eegData?.channels?.length || 0;
		const numSelectedChannels = selectedChannels.length;
		const numPoints = eegData?.samplesPerChannel || 0;
		const totalPoints = numChannels * numPoints;
		const totalSelectedPoints = numSelectedChannels * numPoints;
		const samplingRate = eegData?.sampleRate || 0;
		const duration = eegData?.duration || 0;

		return { numChannels, numSelectedChannels, numPoints, totalPoints, totalSelectedPoints, samplingRate, duration };
	}, [eegData]);

	// Effects
	useEffect(() => {
		generatePlot();
	}, [generatePlot]);

	useEffect(() => {
		return () => {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
			}
			if (resizeObserver.current) {
				resizeObserver.current.disconnect();
			}
		};
	}, []);

	// Calculate display info from props
	const { numSelectedChannels, totalSelectedPoints, totalPoints, samplingRate, duration } = calculateDisplayInfo();

	return (
		<div
			ref={containerRef}
			className={`chart-container h-full w-full overflow-hidden ${className || ''}`}
			style={{ height }}
		>
			<div className="plot-info p-2 text-xs text-muted-foreground bg-muted/20 rounded-t">
				Plotting {numSelectedChannels.toLocaleString()} channels with {(samplingRate * duration).toLocaleString()} points each. <strong>Total points shown: {totalSelectedPoints.toLocaleString()} / {totalPoints.toLocaleString()}</strong>. Double-click to reset view.
			</div>
			<div ref={chartRef} className="w-full h-full" />
		</div>
	);
}
