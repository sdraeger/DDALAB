"use client";

import React, { useCallback } from 'react';
import { cn } from '../../lib/utils/misc';
import { Button } from '../ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
	Plus,
	FolderOpen,
	BarChart3,
	Zap,
	TrendingUp,
	Activity,
	Settings,
	Sparkles,
} from 'lucide-react';
import { WidgetFactoryService } from '../../services/WidgetFactoryService';

interface ModernDashboardToolbarProps {
	onAddWidget: (type: string, config?: any) => void;
	className?: string;
}

// Widget type definitions with icons and descriptions
const WIDGET_TYPES = [
	{
		type: 'file-browser',
		label: 'File Browser',
		description: 'Browse and select EDF files',
		icon: FolderOpen,
		category: 'Files',
	},
	{
		type: 'dda-form',
		label: 'DDA Form',
		description: 'Configure and run DDA',
		icon: Zap,
		category: 'Analysis',
	},
	{
		type: 'chart',
		label: 'Data Chart',
		description: 'General purpose data visualization',
		icon: BarChart3,
		category: 'Visualization',
	},
	{
		type: 'dda-heatmap',
		label: 'DDA Heatmap',
		description: 'Interactive DDA matrix heatmap',
		icon: Activity,
		category: 'Visualization',
	},
	{
		type: 'dda-line-plot',
		label: 'DDA Line Plot',
		description: 'Line plot visualization of DDA data',
		icon: TrendingUp,
		category: 'Visualization',
	},
];

export function ModernDashboardToolbar({
	onAddWidget,
	className,
}: ModernDashboardToolbarProps) {
	const widgetFactory = WidgetFactoryService.getInstance();

	const handleAddWidget = useCallback((type: string) => {
		onAddWidget(type);
	}, [onAddWidget]);

	// Group widgets by category
	const categorizedWidgets = WIDGET_TYPES.reduce((acc, widget) => {
		if (!acc[widget.category]) {
			acc[widget.category] = [];
		}
		acc[widget.category].push(widget);
		return acc;
	}, {} as Record<string, typeof WIDGET_TYPES>);

	return (
		<div className={cn('modern-dashboard-toolbar flex items-center gap-2', className)}>
			{/* Add Widget Dropdown */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" className="gap-2">
						<Plus className="h-4 w-4" />
						Add Widget
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-64 z-[200]"
					sideOffset={8}
					onCloseAutoFocus={(e) => e.preventDefault()}
				>
					{Object.entries(categorizedWidgets).map(([category, widgets]) => (
						<div key={category}>
							<div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
								{category}
							</div>
							{widgets.map((widget) => {
								const IconComponent = widget.icon;
								return (
									<DropdownMenuItem
										key={widget.type}
										onClick={() => handleAddWidget(widget.type)}
										className="flex items-start gap-3 py-3 px-3 cursor-pointer"
									>
										<div className="flex-shrink-0 mt-0.5">
											<IconComponent className="h-4 w-4 text-primary" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="font-medium text-sm">{widget.label}</div>
											<div className="text-xs text-muted-foreground mt-0.5">
												{widget.description}
											</div>
										</div>
									</DropdownMenuItem>
								);
							})}
							<DropdownMenuSeparator />
						</div>
					))}

					{/* Custom Widget Option */}
					<DropdownMenuItem
						onClick={() => handleAddWidget('custom')}
						className="flex items-start gap-3 py-3 px-3 cursor-pointer"
					>
						<div className="flex-shrink-0 mt-0.5">
							<Settings className="h-4 w-4 text-primary" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="font-medium text-sm">Custom Widget</div>
							<div className="text-xs text-muted-foreground mt-0.5">
								Create a custom widget placeholder
							</div>
						</div>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Quick Add Buttons for Common Widgets */}
			<div className="flex items-center gap-1 ml-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => handleAddWidget('file-browser')}
					className="gap-1.5"
					title="Add File Browser"
				>
					<FolderOpen className="h-3.5 w-3.5" />
					<span className="hidden sm:inline">Files</span>
				</Button>

				<Button
					variant="ghost"
					size="sm"
					onClick={() => handleAddWidget('dda-form')}
					className="gap-1.5"
					title="Add DDA Form"
				>
					<Zap className="h-3.5 w-3.5" />
					<span className="hidden sm:inline">DDA</span>
				</Button>

				<Button
					variant="ghost"
					size="sm"
					onClick={() => handleAddWidget('chart')}
					className="gap-1.5"
					title="Add Chart"
				>
					<BarChart3 className="h-3.5 w-3.5" />
					<span className="hidden sm:inline">Chart</span>
				</Button>
			</div>

			{/* Info Text */}
			<div className="hidden lg:flex items-center gap-2 ml-auto text-xs text-muted-foreground">
				<Sparkles className="h-3.5 w-3.5" />
				<span>Drag widgets to rearrange • Resize from bottom-right corner</span>
			</div>
		</div>
	);
}
