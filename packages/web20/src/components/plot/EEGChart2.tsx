"use client";

import React, { useRef, useCallback, useEffect, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// Types inlined to avoid cross-package import friction
export interface EEGData {
	channels: string[];
	samplesPerChannel: number;
	sampleRate: number;
	data: number[][];
	startTime: string;
	duration: number;
	absoluteStartTime?: number;
	annotations?: any[];
	totalSamples?: number;
	chunkSize?: number;
	chunkStart?: number;
}

interface EEGChartProps {
	eegData: EEGData;
	selectedChannels: string[];
	timeWindow: [number, number];
	absoluteTimeWindow?: [number, number];
	zoomLevel: number;
	customZoomFactor?: number;
	onTimeWindowChange: (window: [number, number]) => void;
	className?: string;
	height?: string | number;
}

const DEFAULT_HEIGHT = "360px";
const Y_AXIS_WIDTH = 110;

const CHANNEL_COLORS = [
	"#f43f5e",
	"#8b5cf6",
	"#3b82f6",
	"#10b981",
	"#f59e0b",
	"#ec4899",
	"#06b6d4",
	"#84cc16",
	"#6366f1",
	"#ef4444",
	"#14b8a6",
	"#f97316",
];

function stackEegData(
	eegData: EEGData,
	selectedChannels: string[]
): { plotData: number[][]; plotChannels: string[] } {
	if (!eegData || !eegData.data || !eegData.channels || eegData.data.length === 0) {
		return { plotData: [[]], plotChannels: [] };
	}

	const { data, channels, sampleRate, samplesPerChannel } = eegData;
	const numPoints = samplesPerChannel || data[0]?.length || 0;
	if (numPoints === 0) return { plotData: [[]], plotChannels: [] };

	const timestamps = new Array(numPoints);
	const timeIncrement = 1 / Math.max(1, sampleRate);
	const chunkStartSamples = typeof eegData.chunkStart === "number" ? eegData.chunkStart : 0;
	const xOffsetSeconds = chunkStartSamples / Math.max(1, sampleRate);
	for (let i = 0; i < numPoints; i++) timestamps[i] = xOffsetSeconds + i * timeIncrement;

	const channelMap = new Map(channels.map((name: string, i: number) => [name, data[i]]));
	const channelsToRender = selectedChannels.length > 0 ? selectedChannels : channels;

	const filteredData = channelsToRender
		.map((name: string) => channelMap.get(name))
		.filter((c: number[] | undefined) => c !== undefined) as number[][];

	const plotChannels = channelsToRender.filter((name: string) => channelMap.has(name));

	// Normalize each channel to a visible dynamic range and use constant separation
	const separation = 60; // constant vertical spacing between channels
	const amplitude = 40; // target half-range for each normalized channel

	const plotData = [timestamps];
	for (let i = 0; i < filteredData.length; i++) {
		const arr = filteredData[i];
		if (!arr || arr.length === 0) {
			plotData.push(new Array(numPoints).fill(-i * separation));
			continue;
		}
		let min = arr[0], max = arr[0];
		for (let j = 1; j < arr.length; j++) { if (arr[j] < min) min = arr[j]; if (arr[j] > max) max = arr[j]; }
		const mid = (min + max) / 2;
		const range = Math.max(1e-6, max - min);

		const scaled = new Array(numPoints);
		for (let j = 0; j < numPoints; j++) {
			const centered = arr[j] - mid;
			const normalized = (centered / (range / 2)) * amplitude; // map to roughly [-amplitude, amplitude]
			scaled[j] = normalized - i * separation;
		}
		plotData.push(scaled);
	}
	return { plotData, plotChannels };
}

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
}: EEGChartProps) {
	const chartRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const uplotInstance = useRef<uPlot | null>(null);
	const resizeObserver = useRef<ResizeObserver | null>(null);
	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

	const updateContainerSize = useCallback(() => {
		if (containerRef.current) {
			const el = containerRef.current as HTMLDivElement;
			const rect = el.getBoundingClientRect();
			const width = rect.width || el.clientWidth || el.offsetWidth || 0;
			const height = rect.height || el.clientHeight || el.offsetHeight || 0;
			setContainerSize({ width, height });
		}
	}, []);

	useEffect(() => {
		if (!containerRef.current) return;
		resizeObserver.current = new ResizeObserver(updateContainerSize);
		resizeObserver.current.observe(containerRef.current);
		updateContainerSize();
		return () => {
			resizeObserver.current?.disconnect();
		};
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
		// Keep in sync with stackEegData separation for label placement
		const separation = 60;
		if (plotData.length <= 1 || plotData[0].length === 0) {
			if (uplotInstance.current) {
				uplotInstance.current.destroy();
				uplotInstance.current = null;
			}
			return;
		}

		const opts = {
			width: Math.max(320, containerSize.width),
			height: Math.max(220, containerSize.height),
			padding: [15, 0, 0, 0],
			scales: { x: { time: false }, y: { show: true } },
			axes: [
				{ label: "Time (seconds)", stroke: "#555", grid: { stroke: "#e0e0e0", width: 1 } },
				{
					show: true,
					side: 3,
					stroke: "#555",
					size: Y_AXIS_WIDTH,
					grid: { show: false },
					// Place a label for each stacked channel at its baseline (-i * separation)
					splits: (_u: any, _axisIdx: number, _min: number, _max: number, _incr: number) => {
						return plotChannels.map((_, i) => -i * separation);
					},
					values: (_u: any, _splits: number[]) => {
						return plotChannels.map((name) => name);
					},
				},
			],
			series: [
				{ label: "Time" },
				...plotChannels.map((name, i) => ({ label: name, stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length], width: 1 / window.devicePixelRatio, points: { show: false } })),
			],
			cursor: { drag: { x: true, y: true, setScale: true } },
		} as any;

		if (uplotInstance.current) uplotInstance.current.destroy();
		if (chartRef.current) uplotInstance.current = new uPlot(opts, plotData as any, chartRef.current);
	}, [eegData, selectedChannels, containerSize]);

	useEffect(() => { generatePlot(); }, [generatePlot]);
	useEffect(() => () => { uplotInstance.current?.destroy(); resizeObserver.current?.disconnect(); }, []);

	return (
		<div ref={containerRef} className={`h-full w-full ${className || ''}`} style={{ height, minHeight: 240 }}>
			<div ref={chartRef} className="w-full h-full" />
		</div>
	);
}


