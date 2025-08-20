"use client";

import React, { useRef, useCallback, useEffect, useState } from "react";
import uPlotModule from "uplot";
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
				...plotChannels.map((name, i) => ({ 
					label: name, 
					stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length], 
					width: 1 / (typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1), 
					points: { show: false } 
				})),
			],
			cursor: { drag: { x: true, y: true, setScale: true } },
		} as any;

		if (uplotInstance.current) uplotInstance.current.destroy();
		if (chartRef.current) {
			// Get the appropriate uPlot constructor based on context
			let uPlotConstructor = uPlotModule;
			
			// Force different behavior for popup windows
			const isPopupWindow = typeof window !== 'undefined' && !!window.opener;
			console.log('[EEGChart2] Window context debug:', {
				windowExists: typeof window !== 'undefined',
				hasOpener: typeof window !== 'undefined' ? !!window.opener : 'no window',
				openerValue: typeof window !== 'undefined' ? window.opener : 'no window',
				isPopupWindow: isPopupWindow
			});
			
			if (isPopupWindow) {
				console.log('[EEGChart2] Popup window detected - FORCING module version to avoid CDN conflicts');
				// ALWAYS use the imported module version in popup windows to avoid version conflicts
				uPlotConstructor = uPlotModule;
				console.log('[EEGChart2] Using imported uPlot module in popup window');
			} else {
				console.log('[EEGChart2] Main window detected, using standard uPlot');
			}
			
			// Final validation
			if (typeof uPlotConstructor !== 'function') {
				console.error('[EEGChart2] uPlot constructor is not a function:', typeof uPlotConstructor);
				return;
			}
			
			try {
				// Debug the parameters before creating uPlot
				console.log('[EEGChart2] Creating uPlot with:', {
					constructor: uPlotConstructor.name,
					optsType: typeof opts,
					plotDataType: typeof plotData,
					plotDataLength: Array.isArray(plotData) ? plotData.length : 'not array',
					plotDataFirstItem: plotData && plotData[0] ? typeof plotData[0] : 'no first item',
					target: !!chartRef.current
				});
				
				// Debug the plotData structure in detail
				console.log('[EEGChart2] plotData structure:', {
					isArray: Array.isArray(plotData),
					length: plotData.length,
					firstSeriesLength: plotData[0] ? plotData[0].length : 'no first series',
					firstSeriesType: plotData[0] ? plotData[0].constructor.name : 'no first series',
					firstFewValues: plotData[0] ? plotData[0].slice(0, 3) : 'no values',
					allSeriesTypes: plotData.map((series, i) => `[${i}]: ${series ? series.constructor.name : 'null'}`).join(', ')
				});
				
				// Debug the options object structure
				console.log('[EEGChart2] opts structure:', {
					keys: Object.keys(opts),
					width: opts.width,
					height: opts.height,
					seriesCount: opts.series?.length,
					scalesKeys: opts.scales ? Object.keys(opts.scales) : 'no scales',
					axesCount: opts.axes?.length,
					hasHooks: !!opts.hooks,
					cursorType: typeof opts.cursor
				});
				
				// Ensure plotData is a proper array
				if (!Array.isArray(plotData) || plotData.length === 0) {
					console.warn('[EEGChart2] Invalid plotData, skipping uPlot creation');
					return;
				}
				
				// Check if any data items are Promises or have unexpected properties
				for (let i = 0; i < plotData.length; i++) {
					if (plotData[i] && typeof (plotData[i] as any).then === 'function') {
						console.error('[EEGChart2] Found Promise in plotData at index', i, plotData[i]);
						return;
					}
					// Check for other unexpected properties that might have 'then'
					if (plotData[i] && (plotData[i] as any).then !== undefined) {
						console.error('[EEGChart2] Found unexpected "then" property in plotData at index', i, 'value:', (plotData[i] as any).then);
						return;
					}
				}
				
				// Deep check the options object for any unexpected 'then' properties
				const checkForThenProperty = (obj: any, path = '') => {
					if (obj && typeof obj === 'object') {
						for (const key in obj) {
							if (obj.hasOwnProperty(key)) {
								const value = obj[key];
								const currentPath = path ? `${path}.${key}` : key;
								
								if (key === 'then' && typeof value === 'function') {
									console.error('[EEGChart2] Found "then" function in opts at', currentPath, value);
									return true;
								}
								
								if (typeof value === 'object' && value !== null) {
									if (checkForThenProperty(value, currentPath)) {
										return true;
									}
								}
							}
						}
					}
					return false;
				};
				
				if (checkForThenProperty(opts)) {
					console.error('[EEGChart2] Found problematic "then" property in opts, aborting');
					return;
				}
				
				// Create a safe wrapper to handle any API differences
				const createUPlotSafely = () => {
					console.log('[EEGChart2] Creating uPlot - isPopupWindow:', isPopupWindow);
					
					// ALWAYS use simplified data to avoid issues (for both main and popup windows)
					console.log('[EEGChart2] Using simplified data/options for safety');
					
					// Create simplified data - convert all arrays to typed arrays for uPlot
					const simplifiedData = plotData.map((series, index) => {
						if (Array.isArray(series)) {
							console.log(`[EEGChart2] Processing series ${index}, length: ${series.length}`);
							// Convert to Float64Array and ensure all values are numbers
							const cleaned = new Float64Array(series.length);
							for (let i = 0; i < series.length; i++) {
								const val = series[i];
								const num = typeof val === 'number' ? val : 0;
								cleaned[i] = Number.isFinite(num) ? num : 0;
							}
							console.log(`[EEGChart2] Series ${index} cleaned, first few values:`, cleaned.slice(0, 3));
							return cleaned;
						}
						console.log(`[EEGChart2] Series ${index} is not an array:`, typeof series);
						return series;
					});
					
					// Create simplified options - remove ALL potentially problematic properties
					const simplifiedOpts = {
						width: Math.floor(opts.width),
						height: Math.floor(opts.height),
						padding: opts.padding,
						scales: opts.scales,
						axes: opts.axes,
						series: opts.series?.map((s: any) => ({
							label: s.label,
							stroke: s.stroke,
							width: typeof s.width === 'number' ? s.width : 1,
							points: s.points
						})),
						cursor: undefined, // Remove cursor to see if it's causing issues
						hooks: undefined,
						plugins: undefined
					};
					
					console.log('[EEGChart2] Simplified options:', {
						width: simplifiedOpts.width,
						height: simplifiedOpts.height,
						seriesCount: simplifiedOpts.series?.length
					});
					
					console.log('[EEGChart2] Using simplified constructor with module version');
					if (!chartRef.current) {
						console.error('[EEGChart2] Chart ref is null');
						return;
					}
					return new uPlotConstructor(simplifiedOpts, simplifiedData, chartRef.current);
				};
				
				try {
					const instance = createUPlotSafely();
					if (instance) {
						uplotInstance.current = instance;
						console.log('[EEGChart2] uPlot instance created successfully');
					} else {
						uplotInstance.current = null;
						console.error('[EEGChart2] Failed to create uPlot instance');
					}
				} catch (uplotError) {
					console.error('[EEGChart2] uPlot failed completely, creating fallback chart:', uplotError);
					
					// Create a functional Canvas-based chart
					const createCanvasChart = () => {
						if (!chartRef.current) return;
						
						const container = chartRef.current;
						container.innerHTML = '';
						
						const canvas = document.createElement('canvas');
						const width = Math.floor(opts.width);
						const height = Math.floor(opts.height);
						
						canvas.width = width;
						canvas.height = height;
						canvas.style.width = '100%';
						canvas.style.height = '100%';
						canvas.style.border = '1px solid #e0e0e0';
						canvas.style.borderRadius = '4px';
						
						const ctx = canvas.getContext('2d');
						if (!ctx) return;
						
						// Clear canvas
						ctx.fillStyle = '#ffffff';
						ctx.fillRect(0, 0, width, height);
						
						// Calculate plot area
						const padding = 60;
						const plotWidth = width - 2 * padding;
						const plotHeight = height - 2 * padding;
						
						if (plotData.length > 1 && plotData[0]?.length > 0) {
							// Draw axes
							ctx.strokeStyle = '#d0d0d0';
							ctx.lineWidth = 1;
							ctx.beginPath();
							// X axis
							ctx.moveTo(padding, height - padding);
							ctx.lineTo(width - padding, height - padding);
							// Y axis
							ctx.moveTo(padding, padding);
							ctx.lineTo(padding, height - padding);
							ctx.stroke();
							
							// Draw channel data
							const colors = CHANNEL_COLORS;
							const timeData = plotData[0];
							const channelData = plotData.slice(1);
							
							channelData.forEach((series, channelIndex) => {
								if (!Array.isArray(series) || series.length === 0) return;
								
								ctx.strokeStyle = colors[channelIndex % colors.length];
								ctx.lineWidth = 1;
								ctx.beginPath();
								
								// Calculate y-offset for stacked display
								const separation = plotHeight / Math.max(1, channelData.length);
								const baseY = padding + channelIndex * separation + separation / 2;
								const amplitude = separation * 0.3; // Scale factor for signal amplitude
								
								// Find min/max for normalization
								const validValues = series.filter(v => typeof v === 'number' && isFinite(v));
								if (validValues.length === 0) return;
								
								const min = Math.min(...validValues);
								const max = Math.max(...validValues);
								const range = Math.max(1e-6, max - min);
								
								// Draw the waveform
								series.forEach((value, i) => {
									if (typeof value !== 'number' || !isFinite(value)) return;
									
									const x = padding + (i / (series.length - 1)) * plotWidth;
									const normalizedValue = (value - min) / range - 0.5; // Center around 0
									const y = baseY + normalizedValue * amplitude;
									
									if (i === 0) {
										ctx.moveTo(x, y);
									} else {
										ctx.lineTo(x, y);
									}
								});
								
								ctx.stroke();
								
								// Draw channel label
								ctx.fillStyle = colors[channelIndex % colors.length];
								ctx.font = '12px Arial';
								ctx.textAlign = 'left';
								ctx.fillText(plotChannels[channelIndex] || `Ch${channelIndex + 1}`, 10, baseY + 5);
							});
							
							// Draw time labels
							ctx.fillStyle = '#666';
							ctx.font = '10px Arial';
							ctx.textAlign = 'center';
							const timeStart = timeData[0] || 0;
							const timeEnd = timeData[timeData.length - 1] || 1;
							ctx.fillText(timeStart.toFixed(2) + 's', padding, height - 10);
							ctx.fillText(timeEnd.toFixed(2) + 's', width - padding, height - 10);
							
						} else {
							// No data - show message
							ctx.fillStyle = '#666';
							ctx.font = '14px Arial';
							ctx.textAlign = 'center';
							ctx.fillText('EEG Chart - Canvas Renderer', width / 2, height / 2 - 20);
							ctx.font = '12px Arial';
							ctx.fillStyle = '#999';
							ctx.fillText(`${plotChannels.length} channels, ${plotData[0]?.length || 0} samples`, width / 2, height / 2 + 10);
						}
						
						container.appendChild(canvas);
						
						// Return a mock uPlot instance
						return {
							destroy: () => { if (container) container.innerHTML = ''; },
							setData: () => {},
							setSize: () => {},
							redraw: () => {}
						};
					};
					
					uplotInstance.current = createCanvasChart();
					console.log('[EEGChart2] Canvas chart created');
				}
			} catch (error) {
				console.error('[EEGChart2] Error creating uPlot instance:', error);
				console.log('[EEGChart2] Error details:', {
					message: error.message,
					stack: error.stack,
					uPlotConstructor: uPlotConstructor.toString().substring(0, 200)
				});
				// Don't throw - just log the error to prevent component crash
			}
		}
	}, [eegData, selectedChannels, containerSize]);

	useEffect(() => { generatePlot(); }, [generatePlot]);
	useEffect(() => () => { uplotInstance.current?.destroy(); resizeObserver.current?.disconnect(); }, []);

	return (
		<div ref={containerRef} className={`h-full w-full ${className || ''}`} style={{ height, minHeight: 240 }}>
			<div ref={chartRef} className="w-full h-full" />
		</div>
	);
}


