"use client";

import React from "react";
import { SimpleDashboardGrid, SimpleWidget } from "shared/components/dashboard/SimpleDashboardGrid";
import { SimpleDashboardToolbar } from "shared/components/dashboard/SimpleDashboardToolbar";
import { useSimpleDashboard } from "shared/hooks/useSimpleDashboard";

export default function SimpleDashboard() {
	// Initialize with some default widgets
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
				<div className="space-y-4">
					<div className="text-sm text-muted-foreground">Browse and select files</div>
					<div className="space-y-2">
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Janet</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Julia</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Kotlin</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Lambda Calculus</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 LaTeX</span>
						</div>
						<div className="flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer">
							<span className="text-sm">📁 Lisp</span>
						</div>
					</div>
				</div>
			)
		},
		{
			id: "dda-form-default",
			title: "DDA Analysis Form",
			position: { x: 400, y: 20 },
			size: { width: 400, height: 350 },
			minSize: { width: 300, height: 250 },
			maxSize: { width: 600, height: 500 },
			type: "dda-form",
			content: (
				<div className="space-y-4">
					<div>
						<label className="text-sm font-medium">Selected File</label>
						<input
							type="text"
							placeholder="No file selected"
							className="w-full mt-1 px-3 py-2 border border-border rounded-md text-sm"
							readOnly
						/>
					</div>
					<div>
						<label className="text-sm font-medium">Selected Channels</label>
						<div className="mt-1 p-2 border border-border rounded-md text-sm text-muted-foreground">
							Loading channels...
						</div>
					</div>
					<div className="space-y-2">
						<button className="w-full bg-white text-black border border-gray-300 px-4 py-2 rounded text-sm">
							Loading channels...
						</button>
					</div>
					<div className="flex gap-2">
						<button className="px-3 py-1 text-sm">‹</button>
						<span className="px-3 py-1 text-sm">#</span>
						<span className="px-3 py-1 text-sm">1</span>
						<span className="px-3 py-1 text-sm">/0</span>
						<button className="px-3 py-1 text-sm">›</button>
					</div>
				</div>
			)
		}
	];

	const { widgets, updateWidget, addWidget, removeWidget, popOutWidget, swapInWidget } = useSimpleDashboard(initialWidgets);

	return (
		<div className="h-screen flex flex-col">
			<SimpleDashboardToolbar onAddWidget={addWidget} />
			<div className="flex-1 overflow-hidden">
				<SimpleDashboardGrid
					widgets={widgets}
					onWidgetUpdate={updateWidget}
					onWidgetRemove={removeWidget}
					onWidgetPopOut={popOutWidget}
					onWidgetSwapIn={swapInWidget}
					className="h-full"
					gridSize={10}
					enableSnapping={false}
					enableCollisionDetection={false}
				/>
			</div>
		</div>
	);
}
