"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
	Search,
	SortAsc,
	SortDesc,
	Upload
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { LoadingOverlay } from "../../ui/loading-overlay";
import { getFileIcon, isEdfFile } from "../../../lib/utils/fileIcons";
import { apiRequest } from "../../../lib/utils/request";
import { toast } from "../../../hooks/useToast";
import { useUnifiedSessionData } from "../../../hooks/useUnifiedSession";

interface FileItem {
	name: string;
	isDirectory: boolean;
	size?: number;
	modified?: Date;
	extension?: string;
}

interface ConfigResponse {
	allowedDirs: string[];
}

interface FileListResponse {
	files: FileItem[];
	currentPath: string;
	actualPath: string;
}

interface FileUploadResponse {
	success: boolean;
	message: string;
	file_path: string;
}

type SortField = 'name' | 'type' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

interface FileBrowserWidgetProps {
	onFileSelect?: (filePath: string) => void;
	selectedFile?: string;
	currentPath?: string;
	maxHeight?: string;
}

export function FileBrowserWidget({
	onFileSelect,
	selectedFile,
	maxHeight = "400px"
}: FileBrowserWidgetProps) {
	const { data: session } = useUnifiedSessionData();
	const [currentPath, setCurrentPath] = useState("");
	const [searchTerm, setSearchTerm] = useState("");
	const [sortField, setSortField] = useState<SortField>('name');
	const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
	const [isSelectingFile, setIsSelectingFile] = useState(false);
	const [selectedFileForLoading, setSelectedFileForLoading] = useState<string | null>(null);
	const [isDragOver, setIsDragOver] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const dropZoneRef = useRef<HTMLDivElement>(null);

	const { data: configData } = useApiQuery<ConfigResponse>({
		url: "/api/config",
		method: "GET",
		responseType: "json",
		enabled: true,
		token: session?.accessToken,
	});

	// Get file list for current directory using useApiQuery
	const { loading, error, data, refetch } = useApiQuery<FileListResponse>({
		url: currentPath
			? `/api/files/list?path=${encodeURIComponent(currentPath)}`
			: "",
		token: session?.accessToken,
		method: "GET",
		responseType: "json",
		enabled: !!currentPath,
	});

	useEffect(() => {
		if (configData?.allowedDirs?.length && !currentPath) {
			setCurrentPath(configData.allowedDirs[0]);
		}
	}, [configData, currentPath]);

	// Refetch when current directory changes
	useEffect(() => {
		console.log("refetch: currentPath = ", currentPath);
		if (currentPath) refetch();
	}, [currentPath, refetch]);

	// Get files from API response or fallback data
	const files = useMemo(() => {
		console.log("files: data = ", data);
		if (data?.files) {
			return data.files;
		}
		return [];
	}, [data, error]);

	// Filter and sort files
	const filteredAndSortedFiles = useMemo(() => {
		let filtered = files.filter(file =>
			file.name.toLowerCase().includes(searchTerm.toLowerCase())
		);

		// Sort files
		filtered.sort((a, b) => {
			let comparison = 0;

			switch (sortField) {
				case 'name':
					comparison = a.name.localeCompare(b.name);
					break;
				case 'type':
					// Directories first, then files
					if (a.isDirectory !== b.isDirectory) {
						comparison = a.isDirectory ? -1 : 1;
					} else {
						comparison = a.name.localeCompare(b.name);
					}
					break;
				case 'size':
					comparison = (a.size || 0) - (b.size || 0);
					break;
				case 'modified':
					comparison = (a.modified?.getTime() || 0) - (b.modified?.getTime() || 0);
					break;
			}

			return sortDirection === 'asc' ? comparison : -comparison;
		});

		return filtered;
	}, [files, searchTerm, sortField, sortDirection]);

	const handleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
		} else {
			setSortField(field);
			setSortDirection('asc');
		}
	};

	const handleItemClick = async (item: FileItem) => {
		console.log("handleItemClick: item = ", item);
		if (item.isDirectory) {
			// Navigate to directory
			const newPath = currentPath === '/'
				? `/${item.name}`
				: `${currentPath}/${item.name}`;
			setCurrentPath(newPath);
		} else {
			// Show loading state for file selection
			setIsSelectingFile(true);
			const fullPath = currentPath === '/'
				? `/${item.name}`
				: `${currentPath}/${item.name}`;
			setSelectedFileForLoading(fullPath);

			try {
				// Select file
				onFileSelect?.(fullPath);
			} catch (error) {
				console.error("Error during file selection:", error);
			} finally {
				// Clear loading state after a brief delay
				setTimeout(() => {
					setIsSelectingFile(false);
					setSelectedFileForLoading(null);
				}, 500);
			}
		}
	};

	const handleGoUp = () => {
		if (currentPath !== '/') {
			const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
			setCurrentPath(parentPath);
		}
	};

	const formatFileSize = (bytes?: number) => {
		if (!bytes) return '';

		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	};

	// File upload functions
	const isValidFileType = (file: File) => {
		return isEdfFile(file.name);
	};

	const uploadFile = async (file: File) => {
		setIsUploading(true);
		try {
			const formData = new FormData();
			formData.append("file", file);
			formData.append("target_path", currentPath);

			const response = await apiRequest<FileUploadResponse>({
				url: "/api/files/upload",
				token: session?.accessToken,
				method: "POST",
				body: formData,
				responseType: "json",
			});

			if (response.success) {
				toast({
					title: "Upload Successful",
					description: `File "${file.name}" uploaded successfully`,
				});
				refetch();
			} else {
				throw new Error(response.message);
			}
		} catch (error: any) {
			toast({
				title: "Upload Failed",
				description: error.message || `Failed to upload "${file.name}"`,
				variant: "destructive",
			});
		} finally {
			setIsUploading(false);
		}
	};

	// Drag and drop handlers
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		if (
			dropZoneRef.current &&
			!dropZoneRef.current.contains(e.relatedTarget as Node)
		) {
			setIsDragOver(false);
		}
	};

	const handleDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);

		const files = Array.from(e.dataTransfer.files);
		const validFiles = files.filter(isValidFileType);
		const invalidFiles = files.filter((file) => !isValidFileType(file));

		if (invalidFiles.length) {
			toast({
				title: "Invalid File Types",
				description: `Only .edf and .ascii files are allowed. ${invalidFiles.length} file(s) ignored.`,
				variant: "destructive",
			});
		}

		for (const file of validFiles) {
			await uploadFile(file);
		}
	};

	const SortIcon = ({ field }: { field: SortField }) => {
		if (sortField !== field) return null;
		return sortDirection === 'asc' ?
			<SortAsc className="h-3 w-3" /> :
			<SortDesc className="h-3 w-3" />;
	};

	return (
		<div className="flex flex-col h-full relative">
			{/* Header with current path */}
			<div className="p-2 border-b bg-muted/20">
				<div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleGoUp}
						disabled={currentPath === '/'}
						className="h-6 px-2"
					>
						← Up
					</Button>
					<span className="font-mono">{currentPath}</span>
					<div className="flex items-center gap-1 text-xs ml-auto">
						<Upload className="h-3 w-3" /> Drag & drop .edf/.ascii files
					</div>
				</div>


				{/* Search bar */}
				<div className="relative">
					<Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
					<Input
						placeholder="Search files..."
						value={searchTerm}
						onChange={(e) => setSearchTerm(e.target.value)}
						className="pl-7 h-7 text-xs"
					/>
				</div>
			</div>

			{/* Sort controls */}
			<div className="flex gap-1 p-1 border-b bg-muted/10">
				<Button
					variant={sortField === 'name' ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => handleSort('name')}
					className="h-6 px-2 text-xs gap-1"
				>
					Name <SortIcon field="name" />
				</Button>
				<Button
					variant={sortField === 'type' ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => handleSort('type')}
					className="h-6 px-2 text-xs gap-1"
				>
					Type <SortIcon field="type" />
				</Button>
				<Button
					variant={sortField === 'size' ? 'secondary' : 'ghost'}
					size="sm"
					onClick={() => handleSort('size')}
					className="h-6 px-2 text-xs gap-1"
				>
					Size <SortIcon field="size" />
				</Button>
			</div>

			{/* File list with drag and drop */}
			<div
				ref={dropZoneRef}
				onDragOver={handleDragOver}
				onDragEnter={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				className={`flex-1 overflow-auto relative ${isDragOver
					? "border-2 border-dashed border-primary bg-primary/10"
					: ""
					}`}
				style={{ maxHeight }}
			>
				{isDragOver && (
					<div className="absolute inset-0 z-20 flex items-center justify-center bg-primary/20 rounded-md">
						<div className="text-center p-4">
							<Upload className="h-8 w-8 mx-auto mb-2 text-primary" />
							<p className="text-sm font-medium text-primary">
								Drop .edf or .ascii files here
							</p>
						</div>
					</div>
				)}

				{isUploading && (
					<div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 rounded-md">
						<div className="text-center p-4">
							<div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
							<p className="text-sm text-muted-foreground">
								Uploading files...
							</p>
						</div>
					</div>
				)}
				{loading ? (
					<div className="p-4 text-center text-sm text-muted-foreground">
						Loading files...
					</div>
				) : error ? (
					<div className="p-4 text-center text-sm text-destructive">
						{error.message || 'Failed to load files'}
					</div>
				) : filteredAndSortedFiles.length === 0 ? (
					<div className="p-4 text-center text-sm text-muted-foreground">
						{searchTerm ? 'No files match your search' : 'No files found'}
					</div>
				) : (
					<div className="space-y-1 p-1">
						{filteredAndSortedFiles.map((item, index) => (
							<div
								key={`${item.name}-${index}`}
								className={`flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer text-xs ${selectedFile === `${currentPath}/${item.name}` ? 'bg-primary/10' : ''
									}`}
								onClick={() => handleItemClick(item)}
							>
								{getFileIcon({ name: item.name, isDirectory: item.isDirectory })}
								<span className="flex-1 truncate">{item.name}</span>
								{!item.isDirectory && item.size && (
									<span className="text-muted-foreground text-xs">
										{formatFileSize(item.size)}
									</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Footer with file count */}
			<div className="p-2 border-t bg-muted/10 text-xs text-muted-foreground">
				{filteredAndSortedFiles.length} items
				{searchTerm && ` (filtered from ${files.length})`}
			</div>

			{isSelectingFile && selectedFileForLoading && (
				<LoadingOverlay
					show={true}
					message={`Selecting file: ${selectedFileForLoading}`}
					type="file-load"
					variant="modal"
					size="sm"
				/>
			)}
		</div>
	);
}
