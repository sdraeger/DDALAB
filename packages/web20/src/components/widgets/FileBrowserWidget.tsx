import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Folder, File, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import apiService from '@/lib/api';
import { useUnifiedSessionData } from '@/hooks/useUnifiedSession';
import { FileSelectionDialog } from '@/components/dialog/FileSelectionDialog';

interface FileBrowserWidgetProps {
	onFileSelect?: (filePath: string) => void;
	maxHeight?: string;
}

interface FileItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number | null;
	lastModified?: string | null;
	children?: FileItem[];
}

export function FileBrowserWidget({ onFileSelect, maxHeight = "400px" }: FileBrowserWidgetProps) {
	const { data: session } = useUnifiedSessionData();
	// Default to first allowed root returned by API
	const [currentPath, setCurrentPath] = useState('');
	const [files, setFiles] = useState<FileItem[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [dialogOpen, setDialogOpen] = useState(false);
	const [pendingFile, setPendingFile] = useState<string | null>(null);
	const [allowedRoots, setAllowedRoots] = useState<Array<{ name: string; relative_path: string }>>([]);

	// Load default root from API on mount
	useEffect(() => {
		const init = async () => {
			try {
				const token = session?.accessToken || session?.data?.accessToken || null;
				apiService.setToken(token || null);
				const { data } = await apiService.request<{ roots: Array<{ name: string; relative_path: string }>; default_relative_path: string }>(
					'/api/files/roots'
				);
				const defaultPath = data?.default_relative_path || '';
				
				// Check if we have any roots available
				if (!data?.roots || data.roots.length === 0) {
					setError('No allowed directories configured');
					setFiles([]);
					return;
				}
				
				// Store allowed roots for bounds checking
				setAllowedRoots(data.roots);
				
				// Use the default path as-is (API now returns "" for root, not ".")
				setCurrentPath(defaultPath);
				await handleRefresh(defaultPath);
			} finally {
				// no-op
			}
		};
		void init();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleRefresh = async (nextPath?: string) => {
		try {
			setLoading(true);
			setError(null);
			const token = session?.accessToken || session?.data?.accessToken || null;
			apiService.setToken(token || null);
			let effectivePath = (nextPath ?? currentPath).trim();
			
			// Normalize './' and leading './' - convert to empty string for root
			if (effectivePath === '.' || effectivePath === './') {
				effectivePath = '';
			}
			if (effectivePath.startsWith('./')) {
				effectivePath = effectivePath.slice(2);
			}
			
			// API now accepts empty string for root directory
			const pathForApi = effectivePath;
			const query = new URLSearchParams({ path: pathForApi }).toString();
			const { data, error } = await apiService.request<{ files: Array<{ name: string; path: string; is_directory: boolean; size?: number | null; last_modified?: string | null }> }>(
				`/api/files/list?${query}`
			);
			if (error) {
				setError(error);
				setFiles([]);
				return;
			}
			const items: FileItem[] = (data?.files || []).map((f) => ({
				name: f.name,
				path: f.path,
				type: f.is_directory ? 'directory' : 'file',
				size: f.size ?? null,
				lastModified: f.last_modified ?? null,
			} as FileItem));
			setFiles(items);
		} catch (e: any) {
			setError(e?.message || 'Failed to load files');
			setFiles([]);
		} finally {
			setLoading(false);
		}
	};

	const handleGoUp = async () => {
		if (!canGoUp()) return;
		
		// Calculate parent path
		let parentPath = '';
		if (currentPath.includes('/')) {
			const pathParts = currentPath.split('/').filter(part => part !== '');
			if (pathParts.length > 1) {
				parentPath = pathParts.slice(0, -1).join('/');
			}
			// If pathParts.length === 1, parentPath stays empty (root)
		}
		
		console.log('Going up from:', currentPath, 'to:', parentPath);
		setCurrentPath(parentPath);
		await handleRefresh(parentPath);
	};

	const canGoUp = (): boolean => {
		// Can't go up if we're already at the root (empty path)
		if (!currentPath || currentPath === '') return false;
		
		// Always allow going up one level - the API should handle bounds checking
		// If the user can navigate to a directory, they should be able to go back up
		return true;
	};

	const handleFileClick = async (file: FileItem) => {
		console.log('handleFileClick', file);
		if (file.type === 'file') {
			console.log('file', file);
			// Open dialog instead of direct selection
			setPendingFile(file.path);
			setDialogOpen(true);
		} else if (file.type === 'directory') {
			console.log('directory', file);
			setCurrentPath(file.path);
			void handleRefresh(file.path);
		}
	};

	const formatBytes = (bytes?: number | null) => {
		if (bytes === null || bytes === undefined) return '';
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		const value = bytes / Math.pow(k, i);
		return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${sizes[i]}`;
	};

	const formatDate = (value?: string | number | null) => {
		if (value === null || value === undefined || value === '') return '';
		let date: Date | null = null;
		if (typeof value === 'number') {
			// Assume seconds if too small for ms
			const ms = value > 1e12 ? value : value * 1000;
			date = new Date(ms);
		} else if (/^\d+(\.\d+)?$/.test(value)) {
			// Numeric string (epoch seconds)
			const seconds = parseFloat(value);
			date = new Date(seconds * 1000);
		} else {
			// Try ISO/date string
			const parsed = new Date(value);
			if (!isNaN(parsed.getTime())) {
				date = parsed;
			}
		}
		return date ? date.toLocaleString() : '';
	};

	const renderFileItem = (item: FileItem, depth = 0) => {
		const isExpanded = expandedDirs.has(item.path);
		const hasChildren = item.children && item.children.length > 0;

		return (
			<div key={item.path}>
				<div
					className={`grid grid-cols-[auto,1fr,80px,80px,120px] items-center gap-2 px-2 py-1 ${item.type === 'file' ? 'text-foreground' : 'text-muted-foreground'}`}
					style={{ paddingLeft: `${depth * 16 + 8}px` }}
				>
					<div className="flex items-center gap-1">
						{item.type === 'directory' ? (
							<>
								{hasChildren ? (
									isExpanded ? (
										<ChevronDown className="h-3 w-3 shrink-0" />
									) : (
										<ChevronRight className="h-3 w-3 shrink-0" />
									)
								) : (
									<div className="w-3 shrink-0" />
								)}
								<Folder className="h-4 w-4 shrink-0" />
							</>
						) : (
							<>
								<div className="w-3 shrink-0" />
								<File className="h-4 w-4 shrink-0" />
							</>
						)}
					</div>
					<span className="text-sm truncate">{item.name}</span>
					<span className="text-xs text-muted-foreground">{item.type === 'directory' ? 'Folder' : (item.name.split('.').pop()?.toUpperCase() || 'File')}</span>
					<span className="text-xs tabular-nums text-right">{item.type === 'file' ? formatBytes(item.size) : ''}</span>
					<span className="text-xs text-right truncate" title={item.lastModified || ''}>{formatDate(item.lastModified || '')}</span>
				</div>
				{hasChildren && isExpanded && (
					<div>
						{item.children!.map(child => renderFileItem(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="flex flex-col h-full min-h-0" style={{ maxHeight }}>
			<div className="flex items-center gap-2 p-1 border-b">
				<Button 
					size="sm" 
					variant="outline" 
					onClick={handleGoUp} 
					disabled={!canGoUp() || loading}
					title="Go up one directory"
				>
					<ChevronUp className="h-4 w-4" />
				</Button>
				<Input
					value={currentPath}
					onChange={(e) => setCurrentPath(e.target.value)}
					placeholder="Current path..."
					className="flex-1 text-sm"
				/>
				<Button size="sm" variant="outline" onClick={() => handleRefresh()} disabled={loading}>
					Refresh
				</Button>
			</div>

			<ScrollArea className="flex-1 min-h-0">
				<div className="p-1">
					{error && (
						<div className="text-xs text-destructive mb-2">{error}</div>
					)}
					{loading ? (
						<div className="flex items-center justify-center py-4">
							<div className="text-sm text-muted-foreground">Loading...</div>
						</div>
					) : (
						<div className="space-y-1">
							{/* Header Row */}
							<div className="grid grid-cols-[auto,1fr,80px,80px,120px] gap-2 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
								<div className="w-6" />
								<div>Name</div>
								<div>Type</div>
								<div className="text-right">Size</div>
								<div className="text-right">Last Modified</div>
							</div>
							{files.map(item => (
								<button
									key={item.path}
									type="button"
									className="w-full text-left hover:bg-accent rounded cursor-pointer select-none"
									onMouseDown={(e) => {
										e.stopPropagation();
									}}
									onClick={(e) => {
										console.log('clicked', item);
										e.stopPropagation();
										handleFileClick(item);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											e.stopPropagation();
											handleFileClick(item);
										}
									}}
								>
									{renderFileItem(item)}
								</button>
							))}
						</div>
					)}
				</div>
			</ScrollArea>
			{/* Selection Dialog */}
			<FileSelectionDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				filePath={pendingFile || ''}
				onConfirm={async (filePath, selectedChannels, metadata, segment) => {
					try {
						// Notify loading start
						try { window.dispatchEvent(new CustomEvent('dda:loading-start')); } catch (_) { }

						const sr = (metadata as any)?.sample_rate || (metadata as any)?.sampling_rate || 256;
						const toSec = (t: any) => t.days * 86400 + t.hours * 3600 + t.minutes * 60 + t.seconds;
						const startSec = toSec(segment.start);
						const endSec = toSec(segment.end);
						const durSec = Math.max(0.5, endSec - startSec);
						const defaultChunkSamples = Number((metadata as any)?.chunk_size) || Math.round(10 * sr);

						// Heuristic: if selected segment is much larger than a single chunk, create a server-side segment and load its first chunk
						const segmentThresholdSec = Math.max(60, Math.round((defaultChunkSamples / sr) * 6));
						let effectiveFilePath = filePath;
						let chunkStart = Math.round(startSec * sr);
						let chunkSize = defaultChunkSamples;

						if (durSec > segmentThresholdSec) {
							const segRes = await apiService.request<string>(
								`/api/edf/segment`,
								{ method: 'POST', body: JSON.stringify({ file_path: filePath, segment }) }
							);
							if (!segRes.error && segRes.data) {
								effectiveFilePath = segRes.data as unknown as string;
								chunkStart = 0; // start of segmented file
								chunkSize = defaultChunkSamples;
							}
						} else {
							// Same file, but only request a single chunk starting at the selected start
							chunkStart = Math.round(startSec * sr);
							chunkSize = defaultChunkSamples;
						}

						const res = await apiService.request<any>(
							`/api/edf/data?file_path=${encodeURIComponent(effectiveFilePath)}&chunk_start=${chunkStart}&chunk_size=${chunkSize}&channels=${encodeURIComponent(selectedChannels.join(','))}`,
							{ headers: { 'x-timeout-ms': '60000' } as any }
						);
						if (res.error) {
							try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: res.error })); } catch (_) { }
							return;
						}
						let payload: any = res.data;
						if (typeof payload === 'string') {
							try { payload = JSON.parse(payload); } catch (e) {
								try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: 'Invalid EDF data payload' })); } catch (_) { }
								return;
							}
						}
						if (!payload || !Array.isArray(payload.data)) {
							try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: 'Malformed EDF data' })); } catch (_) { }
							return;
						}

						// Publish loaded event with selected channels for widgets to use
						try {
							window.dispatchEvent(new CustomEvent('dda:edf-loaded', {
								detail: { filePath: effectiveFilePath, metadata, edfData: payload, selectedChannels }
							}));
						} catch (_) { }

						// Also call external callback if provided (no network in handler)
						onFileSelect?.(effectiveFilePath);
					} catch (err: any) {
						try { window.dispatchEvent(new CustomEvent('dda:loading-error', { detail: err?.message || 'Request failed' })); } catch (_) { }
					}
				}}
			/>
		</div>
	);
}
