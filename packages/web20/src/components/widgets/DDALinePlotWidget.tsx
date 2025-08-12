"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { TrendingUp, Download, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface DDALinePlotWidgetProps {
	widgetId?: string;
	isPopout?: boolean;
}

interface DataPoint {
	x: number;
	y: number;
}

export function DDALinePlotWidget({ widgetId = "dda-line-plot-widget", isPopout = false }: DDALinePlotWidgetProps) {
	const [Q, setQ] = useState<number[][]>([]);
	const [lineType, setLineType] = useState<'linear' | 'step'>('linear');
	const [zoomLevel, setZoomLevel] = useState(1);
	const [isLoading, setIsLoading] = useState(false);
	const [normalize, setNormalize] = useState<boolean>(true);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const uplotRef = useRef<uPlot | null>(null);

	// Listen to global DDA results
	useEffect(() => {
		const onResults = (e: Event) => {
			const detail = (e as CustomEvent).detail as { Q?: (number | null)[][] };
			if (Array.isArray(detail?.Q) && detail.Q.length > 0) {
				// sanitize nulls to 0
				const cleaned = detail.Q.map(row => row.map(v => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v))));
				setQ(cleaned);
			}
		};
		window.addEventListener('dda:results', onResults as EventListener);
		return () => window.removeEventListener('dda:results', onResults as EventListener);
	}, []);

	const handleRefresh = async () => {
		setIsLoading(true);
		await new Promise(resolve => setTimeout(resolve, 300));
		setIsLoading(false);
	};

	const handleZoom = (direction: 'in' | 'out') => {
		setZoomLevel(prev => {
			const newZoom = direction === 'in' ? prev * 1.2 : prev / 1.2;
			return Math.max(0.5, Math.min(3, newZoom));
		});
	};

	// Build uPlot data: longest dimension is time (x), columns are series
	const { uplotData, series } = useMemo(() => {
		if (!Q || Q.length === 0) return { uplotData: null as any, series: [] as any[] };
		const rows = Q.length;
		const cols = Q[0]?.length || 0;
		if (cols === 0) return { uplotData: null as any, series: [] as any[] };
		const timeLen = Math.max(rows, cols);
		const isTimeRows = rows >= cols;

		// x axis is [0..timeLen-1]
		const x = Array.from({ length: timeLen }, (_, i) => i);
		const seriesData: number[][] = [];
		const numSeries = isTimeRows ? cols : rows;

		for (let s = 0; s < numSeries; s++) {
			const arr = new Array(timeLen).fill(0);
			if (isTimeRows) {
				for (let t = 0; t < timeLen; t++) arr[t] = Number(Q[t][s] ?? 0);
			} else {
				for (let t = 0; t < timeLen; t++) arr[t] = Number(Q[s][t] ?? 0);
			}
			if (normalize) {
				let min = Infinity, max = -Infinity;
				for (let t = 0; t < timeLen; t++) {
					const v = arr[t];
					if (v < min) min = v;
					if (v > max) max = v;
				}
				const denom = max - min || 1;
				for (let t = 0; t < timeLen; t++) arr[t] = (arr[t] - min) / denom;
			}
			seriesData.push(arr);
		}
		const uData = [x, ...seriesData];
		const COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
		const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
		const s = [{ label: 't' }, ...Array.from({ length: numSeries }, (_, i) => ({ label: `Q${i + 1}`, stroke: COLORS[i % COLORS.length], points: { show: false }, width: Math.max(1, 1 / dpr) }))];
		return { uplotData: uData, series: s };
	}, [Q, normalize]);

	// Create/destroy uPlot and recreate if series length changes
	useEffect(() => {
		if (!containerRef.current) return;
		if (!uplotData) {
			uplotRef.current?.destroy();
			uplotRef.current = null;
			return;
		}
		const currentSeriesLen = uplotRef.current ? (uplotRef.current as any).series?.length ?? 0 : 0;
		const desiredSeriesLen = series.length;
		const needsRecreate = !uplotRef.current || currentSeriesLen !== desiredSeriesLen;
		if (needsRecreate) {
			uplotRef.current?.destroy();
			const opts: uPlot.Options = {
				width: Math.max(320, containerRef.current.clientWidth || 400),
				height: 300,
				scales: { x: { time: false } },
				axes: [
					{ label: 't' },
					{ label: 'Q' },
				],
				series,
			} as any;
			uplotRef.current = new uPlot(opts, uplotData, containerRef.current);
		} else {
			uplotRef.current?.setData(uplotData as any);
		}
	}, [uplotData, series]);

	const getStats = () => {
		if (!Q || Q.length === 0) return { min: 0, max: 0, avg: 0 };
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		let sum = 0;
		let count = 0;
		for (let i = 0; i < Q.length; i++) {
			const row = Q[i];
			for (let j = 0; j < row.length; j++) {
				const v = row[j];
				if (v < min) min = v;
				if (v > max) max = v;
				sum += v;
				count++;
			}
		}
		const avg = count > 0 ? sum / count : 0;
		if (!Number.isFinite(min)) min = 0;
		if (!Number.isFinite(max)) max = 0;
		if (!Number.isFinite(avg)) return { min, max, avg: 0 };
		return { min, max, avg };
	};

	const stats = getStats();

	return (
		<div className="flex flex-col h-full p-4 space-y-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<TrendingUp className="h-4 w-4" />
						DDA Line Plot
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="flex items-center gap-4">
						<div className="flex-1">
							<Select value={lineType} onValueChange={(value: any) => setLineType(value)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="linear">Linear</SelectItem>
									<SelectItem value="step">Step</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="flex items-center gap-2">
							<Button
								onClick={() => handleZoom('out')}
								size="sm"
								variant="outline"
								disabled={zoomLevel <= 0.5}
							>
								<ZoomOut className="h-4 w-4" />
							</Button>

							<span className="text-xs text-muted-foreground min-w-[3rem] text-center">
								{Math.round(zoomLevel * 100)}%
							</span>

							<Button
								onClick={() => handleZoom('in')}
								size="sm"
								variant="outline"
								disabled={zoomLevel >= 3}
							>
								<ZoomIn className="h-4 w-4" />
							</Button>
						</div>

						<div className="flex items-center gap-2">
							<input id="normalize" type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
							<label htmlFor="normalize" className="text-xs text-muted-foreground">Normalize per series</label>
						</div>

						<Button
							onClick={handleRefresh}
							disabled={isLoading}
							size="sm"
							variant="outline"
						>
							{isLoading ? (
								<>
									<RefreshCw className="h-4 w-4 mr-2 animate-spin" />
									Refreshing...
								</>
							) : (
								<>
									<RefreshCw className="h-4 w-4 mr-2" />
									Refresh
								</>
							)}
						</Button>

						<Button size="sm" variant="outline">
							<Download className="h-4 w-4" />
						</Button>
					</div>

					<div className="flex items-center justify-center p-2 bg-muted/20 rounded-lg">
						<div ref={containerRef} className="w-full" style={{ minHeight: 320 }} />
					</div>

					<div className="grid grid-cols-3 gap-4 text-xs">
						<div className="text-center">
							<div className="font-medium">Min</div>
							<div className="text-muted-foreground">{stats.min.toFixed(3)}</div>
						</div>
						<div className="text-center">
							<div className="font-medium">Max</div>
							<div className="text-muted-foreground">{stats.max.toFixed(3)}</div>
						</div>
						<div className="text-center">
							<div className="font-medium">Avg</div>
							<div className="text-muted-foreground">{stats.avg.toFixed(3)}</div>
						</div>
					</div>

					<div className="text-xs text-muted-foreground">
						{Q?.length || 0}×{Q?.[0]?.length || 0} • {lineType} • {Math.round(zoomLevel * 100)}% zoom
					</div>
				</CardContent>
			</Card>
		</div>
	);
} 