'use client';

import React, { useState } from 'react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui';
import { Button, ScrollArea, Badge } from '@/components/ui';
import {
	BarChart3,
	Database,
	LayoutDashboard,
	FileText,
	Activity,
	TrendingUp,
	Settings,
	Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface WidgetType {
	id: string;
	title: string;
	description: string;
	icon: React.ComponentType<{ className?: string }>;
	type: string;
	defaultSize: { width: number; height: number };
	minSize: { width: number; height: number };
	maxSize: { width: number; height: number };
	category: 'data' | 'visualization' | 'analysis' | 'utility';
}

interface AddWidgetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onAddWidget: (widgetType: WidgetType) => void;
	trigger?: React.ReactNode;
}

const availableWidgetTypes: WidgetType[] = [
	{
		id: 'chart',
		title: 'Chart Widget',
		description: 'Interactive data visualization with charts and graphs',
		icon: BarChart3,
		type: 'chart',
		defaultSize: { width: 350, height: 260 },
		minSize: { width: 280, height: 180 },
		maxSize: { width: 800, height: 600 },
		category: 'visualization',
	},
	{
		id: 'table',
		title: 'Data Table',
		description: 'Display data in a structured table format',
		icon: Database,
		type: 'table',
		defaultSize: { width: 400, height: 250 },
		minSize: { width: 280, height: 180 },
		maxSize: { width: 1000, height: 800 },
		category: 'data',
	},
	{
		id: 'metrics',
		title: 'Metrics Overview',
		description: 'Key performance indicators and summary metrics',
		icon: LayoutDashboard,
		type: 'metrics',
		defaultSize: { width: 280, height: 180 },
		minSize: { width: 200, height: 140 },
		maxSize: { width: 600, height: 400 },
		category: 'analysis',
	},
	{
		id: 'file-browser',
		title: 'File Browser',
		description: 'Browse and select files from your system',
		icon: FileText,
		type: 'file-browser',
		defaultSize: { width: 320, height: 350 },
		minSize: { width: 240, height: 280 },
		maxSize: { width: 600, height: 600 },
		category: 'utility',
	},
	{
		id: 'dda-form',
		title: 'DDA Form',
		description: 'Dynamic Data Analysis form for data processing',
		icon: Settings,
		type: 'dda-form',
		defaultSize: { width: 320, height: 350 },
		minSize: { width: 240, height: 280 },
		maxSize: { width: 600, height: 600 },
		category: 'analysis',
	},
	{
		id: 'dda-heatmap',
		title: 'DDA Heatmap',
		description: 'Heatmap visualization for data analysis',
		icon: Activity,
		type: 'dda-heatmap',
		defaultSize: { width: 350, height: 260 },
		minSize: { width: 280, height: 180 },
		maxSize: { width: 800, height: 600 },
		category: 'visualization',
	},
	{
		id: 'dda-line-plot',
		title: 'DDA Line Plot',
		description: 'Line plot visualization for time series data',
		icon: TrendingUp,
		type: 'dda-line-plot',
		defaultSize: { width: 350, height: 260 },
		minSize: { width: 280, height: 180 },
		maxSize: { width: 800, height: 600 },
		category: 'visualization',
	},
];

const categoryLabels = {
	data: 'Data',
	visualization: 'Visualization',
	analysis: 'Analysis',
	utility: 'Utility',
};

const categoryColors = {
	data: 'bg-blue-100 text-blue-800',
	visualization: 'bg-green-100 text-green-800',
	analysis: 'bg-purple-100 text-purple-800',
	utility: 'bg-gray-100 text-gray-800',
};

export function AddWidgetDialog({
	open,
	onOpenChange,
	onAddWidget,
	trigger,
}: AddWidgetDialogProps) {
	const [selectedWidget, setSelectedWidget] = useState<WidgetType | null>(null);

	const handleAddWidget = () => {
		if (selectedWidget) {
			onAddWidget(selectedWidget);
			setSelectedWidget(null);
			onOpenChange(false);
		}
	};

	const handleCancel = () => {
		setSelectedWidget(null);
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className="sm:max-w-[600px] max-h-[80vh]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Plus className="h-5 w-5" />
						Add Widget to Dashboard
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="text-sm text-muted-foreground">
						Select a widget type to add to your dashboard. Widgets can be dragged,
						resized, and customized after being added.
					</div>

					<ScrollArea className="max-h-[400px]">
						<div className="grid gap-3">
							{availableWidgetTypes.map((widgetType) => (
								<div
									key={widgetType.id}
									className={cn(
										'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:bg-accent hover:border-accent-foreground',
										selectedWidget?.id === widgetType.id &&
										'bg-accent border-accent-foreground'
									)}
									onClick={() => setSelectedWidget(widgetType)}
								>
									<div className="flex-shrink-0">
										<widgetType.icon className="h-8 w-8 text-muted-foreground" />
									</div>

									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2 mb-1">
											<h3 className="font-medium text-sm truncate">
												{widgetType.title}
											</h3>
											<Badge
												variant="secondary"
												className={cn(
													'text-xs',
													categoryColors[widgetType.category]
												)}
											>
												{categoryLabels[widgetType.category]}
											</Badge>
										</div>
										<p className="text-xs text-muted-foreground line-clamp-2">
											{widgetType.description}
										</p>
									</div>

									<div className="flex-shrink-0 text-xs text-muted-foreground">
										{widgetType.defaultSize.width}×{widgetType.defaultSize.height}
									</div>
								</div>
							))}
						</div>
					</ScrollArea>

					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button variant="outline" onClick={handleCancel}>
							Cancel
						</Button>
						<Button
							onClick={handleAddWidget}
							disabled={!selectedWidget}
						>
							<Plus className="h-4 w-4 mr-2" />
							Add Widget
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
} 