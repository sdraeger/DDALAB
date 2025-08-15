import React from 'react';
import { WidgetType } from '@/components/dialog/AddWidgetDialog';
import { Widget } from '@/types/dashboard';
import { generateId } from '@/lib/utils';

import {
	FileBrowserWidget,
	DDAWidget,
	ChartWidget,
	DDAHeatmapWidget,
	DDALinePlotWidget
} from '@/components/widgets';

export function createWidgetContent(
	type: string,
	widgetId?: string,
	isPopout?: boolean,
	onFileSelect?: (filePath: string) => void,
	widgetData?: any
): React.ReactNode {
	switch (type) {
		case 'file-browser':
			return <FileBrowserWidget onFileSelect={onFileSelect} maxHeight="100%" />;

		case 'dda-form':
			return <DDAWidget widgetId={widgetId} isPopout={isPopout} />;

		case 'chart':
			return <ChartWidget widgetId={widgetId} isPopout={isPopout} />;

		case 'dda-heatmap':
			return <DDAHeatmapWidget widgetId={widgetId} isPopout={isPopout} widgetData={widgetData} />;

		case 'dda-line-plot':
			return <DDALinePlotWidget widgetId={widgetId} isPopout={isPopout} widgetData={widgetData} />;

		case 'table':
			return (
				<div className="flex items-center justify-center h-full">
					<div className="text-center text-muted-foreground">
						<div className="h-8 w-8 mx-auto mb-2 bg-muted rounded flex items-center justify-center">
							<span className="text-xs font-medium">TBL</span>
						</div>
						<p className="text-sm">Data Table Widget</p>
						<p className="text-xs">Table functionality coming soon</p>
					</div>
				</div>
			);

		case 'metrics':
			return (
				<div className="flex items-center justify-center h-full">
					<div className="text-center text-muted-foreground">
						<div className="h-8 w-8 mx-auto mb-2 bg-muted rounded flex items-center justify-center">
							<span className="text-xs font-medium">MET</span>
						</div>
						<p className="text-sm">Metrics Widget</p>
						<p className="text-xs">Metrics functionality coming soon</p>
					</div>
				</div>
			);

		default:
			return (
				<div className="flex items-center justify-center h-full">
					<div className="text-center text-muted-foreground">
						<div className="h-8 w-8 mx-auto mb-2 bg-muted rounded flex items-center justify-center">
							<span className="text-xs font-medium">?</span>
						</div>
						<p className="text-sm">Unknown Widget</p>
						<p className="text-xs">Widget type not supported</p>
					</div>
				</div>
			);
	}
}

export function createWidgetFromType(widgetType: WidgetType): Widget {
	const widgetId = generateId();

	return {
		id: widgetId,
		title: widgetType.title,
		type: widgetType.type,
		position: { x: 20, y: 20 }, // Default position
		size: widgetType.defaultSize,
		minSize: widgetType.minSize,
		maxSize: widgetType.maxSize,
		isPopOut: false,
		isMinimized: false,
		isMaximized: false,
		data: null,
		settings: {},
	};
} 