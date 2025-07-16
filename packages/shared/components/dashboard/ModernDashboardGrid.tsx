"use client";

import React, { useMemo, useCallback } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { cn } from '../../lib/utils/misc';
import { IDashboardWidget, IDashboardConfig, IDashboardEvents } from '../../types/dashboard';
import { ModernWidgetContainer } from './ModernWidgetContainer';
import { X, Maximize2, Minimize2, Check, X as XIcon } from 'lucide-react';

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
	onBreakpointChange?: (breakpoint: string, cols: number) => void;
	className?: string;
	isLoading?: boolean;
	isSaving?: boolean;
	saveStatus?: 'idle' | 'saving' | 'success' | 'error';
}

// Save status indicator component
interface SaveIndicatorProps {
	status: 'idle' | 'saving' | 'success' | 'error';
}

function SaveIndicator({ status }: SaveIndicatorProps) {
	if (status === 'idle') return null;

	const getIndicatorContent = () => {
		switch (status) {
			case 'saving':
				return (
					<div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-200 border-t-blue-600" />
				);
			case 'success':
				return (
					<div className="rounded-full h-6 w-6 bg-green-500 flex items-center justify-center animate-in zoom-in-75 duration-300">
						<Check className="h-3 w-3 text-white" />
					</div>
				);
			case 'error':
				return (
					<div className="rounded-full h-6 w-6 bg-red-500 flex items-center justify-center animate-in zoom-in-75 duration-300">
						<XIcon className="h-3 w-3 text-white" />
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<div className="absolute bottom-4 right-4 z-[120] bg-background/80 backdrop-blur-sm border border-border rounded-lg p-2 shadow-lg">
			{getIndicatorContent()}
		</div>
	);
}

export function ModernDashboardGrid({
	widgets,
	layout,
	config,
	events,
	onLayoutChange,
	onWidgetRemove,
	onWidgetUpdate,
	onBreakpointChange,
	className,
	isLoading = false,
	isSaving = false,
	saveStatus = 'idle',
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
	}, [onLayoutChange]);

	// Handle breakpoint change
	const handleBreakpointChange = useCallback((breakpoint: string, cols: number) => {
		onBreakpointChange?.(breakpoint, cols);
	}, [onBreakpointChange]);

	// Handle widget actions
	const handleWidgetRemove = useCallback((widgetId: string) => {
		onWidgetRemove?.(widgetId);
	}, [onWidgetRemove]);

	const handleWidgetUpdate = useCallback((widgetId: string, updates: Partial<IDashboardWidget>) => {
		onWidgetUpdate?.(widgetId, updates);
	}, [onWidgetUpdate]);

	// Cleanup effect to ensure text selection is restored if operations are interrupted
	React.useEffect(() => {
		const handleWindowBlur = () => {
			// Restore text selection if window loses focus during drag/resize
			document.body.style.userSelect = '';
			document.body.style.webkitUserSelect = '';
			document.body.style.cursor = '';
		};

		const handleVisibilityChange = () => {
			// Restore text selection if page becomes hidden during drag/resize
			if (document.hidden) {
				document.body.style.userSelect = '';
				document.body.style.webkitUserSelect = '';
				document.body.style.cursor = '';
			}
		};

		window.addEventListener('blur', handleWindowBlur);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			window.removeEventListener('blur', handleWindowBlur);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			// Ensure cleanup on unmount
			document.body.style.userSelect = '';
			document.body.style.webkitUserSelect = '';
			document.body.style.cursor = '';
		};
	}, []);

	// Handle drag start
	const handleDragStart = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Prevent text selection during drag
		document.body.style.userSelect = 'none';
		document.body.style.webkitUserSelect = 'none';
		document.body.style.cursor = 'move';

		// Add visual feedback
		element.style.zIndex = '1000';
		element.style.transform = 'rotate(2deg) scale(1.02)';
		element.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.15)';
	}, []);

	// Handle drag stop
	const handleDragStop = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Restore text selection and cursor
		document.body.style.userSelect = '';
		document.body.style.webkitUserSelect = '';
		document.body.style.cursor = '';

		// Remove visual feedback
		element.style.zIndex = '';
		element.style.transform = '';
		element.style.boxShadow = '';
	}, []);

	// Handle resize start
	const handleResizeStart = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Prevent text selection during resize
		document.body.style.userSelect = 'none';
		document.body.style.webkitUserSelect = 'none';
		document.body.style.cursor = 'se-resize';

		// Add visual feedback
		element.style.zIndex = '1000';
		element.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.1)';
	}, []);

	// Handle resize stop
	const handleResizeStop = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, e: MouseEvent, element: HTMLElement) => {
		// Restore text selection and cursor
		document.body.style.userSelect = '';
		document.body.style.webkitUserSelect = '';
		document.body.style.cursor = '';

		// Remove visual feedback
		element.style.zIndex = '';
		element.style.boxShadow = '';
	}, []);

	return (
		<div className={cn("modern-dashboard-grid relative h-full w-full", className)}>
			{/* Loading overlay */}
			{isLoading && (
				<div className="absolute inset-0 z-[150] flex items-center justify-center bg-background/80 backdrop-blur-sm">
					<div className="text-center">
						<div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
						<p className="text-sm text-muted-foreground">Loading layout...</p>
					</div>
				</div>
			)}

			<ResponsiveGridLayout
				className="layout w-full"
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
				resizeHandles={["se"]}
				draggableHandle=".drag-handle"
			>
				{/* Only render widgets that are not popped out */}
				{widgets.filter(widget => !widget.metadata?.isPopout).map((widget) => (
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
				.modern-dashboard-grid :global(.react-grid-layout) {
					width: 100% !important;
					min-width: 100% !important;
				}

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
					content: "";
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
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				.modern-dashboard-grid :global(.react-grid-item.resizing) {
					z-index: 110 !important;
					box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1) !important;
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				/* Prevent text selection during any grid operations */
				.modern-dashboard-grid :global(.react-grid-layout.react-draggable-dragging) {
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				.modern-dashboard-grid :global(.react-grid-layout.react-resizable-resizing) {
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				/* Prevent text selection on drag handles and widget headers */
				.modern-dashboard-grid :global(.drag-handle) {
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				.modern-dashboard-grid :global(.react-resizable-handle) {
					user-select: none !important;
					-webkit-user-select: none !important;
					-moz-user-select: none !important;
					-ms-user-select: none !important;
				}

				/* Ensure dropdowns and overlays stay above grid items */
				.modern-dashboard-grid :global([data-radix-popper-content-wrapper]) {
					z-index: 200 !important;
				}
			`}</style>

			{/* Save indicator */}
			<SaveIndicator status={saveStatus} />
		</div>
	);
}
