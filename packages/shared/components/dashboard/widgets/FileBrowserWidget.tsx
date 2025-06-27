"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { FileText, Folder, Search, SortAsc, SortDesc, File } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { useApiQuery } from "../../../hooks/useApiQuery";

interface FileItem {
	name: string;
	type: 'file' | 'directory';
	size?: number;
	modified?: Date;
	extension?: string;
}

interface FileListResponse {
	files: FileItem[];
	currentPath: string;
	actualPath: string;
}

interface ConfigResponse {
	allowedDirs: string[];
}

interface FileBrowserWidgetProps {
	onFileSelect?: (filePath: string) => void;
	selectedFile?: string;
	currentPath?: string;
	maxHeight?: string;
}

type SortField = 'name' | 'type' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';

export function FileBrowserWidget({
	onFileSelect,
	selectedFile,
	maxHeight = "400px"
}: FileBrowserWidgetProps) {
	const { data: session } = useSession();
	const [currentPath, setCurrentPath] = useState("");
	const [searchTerm, setSearchTerm] = useState("");
	const [sortField, setSortField] = useState<SortField>('name');
	const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
		if (currentPath) refetch();
	}, [currentPath, refetch]);

	// Get files from API response or fallback data
	const files = useMemo(() => {
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
					if (a.type !== b.type) {
						comparison = a.type === 'directory' ? -1 : 1;
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

	const handleItemClick = (item: FileItem) => {
		if (item.type === 'directory') {
			// Navigate to directory
			const newPath = currentPath === '/'
				? `/${item.name}`
				: `${currentPath}/${item.name}`;
			setCurrentPath(newPath);
		} else {
			// Select file
			const fullPath = currentPath === '/'
				? `/${item.name}`
				: `${currentPath}/${item.name}`;
			onFileSelect?.(fullPath);
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

	const getFileIcon = (item: FileItem) => {
		if (item.type === 'directory') {
			return <Folder className="h-4 w-4 text-blue-500" />;
		}

		switch (item.extension) {
			case 'edf':
				return <FileText className="h-4 w-4 text-green-500" />;
			case 'md':
				return <FileText className="h-4 w-4 text-gray-500" />;
			case 'json':
				return <File className="h-4 w-4 text-yellow-500" />;
			default:
				return <File className="h-4 w-4 text-gray-400" />;
		}
	};

	const SortIcon = ({ field }: { field: SortField }) => {
		if (sortField !== field) return null;
		return sortDirection === 'asc' ?
			<SortAsc className="h-3 w-3" /> :
			<SortDesc className="h-3 w-3" />;
	};

	return (
		<div className="flex flex-col h-full">
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

			{/* File list */}
			<div className="flex-1 overflow-auto" style={{ maxHeight }}>
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
								{getFileIcon(item)}
								<span className="flex-1 truncate">{item.name}</span>
								{item.type === 'file' && item.size && (
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
		</div>
	);
}
