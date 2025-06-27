"use client";

import React from "react";
import { useSession } from "next-auth/react";
import { SimpleDashboardGrid, SimpleWidget } from "shared/components/dashboard/SimpleDashboardGrid";
import { SimpleDashboardToolbar } from "shared/components/dashboard/SimpleDashboardToolbar";
import { useSimpleDashboard } from "shared/hooks/useSimpleDashboard";
import { FileBrowserWidget } from "shared/components/dashboard/widgets/FileBrowserWidget";
import { DDAWidget } from "shared/components/dashboard/widgets/DDAWidget";
import { ProtectedRoute } from "shared/components/higher-order/ProtectedRoute";
import { useAppDispatch, useAppSelector } from "shared/store";
import { initializePlot, loadChunk, ensurePlotState } from "shared/store/slices/plotSlice";
import { useToast } from "shared/components/ui/use-toast";

export default function Dashboard() {
	const { data: session } = useSession();
	const dispatch = useAppDispatch();
	const { toast } = useToast();

	const handleFileSelect = async (filePath: string) => {
		const token = session?.accessToken;

		if (!token) {
			toast({
				title: "Authentication Error",
				description: "Please log in to load files.",
				variant: "destructive",
			});
			return;
		}

		try {
			// Ensure plot state exists for this file
			dispatch(ensurePlotState(filePath));

			// Initialize plot metadata
			const initResult = await dispatch(initializePlot({ filePath, token }));

			if (initResult.meta.requestStatus === 'fulfilled') {
				// Load the first chunk
				const loadResult = await dispatch(loadChunk({
					filePath,
					chunkNumber: 1,
					chunkSizeSeconds: 10,
					token,
				}));

				if (loadResult.meta.requestStatus === 'fulfilled') {
					toast({
						title: "File Loaded",
						description: `Successfully loaded data from ${filePath.split('/').pop()}`,
					});
				} else {
					toast({
						title: "Data Load Error",
						description: "Failed to load file data chunk.",
						variant: "destructive",
					});
				}
			} else {
				toast({
					title: "Metadata Error",
					description: "Failed to load file metadata.",
					variant: "destructive",
				});
			}
		} catch (error) {
			console.error('Error loading file:', error);
			toast({
				title: "File Load Error",
				description: `Failed to load file: ${error instanceof Error ? error.message : 'Unknown error'}`,
				variant: "destructive",
			});
		}
	};

	// Initialize with some default widgets that match the original layout
	const initialWidgets: SimpleWidget[] = [
		{
			id: "file-browser-default",
			title: "File Browser",
			position: { x: 20, y: 20 },
			size: { width: 350, height: 400 },
			minSize: { width: 250, height: 300 },
			maxSize: { width: 500, height: 600 },
			type: "file-browser",
			content: (
				<FileBrowserWidget
					onFileSelect={handleFileSelect}
					maxHeight="100%"
				/>
			)
		},
		{
			id: "dda-form-default",
			title: "DDA Analysis Form",
			position: { x: 390, y: 20 },
			size: { width: 350, height: 400 },
			minSize: { width: 300, height: 350 },
			maxSize: { width: 500, height: 600 },
			type: "dda-form",
			content: <DDAWidget />
		}
	];

	const { widgets, updateWidget, addWidget, removeWidget, popOutWidget, swapInWidget } = useSimpleDashboard(initialWidgets);

	return (
		<ProtectedRoute>
			{/* Ensure full height expansion with proper flex layout */}
			<div className="h-full w-full flex flex-col">
				<SimpleDashboardToolbar onAddWidget={addWidget} className="flex-shrink-0" />
				<div className="flex-1 w-full">
					<SimpleDashboardGrid
						widgets={widgets}
						onWidgetUpdate={updateWidget}
						onWidgetRemove={removeWidget}
						onWidgetPopOut={popOutWidget}
						onWidgetSwapIn={swapInWidget}
						className="w-full h-full"
						gridSize={10}
						enableSnapping={false}
						enableCollisionDetection={false}
					/>
				</div>
			</div>
		</ProtectedRoute>
	);
}
