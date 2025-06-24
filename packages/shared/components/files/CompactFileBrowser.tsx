"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
	File,
	Folder,
	ArrowLeft,
	Search,
	SortAsc,
	SortDesc,
	X,
	Star,
	ChevronRight
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Input } from "../ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils/misc";
import { useApiQuery } from "../../hooks/useApiQuery";
import { apiRequest } from "../../lib/utils/request";
import { toast } from "../../hooks/useToast";
import { HorizontalResizableContainer } from "../ui/HorizontalResizableContainer";

interface FileItem {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number;
	lastModified?: string;
	isFavorite?: boolean;
}

interface FileListResponse {
	files: FileItem[];
}

interface ConfigResponse {
	allowedDirs: string[];
}

interface ToggleFavoriteResponse {
	success: boolean;
	file_path: string;
	message: string | null;
}

interface CompactFileBrowserProps {
	onFileSelect?: (filePath: string) => void;
	selectedFile?: string;
	className?: string;
	maxHeight?: string;
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	enableHorizontalResize?: boolean;
}

export function CompactFileBrowser({
	onFileSelect,
	selectedFile,
	className,
	maxHeight = "500px",
	defaultWidth = 350,
	minWidth = 250,
	maxWidth = 600,
	enableHorizontalResize = true,
}: CompactFileBrowserProps) {
	const { data: session } = useSession();
	const [currentPath, setCurrentPath] = useState("");
	const [pathHistory, setPathHistory] = useState<string[]>([]);
	const [searchTerm, setSearchTerm] = useState("");
	const [sortOptions, setSortOptions] = useState("name");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

	// Get configuration (same as original FileBrowser)
	const { data: configData } = useApiQuery<ConfigResponse>({
		url: "/api/config",
		method: "GET",
		responseType: "json",
		enabled: true,
		token: session?.accessToken,
	});

	// Get file list for current path (same as original FileBrowser)
	const { loading, error, data, refetch, updateData } = useApiQuery<FileListResponse>({
		url: currentPath
			? `/api/files/list?path=${encodeURIComponent(currentPath)}`
			: "",
		token: session?.accessToken,
		method: "GET",
		responseType: "json",
		enabled: !!currentPath,
	});

	// Set initial path when config loads (same as original FileBrowser)
	useEffect(() => {
		if (configData?.allowedDirs?.length && !currentPath) {
			setCurrentPath(configData.allowedDirs[0]);
		}
	}, [configData, currentPath]);

	// Refetch when current path changes (same as original FileBrowser)
	useEffect(() => {
		if (currentPath) refetch();
	}, [currentPath, refetch]);

	// Utility functions (same as original FileBrowser)
	const formatFileSize = (bytes?: number) => {
		if (!bytes) return "Unknown";
		const k = 1024;
		const sizes = ["Bytes", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
	};

	const formatDate = (dateString?: string) => {
		if (!dateString) return "Unknown";
		const date = new Date(dateString);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
	};

	// Navigation functions (same as original FileBrowser)
	const navigateToDirectory = (dirPath: string) => {
		setPathHistory((prev) => [...prev, currentPath]);
		setCurrentPath(dirPath);
	};

	const navigateBack = () => {
		if (pathHistory.length) {
			setPathHistory((prev) => prev.slice(0, -1));
			setCurrentPath(pathHistory[pathHistory.length - 1] || "");
		}
	};

	const handleFileClick = (file: FileItem) => {
		if (file.isDirectory) {
			navigateToDirectory(file.path);
		} else {
			onFileSelect?.(file.path);
		}
	};

	const handleStarClick = async (e: React.MouseEvent, file: FileItem) => {
		e.stopPropagation();
		try {
			const response = await apiRequest<ToggleFavoriteResponse>({
				url: `/api/favfiles/toggle?file_path=${encodeURIComponent(file.path)}`,
				token: session?.accessToken,
				method: "POST",
				responseType: "json",
			});

			updateData((prevData) => {
				if (!prevData) return null;
				return {
					...prevData,
					files: prevData.files.map((f) =>
						f.path === response.file_path
							? { ...f, isFavorite: response.success }
							: f
					),
				};
			});
		} catch (error) {
			toast({
				title: "Error",
				description: "Failed to update favorite status",
				variant: "destructive",
			});
			refetch();
		}
	};

	// Search and sort functionality (same as original FileBrowser)
	const filteredFiles = useMemo(() => {
		if (!data?.files) return [];
		return data.files.filter((file) =>
			file.name.toLowerCase().includes(searchTerm.toLowerCase())
		);
	}, [data?.files, searchTerm]);

	const sortedFiles = useMemo(() => {
		if (!filteredFiles) return [];
		return [...filteredFiles].sort((a, b) => {
			// Always sort directories first
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}

			let result = 0;
			if (sortOptions === "name") {
				result = a.name.localeCompare(b.name);
			} else if (sortOptions === "size") {
				result = (a.size || 0) - (b.size || 0);
			} else if (sortOptions === "lastModified") {
				const dateA = new Date(a.lastModified || 0);
				const dateB = new Date(b.lastModified || 0);
				result = dateA.getTime() - dateB.getTime();
			}

			return sortOrder === "asc" ? result : -result;
		});
	}, [filteredFiles, sortOptions, sortOrder]);

	const clearSearch = () => {
		setSearchTerm("");
	};

	// Show current directory path with navigation
	const currentDirName = currentPath.split('/').pop() || 'Root';

	if (loading && !data) {
		return (
			<HorizontalResizableContainer
				storageKey="compact-file-browser-width"
				defaultWidth={defaultWidth}
				minWidth={minWidth}
				maxWidth={maxWidth}
				enabled={enableHorizontalResize}
			>
				<Card className={className}>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">File Browser</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							{[...Array(5)].map((_, i) => (
								<div key={i} className="flex items-center gap-2">
									<Skeleton className="h-4 w-4" />
									<Skeleton className="h-4 w-full" />
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</HorizontalResizableContainer>
		);
	}

	if (error) {
		return (
			<HorizontalResizableContainer
				storageKey="compact-file-browser-width"
				defaultWidth={defaultWidth}
				minWidth={minWidth}
				maxWidth={maxWidth}
				enabled={enableHorizontalResize}
			>
				<Card className={className}>
					<CardHeader className="pb-3">
						<CardTitle className="text-base">File Browser</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-center py-4">
							<p className="text-sm text-destructive">
								{typeof error === 'string' ? error : 'Failed to load files'}
							</p>
							<Button variant="outline" size="sm" onClick={refetch} className="mt-2">
								Retry
							</Button>
						</div>
					</CardContent>
				</Card>
			</HorizontalResizableContainer>
		);
	}

	return (
		<HorizontalResizableContainer
			storageKey="compact-file-browser-width"
			defaultWidth={defaultWidth}
			minWidth={minWidth}
			maxWidth={maxWidth}
			enabled={enableHorizontalResize}
		>
			<Card className={className}>
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center justify-between">
						<span className="flex items-center gap-2">
							<Folder className="h-4 w-4" />
							{currentDirName}
						</span>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={navigateBack}
								disabled={!pathHistory.length}
								title="Go back"
							>
								<ArrowLeft className="h-4 w-4" />
							</Button>
							<Button variant="outline" size="sm" onClick={refetch} title="Refresh">
								Refresh
							</Button>
						</div>
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Search and Sort Controls */}
					<div className="flex flex-col gap-2">
						<div className="relative">
							<Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="Search files..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								className="pl-8 pr-8"
							/>
							{searchTerm && (
								<Button
									variant="ghost"
									size="sm"
									onClick={clearSearch}
									className="absolute right-1 top-1 h-6 w-6 p-0 hover:bg-muted"
									title="Clear search"
								>
									<X className="h-3 w-3" />
								</Button>
							)}
						</div>
						<div className="flex gap-2">
							<Select value={sortOptions} onValueChange={setSortOptions}>
								<SelectTrigger className="w-[120px]">
									<SelectValue placeholder="Sort by" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="name">Name</SelectItem>
									<SelectItem value="size">Size</SelectItem>
									<SelectItem value="lastModified">Modified</SelectItem>
								</SelectContent>
							</Select>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
								title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
							>
								{sortOrder === "asc" ? (
									<SortAsc className="h-4 w-4" />
								) : (
									<SortDesc className="h-4 w-4" />
								)}
							</Button>
						</div>
					</div>

					{/* Search Results Info */}
					{searchTerm && (
						<div className="text-sm text-muted-foreground">
							{sortedFiles.length === 0
								? "No files match your search"
								: `${sortedFiles.length} file${sortedFiles.length === 1 ? "" : "s"
								} found`}
						</div>
					)}

					{/* File List */}
					<div className="border rounded-md overflow-hidden">
						<ScrollArea style={{ height: maxHeight }}>
							<table className="w-full">
								<thead className="sticky top-0 bg-background z-10">
									<tr className="border-b bg-muted/50">
										<th className="text-left p-2">Name</th>
										<th className="text-left p-2 w-20">Size</th>
										<th className="text-right p-2 w-12">⭐</th>
									</tr>
								</thead>
								<tbody>
									{!sortedFiles?.length ? (
										<tr>
											<td
												colSpan={3}
												className="p-4 text-center text-muted-foreground"
											>
												{searchTerm
													? "No files match your search"
													: "No files found"}
											</td>
										</tr>
									) : (
										sortedFiles.map((file) => {
											const isSelected = file.path === selectedFile;
											return (
												<tr
													key={file.path}
													className={cn(
														"border-b cursor-pointer transition-colors",
														isSelected
															? "bg-primary/10 hover:bg-primary/15 border-primary/20"
															: "hover:bg-muted/50"
													)}
													onClick={() => handleFileClick(file)}
												>
													<td className="p-2 flex items-center gap-2">
														{file.isDirectory ? (
															<>
																<Folder className="h-4 w-4 text-blue-500" />
																<span
																	className={isSelected ? "font-medium" : ""}
																>
																	{file.name}
																</span>
																<ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
															</>
														) : (
															<>
																<File className="h-4 w-4 text-gray-500" />
																<span
																	className={isSelected ? "font-medium" : ""}
																>
																	{file.name}
																</span>
															</>
														)}
													</td>
													<td className="p-2 text-sm text-muted-foreground">
														{file.isDirectory
															? "--"
															: formatFileSize(file.size)}
													</td>
													<td className="p-2 text-right">
														{!file.isDirectory && (
															<Button
																variant="ghost"
																size="icon"
																className="w-6 h-6"
																onClick={(e) => handleStarClick(e, file)}
																title={
																	file.isFavorite
																		? "Unstar file"
																		: "Star file"
																}
															>
																<Star
																	className={cn(
																		"h-3 w-3",
																		file.isFavorite
																			? "fill-yellow-400 text-yellow-400"
																			: "text-muted-foreground"
																	)}
																/>
															</Button>
														)}
													</td>
												</tr>
											);
										})
									)}
								</tbody>
							</table>
						</ScrollArea>
					</div>
				</CardContent>
			</Card>
		</HorizontalResizableContainer>
	);
}
