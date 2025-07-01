"use client";

import React, { useMemo, useCallback } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { cn } from '../../lib/utils/misc';
import { IDashboardWidget, IDashboardConfig, IDashboardEvents } from '../../types/dashboard';
import { ModernWidgetContainer } from './ModernWidgetContainer';
import { X, Maximize2, Minimize2 } from 'lucide-react';

// CSS imports for react-grid-layout
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ModernDashboardGridProps {
	widgets: IDashboardWidget[];
	layout: Layout[];
	config: IDashboardConfig;
	events?: IDashboardEvents;
	onLayoutChange?: (layout: Layout[]) => void;
	onWidgetRemove?: (widgetId: string) => void;
	onWidgetUpdate?: (widgetId: string, updates: Partial<IDashboardWidget>) => void;
	className?: string;
	isLoading?: boolean;
	isSaving?: boolean;
}

export function ModernDashboardGrid({
	widgets,
	layout,
	config,
	events,
	onLayoutChange,
	onWidgetRemove,
	onWidgetUpdate,
	className,
	isLoading = false,
	isSaving = false,
}: ModernDashboardGridProps) {

	// Create layouts object for responsive grid
	const layouts = useMemo(() => ({
		lg: layout,
		md: layout,
		sm: layout,
		xs: layout,
		xxs: layout,
	}), [layout]);

	// Validate layout is properly applied and log size information
	React.useEffect(() => {
		if (layout.length > 0) {
			const layoutInfo = layout.map(item => ({
				id: item.i,
				size: `${item.w}x${item.h}`,
				position: `(${item.x},${item.y})`,
				constraints: {
					minW: item.minW,
					maxW: item.maxW,
					minH: item.minH,
					maxH: item.maxH
				}
			}));

			console.log('ModernDashboardGrid: Layout applied with widget sizes:', {
				totalWidgets: widgets.length,
				totalLayoutItems: layout.length,
				layoutDetails: layoutInfo
			});
		}
	}, [layout, widgets.length]);

	// Handle layout change
	const handleLayoutChange = useCallback((currentLayout: Layout[], allLayouts: { [key: string]: Layout[] }) => {
		// Use the layout for the current breakpoint
		onLayoutChange?.(currentLayout);
		events?.onLayoutChange?.(currentLayout);
	}, [onLayoutChange, events]);

	// Handle breakpoint change
	const handleBreakpointChange = useCallback((breakpoint: string, cols: number) => {
		events?.onBreakpointChange?.(breakpoint, cols);
	}, [events]);

	// Handle widget actions
	const handleWidgetRemove = useCallback((widgetId: string) => {
		onWidgetRemove?.(widgetId);
		events?.onWidgetRemove?.(widgetId);
	}, [onWidgetRemove, events]);

	const handleWidgetUpdate = useCallback((widgetId: string, updates: Partial<IDashboardWidget>) => {
		onWidgetUpdate?.(widgetId, updates);
		events?.onWidgetUpdate?.(widgetId, updates);
	}, [onWidgetUpdate, events]);

	// Handle drag start
	const handleDragStart = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Add visual feedback
		element.style.zIndex = '1000';
		element.style.transform = 'rotate(2deg) scale(1.02)';
		element.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.15)';
	}, []);

	// Handle drag stop
	const handleDragStop = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Remove visual feedback
		element.style.zIndex = '';
		element.style.transform = '';
		element.style.boxShadow = '';
	}, []);

	// Handle resize start
	const handleResizeStart = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Add visual feedback
		element.style.zIndex = '1000';
		element.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.1)';
	}, []);

	// Handle resize stop
	const handleResizeStop = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Remove visual feedback
		element.style.zIndex = '';
		element.style.boxShadow = '';
	}, []);

	return (
		<div className={cn('modern-dashboard-grid relative w-full h-full overflow-hidden', className)}>
			{/* Loading overlay */}
			{isLoading && (
				<div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-[150] flex items-center justify-center">
					<div className="text-center">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
						<p className="text-sm text-muted-foreground">Loading layout...</p>
					</div>
				</div>
			)}

			{/* Saving indicator */}
			{isSaving && (
				<div className="absolute top-4 right-4 bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm flex items-center gap-2 z-[120]">
					<div className="animate-spin rounded-full h-3 w-3 border-b border-primary-foreground" />
					Auto-saving...
				</div>
			)}

			<ResponsiveGridLayout
				className="layout"
				layouts={layouts}
				breakpoints={config.breakpoints}
				cols={config.cols}
				rowHeight={config.rowHeight}
				margin={config.margin}
				containerPadding={config.containerPadding}
				onLayoutChange={handleLayoutChange}
				onBreakpointChange={handleBreakpointChange}
				onDragStart={handleDragStart}
				onDragStop={handleDragStop}
				onResizeStart={handleResizeStart}
				onResizeStop={handleResizeStop}
				isDraggable={true}
				isResizable={true}
				preventCollision={false}
				compactType="vertical"
				useCSSTransforms={true}
				resizeHandles={['se']}
				draggableHandle=".drag-handle"
			>
				{widgets.map((widget) => (
					<div key={widget.id} className="modern-widget-item">
						<ModernWidgetContainer
							widget={widget}
							onRemove={() => handleWidgetRemove(widget.id)}
							onUpdate={(updates: Partial<IDashboardWidget>) => handleWidgetUpdate(widget.id, updates)}
						/>
					</div>
				))}
			</ResponsiveGridLayout>

			{/* Custom styles for smooth animations with proper z-index management */}
			<style jsx>{`
        .modern-dashboard-grid :global(.react-grid-item) {
          transition: transform 200ms ease, box-shadow 200ms ease;
          border-radius: 8px;
          overflow: hidden;
          z-index: 10;
        }

        .modern-dashboard-grid :global(.react-grid-item:hover) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 20;
        }

        .modern-dashboard-grid :global(.react-grid-item.react-grid-placeholder) {
          background: rgba(var(--primary), 0.1) !important;
          border: 2px dashed rgba(var(--primary), 0.3) !important;
          border-radius: 8px !important;
          opacity: 0.8;
          z-index: 5;
        }

        .modern-dashboard-grid :global(.react-resizable-handle) {
          background-image: none !important;
          width: 20px !important;
          height: 20px !important;
          bottom: 3px !important;
          right: 3px !important;
          z-index: 30;
        }

        .modern-dashboard-grid :global(.react-resizable-handle::after) {
          content: '';
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 5px;
          height: 5px;
          border-right: 2px solid rgba(var(--border));
          border-bottom: 2px solid rgba(var(--border));
          transition: all 200ms ease;
        }

        .modern-dashboard-grid :global(.react-resizable-handle:hover::after) {
          border-color: rgba(var(--primary));
          transform: scale(1.2);
        }

        .modern-dashboard-grid :global(.react-grid-item.dragging) {
          z-index: 110 !important;
          transform: rotate(2deg) scale(1.02) !important;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15) !important;
        }

        .modern-dashboard-grid :global(.react-grid-item.resizing) {
          z-index: 110 !important;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1) !important;
        }

        /* Ensure dropdowns and overlays stay above grid items */
        .modern-dashboard-grid :global([data-radix-popper-content-wrapper]) {
          z-index: 200 !important;
        }
      `}</style>
		</div>
	);
}
