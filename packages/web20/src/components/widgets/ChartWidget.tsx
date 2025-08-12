import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { BarChart3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
// Use shared EEGChart2 uPlot-based chart
import { EEGChart2 } from '../plot/EEGChart2';
import { apiService } from '../../lib/api';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';

interface ChartWidgetProps {
	widgetId?: string;
	isPopout?: boolean;
}

interface DataPoint {
	x: number;
	y: number;
}

export function ChartWidget({ widgetId = "chart-widget", isPopout = false }: ChartWidgetProps) {
	const [data, setData] = useState<DataPoint[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const [dimensions, setDimensions] = useState({ width: 300, height: 200 });
	// EEGChart2 integration state
	const [eegData, setEegData] = useState<any | null>(null);
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
	const [timeWindow, setTimeWindow] = useState<[number, number]>([0, 2]);
	const [zoomLevel, setZoomLevel] = useState<number>(1);

	// Persist/restore across unmounts (minimize/maximize)
	const storageKey = useMemo(() => `dda:chart-widget:v1:${widgetId}`, [widgetId]);
	const restoredRef = useRef(false);
	const pendingFetchRef = useRef(false);

	// Preprocessing options (sent to backend)
	const [preproc, setPreproc] = useState<{
		lowpassFilter: boolean;
		highpassFilter: boolean;
		notchFilter: number | null;
		detrend: boolean;
		removeOutliers: boolean;
		smoothing: boolean;
		smoothingWindow: number;
		normalization: 'none' | 'minmax' | 'zscore';
	}>({
		lowpassFilter: false,
		highpassFilter: false,
		notchFilter: null,
		detrend: false,
		removeOutliers: false,
		smoothing: false,
		smoothingWindow: 3,
		normalization: 'none',
	});

	// EDF/Chunk context for navigation & info panel
	const [filePath, setFilePath] = useState<string | null>(null);
	const [channelLabels, setChannelLabels] = useState<string[]>([]);
	const [sampleRate, setSampleRate] = useState<number>(256);
	const [chunkStart, setChunkStart] = useState<number>(0);
	const [chunkSize, setChunkSize] = useState<number>(0);
	const [totalSamples, setTotalSamples] = useState<number>(0);

	// Listen for EDF data to demonstrate dashboard reaction
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent).detail as {
				filePath: string;
				metadata?: any;
				edfData?: { data?: any[][]; channel_labels?: string[] };
				selectedChannels?: string[];
			};
			if (!detail?.edfData?.data || !Array.isArray(detail.edfData.data)) return;
			// Ignore duplicate events with empty selection if we already set a selection
			if (selectedChannels.length > 0 && Array.isArray(detail.selectedChannels) && detail.selectedChannels.length === 0) {
				return;
			}

			const channelLabels = detail.edfData.channel_labels || detail.metadata?.channels || [];
			const selectedNames = detail.selectedChannels && detail.selectedChannels.length > 0 ? detail.selectedChannels : [];

			let seriesIndex = 0;
			if (selectedNames.length > 0 && channelLabels.length > 0) {
				const idx = channelLabels.findIndex((name: string) => name === selectedNames[0]);
				seriesIndex = idx >= 0 ? idx : 0;
			}

			const channelSeriesRaw = detail.edfData.data?.[seriesIndex] || [];
			const raw = Array.isArray(channelSeriesRaw) ? channelSeriesRaw.slice(0, 1000) : [];
			const cleaned = raw.map((v) => {
				const n = Number(v);
				return Number.isFinite(n) ? n : 0;
			});
			// Normalize data if range is too large/small
			const yMin = Math.min(...cleaned);
			const yMax = Math.max(...cleaned);
			const yRange = Math.max(1e-6, yMax - yMin);
			const normalized = cleaned.map((v) => (v - yMin));
			const newData: DataPoint[] = normalized.map((v: number, i: number) => ({ x: i, y: v }));

			setData(newData);
			// Build EEGData object for EEGChart2
			const sr = Number(detail.metadata?.sampling_rate || detail.metadata?.sample_rate || 256);
			const samplesPerChannel = Array.isArray(detail.edfData.data?.[0]) ? detail.edfData.data[0].length : normalized.length;
			const durationSec = samplesPerChannel / Math.max(1, sr);
			const builtEeg = {
				channels: channelLabels,
				sampleRate: sr,
				data: detail.edfData.data,
				startTime: new Date().toISOString(),
				duration: durationSec,
				samplesPerChannel,
				totalSamples: Number((detail as any).edfData?.total_samples || 0),
				chunkSize: Number((detail as any).edfData?.chunk_size || samplesPerChannel),
				chunkStart: Number((detail as any).edfData?.chunk_start || 0),
				absoluteStartTime: 0,
				annotations: [],
			};

			setEegData(builtEeg);
			// Store context for navigation/info
			setFilePath(detail.filePath || null);
			setChannelLabels(channelLabels);
			setSampleRate(sr);
			setChunkStart(builtEeg.chunkStart || 0);
			setChunkSize(builtEeg.chunkSize || samplesPerChannel);
			setTotalSamples(builtEeg.totalSamples || 0);
			// Selected channels default to provided or first 5
			setSelectedChannels(selectedNames.length > 0 ? selectedNames : channelLabels.slice(0, 5));
			setTimeWindow([0, Math.min(2, durationSec || 2)]);
			setZoomLevel(1);
			setIsLoading(false);
		};
		const onStart = () => setIsLoading(true);
		window.addEventListener('dda:edf-loaded', handler as EventListener);
		window.addEventListener('dda:loading-start', onStart as EventListener);
		return () => {
			window.removeEventListener('dda:edf-loaded', handler as EventListener);
			window.removeEventListener('dda:loading-start', onStart as EventListener);
		};
	}, [selectedChannels.length]);

	// Derived info for status panel
	const samplesPerChannel = useMemo(() => {
		return (
			(eegData?.samplesPerChannel as number | undefined) ??
			(eegData?.data?.[0]?.length as number | undefined) ??
			data.length
		);
	}, [eegData, data.length]);

	const totalChannels = useMemo(() => channelLabels.length || (eegData?.channels?.length ?? 0), [channelLabels.length, eegData?.channels?.length]);

	const totalChunks = useMemo(() => {
		if (!chunkSize || chunkSize <= 0 || !totalSamples || totalSamples <= 0) return 0;
		return Math.ceil(totalSamples / chunkSize);
	}, [totalSamples, chunkSize]);

	const currentChunkNumber = useMemo(() => {
		if (!chunkSize || chunkSize <= 0) return 1;
		return Math.floor(chunkStart / chunkSize) + 1;
	}, [chunkStart, chunkSize]);

	const pointsPlotted = useMemo(() => {
		return Math.max(0, samplesPerChannel) * Math.max(1, selectedChannels.length || 0);
	}, [samplesPerChannel, selectedChannels.length]);

	const chunkDurationSec = useMemo(() => {
		if (!chunkSize || !sampleRate) return 0;
		return chunkSize / Math.max(1, sampleRate);
	}, [chunkSize, sampleRate]);

	const basename = useMemo(() => (filePath ? filePath.split('/').pop() || filePath : '—'), [filePath]);

	// Chunk navigation (REST)
	const fetchChunk = useCallback(async (newChunkStart: number, opts?: { resetWindow?: boolean }) => {
		if (!filePath || !chunkSize) return;
		try {
			try { window.dispatchEvent(new CustomEvent('dda:loading-start')); } catch (_) { }
			const channelsParam = selectedChannels.length > 0 ? `&channels=${encodeURIComponent(selectedChannels.join(','))}` : '';
			const preprocessingPayload: any = {};
			if (preproc.lowpassFilter) preprocessingPayload.lowpassFilter = true;
			if (preproc.highpassFilter) preprocessingPayload.highpassFilter = true;
			if (typeof preproc.notchFilter === 'number' && preproc.notchFilter > 0) preprocessingPayload.notchFilter = preproc.notchFilter;
			if (preproc.detrend) preprocessingPayload.detrend = true;
			if (preproc.removeOutliers) preprocessingPayload.removeOutliers = true;
			if (preproc.smoothing) {
				preprocessingPayload.smoothing = true;
				preprocessingPayload.smoothingWindow = Math.max(3, Math.floor(preproc.smoothingWindow) || 3);
			}
			if (preproc.normalization && preproc.normalization !== 'none') preprocessingPayload.normalization = preproc.normalization;
			const preprocessingParam = Object.keys(preprocessingPayload).length > 0
				? `&preprocessing_options=${encodeURIComponent(JSON.stringify(preprocessingPayload))}`
				: '';
			const { data: payload, error } = await apiService.request<any>(
				`/api/edf/data?file_path=${encodeURIComponent(filePath)}&chunk_start=${newChunkStart}&chunk_size=${chunkSize}${channelsParam}${preprocessingParam}`,
				{ headers: { 'x-timeout-ms': '60000' } as any }
			);
			if (error || !payload) {
				try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: error || 'Failed to load chunk' })); } catch (_) { }
				return;
			}
			// Update local chart state immediately to avoid relying solely on global event propagation
			try {
				const labels: string[] = payload.channel_labels || payload.channelLabels || channelLabels;
				const samplesPerChannelLocal: number = Array.isArray(payload.data?.[0]) ? payload.data[0].length : 0;
				const durationSecLocal = samplesPerChannelLocal / Math.max(1, sampleRate);
				const newEeg = {
					channels: labels,
					sampleRate,
					data: payload.data,
					startTime: new Date().toISOString(),
					duration: durationSecLocal,
					samplesPerChannel: samplesPerChannelLocal,
					totalSamples: Number(payload.total_samples || 0),
					chunkSize: Number(payload.chunk_size || chunkSize),
					chunkStart: Number(payload.chunk_start || newChunkStart),
					absoluteStartTime: 0,
					annotations: [],
				};

				setEegData(newEeg);
				setChannelLabels(labels);
				setChunkStart(Number(newEeg.chunkStart));
				setChunkSize(Number(newEeg.chunkSize));
				setTotalSamples(Number(newEeg.totalSamples));
				if (opts?.resetWindow !== false) {
					setTimeWindow([0, Math.min(2, durationSecLocal || 2)]);
				}
			} catch (_) { }
			// Re-broadcast as edf-loaded so all widgets remain in sync
			try {
				window.dispatchEvent(new CustomEvent('dda:edf-loaded', {
					detail: {
						filePath,
						metadata: { sampling_rate: sampleRate, channels: channelLabels },
						edfData: payload,
						selectedChannels,
					},
				}));
			} catch (_) { }
		} catch (err) {
			try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: String(err) })); } catch (_) { }
		}
	}, [filePath, chunkSize, sampleRate, channelLabels, selectedChannels, preproc]);

	// Restore state from storage on mount
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const snap = JSON.parse(raw);
				if (snap) {
					setFilePath(snap.filePath ?? null);
					setSelectedChannels(Array.isArray(snap.selectedChannels) ? snap.selectedChannels : []);
					setSampleRate(typeof snap.sampleRate === 'number' ? snap.sampleRate : 256);
					setChunkStart(typeof snap.chunkStart === 'number' ? snap.chunkStart : 0);
					setChunkSize(typeof snap.chunkSize === 'number' ? snap.chunkSize : 0);
					setTotalSamples(typeof snap.totalSamples === 'number' ? snap.totalSamples : 0);
					if (snap.preproc) setPreproc((p) => ({ ...p, ...snap.preproc }));
					if (Array.isArray(snap.timeWindow) && snap.timeWindow.length === 2) setTimeWindow([Number(snap.timeWindow[0]) || 0, Number(snap.timeWindow[1]) || 2]);
				}
			}
		} catch { /* noop */ }
	}, [storageKey]);

	// After restore, trigger a fetch to repopulate chart (without resetting the window)
	useEffect(() => {
		if (!eegData && filePath && chunkSize > 0 && !pendingFetchRef.current) {
			pendingFetchRef.current = true;
			Promise.resolve(fetchChunk(chunkStart, { resetWindow: false })).finally(() => {
				pendingFetchRef.current = false;
			});
		}
	}, [eegData, filePath, chunkSize, chunkStart, fetchChunk]);

	// Persist state snapshot when key inputs change
	useEffect(() => {
		const snapshot = { filePath, selectedChannels, sampleRate, chunkStart, chunkSize, totalSamples, preproc, timeWindow };
		try { localStorage.setItem(storageKey, JSON.stringify(snapshot)); } catch { /* noop */ }
	}, [storageKey, filePath, selectedChannels, sampleRate, chunkStart, chunkSize, totalSamples, preproc, timeWindow]);

	const canGoPrev = useMemo(() => chunkStart > 0 && chunkSize > 0, [chunkStart, chunkSize]);
	const canGoNext = useMemo(() => {
		if (!chunkSize || !totalSamples) return false;
		return chunkStart + chunkSize < totalSamples;
	}, [chunkStart, chunkSize, totalSamples]);

	const handleFirst = useCallback(() => {
		if (!canGoPrev) return;
		fetchChunk(0);
	}, [canGoPrev, fetchChunk]);

	const handlePrev = useCallback(() => {
		if (!canGoPrev) return;
		const nextStart = Math.max(0, chunkStart - chunkSize);
		fetchChunk(nextStart);
	}, [canGoPrev, chunkStart, chunkSize, fetchChunk]);

	const handleNext = useCallback(() => {
		if (!canGoNext) return;
		const nextStart = chunkStart + chunkSize;
		fetchChunk(nextStart);
	}, [canGoNext, chunkStart, chunkSize, fetchChunk]);

	const handleLast = useCallback(() => {
		if (!totalSamples || !chunkSize) return;
		const lastStart = Math.max(0, totalSamples - chunkSize);
		if (lastStart !== chunkStart) fetchChunk(lastStart);
	}, [chunkStart, totalSamples, chunkSize, fetchChunk]);

	// Responsive sizing
	useEffect(() => {
		const updateDimensions = () => {
			if (containerRef.current) {
				const el = containerRef.current as HTMLDivElement;
				const rect = el.getBoundingClientRect();
				const fallbackWidth = 480;
				const fallbackHeight = 260;
				const nextWidth = rect.width && rect.width > 1 ? rect.width : (el.clientWidth || fallbackWidth);
				const nextHeight = rect.height && rect.height > 1 ? rect.height : (el.clientHeight || fallbackHeight);
				setDimensions({ width: nextWidth, height: nextHeight });
			} else {
				setDimensions({ width: 480, height: 260 });
			}
		};

		updateDimensions();
		const resizeObserver = new ResizeObserver(updateDimensions);
		if (containerRef.current) {
			resizeObserver.observe(containerRef.current);
		}
		window.addEventListener('resize', updateDimensions);

		return () => {
			resizeObserver.disconnect();
			window.removeEventListener('resize', updateDimensions);
		};
	}, []);

	// Recompute dimensions after data arrives
	useEffect(() => {
		const id = requestAnimationFrame(() => {
			if (containerRef.current) {
				const el = containerRef.current as HTMLDivElement;
				const rect = el.getBoundingClientRect();
				if (rect.width > 1 && rect.height > 1) {
					setDimensions({ width: rect.width, height: rect.height });
				}
			}
		});
		return () => cancelAnimationFrame(id);
	}, [data.length]);

	const handleRefresh = async () => {
		setIsLoading(true);
		// Simulate data refresh
		await new Promise(resolve => setTimeout(resolve, 1000));
		const newData = data.map(point => ({
			...point,
			y: point.y + (Math.random() - 0.5) * 2,
		}));
		setData(newData);
		setIsLoading(false);
	};

	const renderChart = () => {
		const maxY = Math.max(...data.map(d => d.y));
		const minY = Math.min(...data.map(d => d.y));
		const range = Math.max(1e-6, maxY - minY);
		const plotW = Math.max(240, Math.floor(dimensions.width || 0));
		const plotH = Math.max(160, Math.floor(dimensions.height || 0));
		const width = plotW > 2 ? plotW : 480;
		const height = plotH > 2 ? plotH : 260;
		const padding = 28;

		const innerW = Math.max(10, width - 2 * padding);
		const innerH = Math.max(10, height - 2 * padding);
		const scaleX = data.length > 1 ? innerW / (data.length - 1) : innerW;
		const scaleY = innerH / range;

		const points = data.map((point, index) => ({
			x: padding + index * scaleX,
			y: padding + (maxY - point.y) * scaleY,
		}));

		const pathData = points.map((point, index) =>
			`${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`
		).join(' ');

		return (
			<svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" className="border rounded w-full h-full">
				{/* axes */}
				<line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
				<line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
				<path d={pathData} stroke="#0ea5e9" strokeWidth="1.5" fill="none" />
				{points.length <= 200 && points.map((point, index) => (
					<circle key={index} cx={point.x} cy={point.y} r="2" fill="#0ea5e9" />
				))}
			</svg>
		);
	};

	return (
		<div className="flex flex-col h-full p-4 space-y-4">
			<Card className="flex flex-col h-full">
				<CardHeader className="flex-shrink-0">
					<CardTitle className="flex items-center gap-2">
						<BarChart3 className="h-4 w-4" />
						Data Visualization
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col flex-1 min-h-0 space-y-3">
					{/* Info + Navigation */}
					<div className="flex flex-col gap-2 text-xs">
						{/* File + Channels + Points + Window */}
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
							<span><span className="text-foreground">File:</span> {basename}</span>
							{totalChunks > 0 && (
								<span><span className="text-foreground">Chunk:</span> {currentChunkNumber} / {totalChunks}</span>
							)}
							{totalChannels > 0 && (
								<span><span className="text-foreground">Channels:</span> {Math.max(1, selectedChannels.length || 0)} / {totalChannels}</span>
							)}
							{samplesPerChannel > 0 && (
								<span><span className="text-foreground">Points:</span> {pointsPlotted.toLocaleString()} ({samplesPerChannel.toLocaleString()} per channel)</span>
							)}
							{chunkDurationSec > 0 && (
								<span><span className="text-foreground">Chunk duration:</span> {chunkDurationSec.toFixed(2)} s</span>
							)}
							{timeWindow && (
								<span><span className="text-foreground">Window:</span> {timeWindow[0].toFixed(2)}–{timeWindow[1].toFixed(2)} s</span>
							)}
						</div>

						{/* Preprocessing Controls */}
						<div className="flex flex-wrap items-center gap-3 p-2 rounded border bg-card/50">
							<div className="flex items-center gap-2">
								<Checkbox id="lp" checked={preproc.lowpassFilter} onCheckedChange={(v) => setPreproc(p => ({ ...p, lowpassFilter: Boolean(v) }))} />
								<Label htmlFor="lp">Low-pass (40 Hz)</Label>
							</div>
							<div className="flex items-center gap-2">
								<Checkbox id="hp" checked={preproc.highpassFilter} onCheckedChange={(v) => setPreproc(p => ({ ...p, highpassFilter: Boolean(v) }))} />
								<Label htmlFor="hp">High-pass (0.5 Hz)</Label>
							</div>

							<div className="flex items-center gap-2">
								<Label className="whitespace-nowrap">Line noise notch</Label>
								<Select value={preproc.notchFilter ? String(preproc.notchFilter) : 'off'} onValueChange={(val) => setPreproc(p => ({ ...p, notchFilter: val === 'off' ? null : Number(val) }))}>
									<SelectTrigger className="h-7 w-[120px]">
										<SelectValue placeholder="off" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="off">Off</SelectItem>
										<SelectItem value="50">50 Hz</SelectItem>
										<SelectItem value="60">60 Hz</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<div className="flex items-center gap-2">
								<Checkbox id="detrend" checked={preproc.detrend} onCheckedChange={(v) => setPreproc(p => ({ ...p, detrend: Boolean(v) }))} />
								<Label htmlFor="detrend">Detrend</Label>
							</div>

							<div className="flex items-center gap-2">
								<Checkbox id="outliers" checked={preproc.removeOutliers} onCheckedChange={(v) => setPreproc(p => ({ ...p, removeOutliers: Boolean(v) }))} />
								<Label htmlFor="outliers">Remove outliers</Label>
							</div>

							<div className="flex items-center gap-2">
								<Checkbox id="smoothing" checked={preproc.smoothing} onCheckedChange={(v) => setPreproc(p => ({ ...p, smoothing: Boolean(v) }))} />
								<Label htmlFor="smoothing">Smoothing window</Label>
								<Input type="number" min={3} step={2} className="h-7 w-[80px]" value={preproc.smoothingWindow}
									onChange={(e) => setPreproc(p => ({ ...p, smoothingWindow: Number(e.target.value) || 3 }))} />
							</div>

							<div className="flex items-center gap-2">
								<Label>Normalization</Label>
								<Select value={preproc.normalization} onValueChange={(val: any) => setPreproc(p => ({ ...p, normalization: val }))}>
									<SelectTrigger className="h-7 w-[140px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										<SelectItem value="minmax">Min-Max</SelectItem>
										<SelectItem value="zscore">Z-Score</SelectItem>
									</SelectContent>
								</Select>
							</div>

							<Button variant="secondary" size="sm" onClick={() => fetchChunk(chunkStart)} disabled={isLoading}>
								Apply
							</Button>
						</div>

						{/* Navigation Controls */}
						<div className="flex items-center gap-1">
							<Button variant="outline" size="sm" onClick={handleFirst} disabled={!canGoPrev || isLoading}>
								<ChevronsLeft className="h-3 w-3" />
							</Button>
							<Button variant="outline" size="sm" onClick={handlePrev} disabled={!canGoPrev || isLoading}>
								<ChevronLeft className="h-3 w-3" />
							</Button>
							<div className="px-2 py-1 text-[11px] text-muted-foreground">
								{totalChunks > 0 ? `Chunk ${currentChunkNumber} of ${totalChunks}` : 'No chunk info'}
							</div>
							<Button variant="outline" size="sm" onClick={handleNext} disabled={!canGoNext || isLoading}>
								<ChevronRight className="h-3 w-3" />
							</Button>
							<Button variant="outline" size="sm" onClick={handleLast} disabled={!canGoNext || isLoading}>
								<ChevronsRight className="h-3 w-3" />
							</Button>
						</div>
					</div>

					{/* Chart Container - Fill widget area */}
					<div className="flex-1 min-h-0 overflow-hidden">
						<div ref={containerRef} className="w-full h-full">
							{eegData ? (
								<EEGChart2
									key={`${filePath || 'file'}:${eegData?.chunkStart ?? 0}:${selectedChannels.join(',')}`}
									eegData={eegData}
									selectedChannels={selectedChannels}
									timeWindow={timeWindow}
									zoomLevel={zoomLevel}
									onTimeWindowChange={(tw: [number, number]) => setTimeWindow(tw)}
									className="w-full h-full"
									height="100%"
								/>
							) : (
								<div className="text-xs text-muted-foreground h-full flex items-center">No data</div>
							)}
						</div>
					</div>

					<div className="text-xs text-muted-foreground flex-shrink-0">
						{pointsPlotted.toLocaleString()} points displayed • {Math.max(1, selectedChannels.length || 0)} channel(s) • {chunkDurationSec > 0 ? `${chunkDurationSec.toFixed(2)}s chunk` : '—'}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
