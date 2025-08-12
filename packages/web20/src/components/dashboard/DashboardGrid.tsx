'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAppDispatch, useWidgets, useSelectedWidgetId, useIsDragging, useIsResizing, useDragState, useResizeState } from '@/store/hooks';
import { setSelectedWidget, moveWidget, setDragState, setResizeState, setIsDragging, setIsResizing, resizeWidget } from '@/store/slices/dashboardSlice';
import { Widget, Rectangle, DragState, ResizeState } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { WidgetComponent } from './WidgetComponent';

// Collision detection utility
class CollisionDetector {
	static checkOverlap(rect1: Rectangle, rect2: Rectangle): boolean {
		return !(
			rect1.x + rect1.width <= rect2.x ||
			rect2.x + rect2.width <= rect1.x ||
			rect1.y + rect1.height <= rect2.y ||
			rect2.y + rect2.height <= rect1.y
		);
	}

	static findNearestDockPosition(
		draggedWidget: Rectangle,
		otherWidgets: Rectangle[],
		containerBounds: Rectangle,
		tolerance: number = 20
	): Rectangle {
		let bestPosition = { ...draggedWidget };
		let minDistance = Infinity;

		otherWidgets.forEach(other => {
			const dockPositions = [
				{ x: other.x - draggedWidget.width - 10, y: other.y },
				{ x: other.x + other.width + 10, y: other.y },
				{ x: other.x, y: other.y - draggedWidget.height - 10 },
				{ x: other.x, y: other.y + other.height + 10 },
			];

			dockPositions.forEach(pos => {
				if (
					pos.x >= 0 &&
					pos.y >= 0 &&
					pos.x + draggedWidget.width <= containerBounds.width &&
					pos.y + draggedWidget.height <= containerBounds.height
				) {
					const distance = Math.sqrt(
						Math.pow(pos.x - draggedWidget.x, 2) +
						Math.pow(pos.y - draggedWidget.y, 2)
					);

					if (distance < minDistance && distance <= tolerance) {
						const testRect = { ...draggedWidget, x: pos.x, y: pos.y };
						const hasOverlap = otherWidgets.some(w =>
							w !== other && CollisionDetector.checkOverlap(testRect, w)
						);

						if (!hasOverlap) {
							minDistance = distance;
							bestPosition = { ...draggedWidget, x: pos.x, y: pos.y };
						}
					}
				}
			});
		});

		return bestPosition;
	}
}

// Snap guide utility
class SnapGuide {
	static findAlignmentGuides(
		draggedWidget: Rectangle,
		otherWidgets: Rectangle[],
		tolerance: number = 10
	): { x?: number; y?: number; snapX?: number; snapY?: number } {
		const guides: { x?: number; y?: number; snapX?: number; snapY?: number } = {};

		otherWidgets.forEach(other => {
			// Vertical alignment
			if (Math.abs(draggedWidget.x - other.x) <= tolerance) {
				guides.x = other.x;
				guides.snapX = other.x;
			}
			if (Math.abs(draggedWidget.x + draggedWidget.width - other.x - other.width) <= tolerance) {
				guides.x = other.x + other.width - draggedWidget.width;
				guides.snapX = other.x + other.width - draggedWidget.width;
			}

			// Horizontal alignment
			if (Math.abs(draggedWidget.y - other.y) <= tolerance) {
				guides.y = other.y;
				guides.snapY = other.y;
			}
			if (Math.abs(draggedWidget.y + draggedWidget.height - other.y - other.height) <= tolerance) {
				guides.y = other.y + other.height - draggedWidget.height;
				guides.snapY = other.y + other.height - draggedWidget.height;
			}
		});

		return guides;
	}
}

interface DashboardGridProps {
	className?: string;
	gridSize?: number;
	enableSnapping?: boolean;
	enableCollisionDetection?: boolean;
}

export function DashboardGrid({
	className,
	gridSize = 10,
	enableSnapping = true,
	enableCollisionDetection = true,
}: DashboardGridProps) {
	const dispatch = useAppDispatch();
	const widgets = useWidgets();
	const selectedWidgetId = useSelectedWidgetId();
	const isDragging = useIsDragging();
	const isResizing = useIsResizing();
	const dragState = useDragState();
	const resizeState = useResizeState();

	const containerRef = useRef<HTMLDivElement>(null);
	const [containerBounds, setContainerBounds] = useState<Rectangle>({ x: 0, y: 0, width: 0, height: 0 });
	const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
	const [isGlobalLoading, setIsGlobalLoading] = useState(false);

	// Update container bounds
	useEffect(() => {
		const updateBounds = () => {
			if (containerRef.current) {
				const rect = containerRef.current.getBoundingClientRect();
				const bounds = {
					x: 0,
					y: 0,
					width: rect.width,
					height: rect.height,
				};
				setContainerBounds(bounds);
			}
		};

		updateBounds();
		window.addEventListener('resize', updateBounds);
		return () => window.removeEventListener('resize', updateBounds);
	}, []);

	// Handle mouse down for dragging
	const handleMouseDown = useCallback((e: React.MouseEvent, widgetId: string) => {
		e.preventDefault();
		e.stopPropagation();

		const widget = widgets.find(w => w.id === widgetId);
		if (!widget) return;

		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return;

		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		dispatch(setDragState({
			widgetId,
			startPosition: { ...widget.position },
			currentPosition: { ...widget.position },
			mouseStart: { x: mouseX, y: mouseY },
		}));

		dispatch(setIsDragging(true));
		dispatch(setSelectedWidget(widgetId));
	}, [widgets, dispatch]);

	// Handle mouse move for dragging
	const handleMouseMove = useCallback((e: MouseEvent) => {
		// Handle resizing first
		if (isResizing && resizeState && containerRef.current) {
			const { widgetId, startSize, mouseStart, resizeHandle } = resizeState;
			const widget = widgets.find(w => w.id === widgetId);
			if (!widget) return;

			const deltaX = e.clientX - mouseStart.x;
			const deltaY = e.clientY - mouseStart.y;

			let newWidth = startSize.width + deltaX * (resizeHandle.includes('e') ? 1 : resizeHandle.includes('w') ? -1 : 1);
			let newHeight = startSize.height + deltaY * (resizeHandle.includes('s') ? 1 : resizeHandle.includes('n') ? -1 : 1);

			const minWidth = widget.minSize?.width || 200;
			const minHeight = widget.minSize?.height || 150;
			const maxWidth = widget.maxSize?.width || containerBounds.width;
			const maxHeight = widget.maxSize?.height || containerBounds.height;

			newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
			newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

			// Grid snapping
			if (enableSnapping) {
				newWidth = Math.round(newWidth / gridSize) * gridSize;
				newHeight = Math.round(newHeight / gridSize) * gridSize;
			}

			dispatch(setResizeState({ ...resizeState, currentSize: { width: newWidth, height: newHeight } }));
			dispatch(resizeWidget({ id: widgetId, size: { width: newWidth, height: newHeight } }));
			return;
		}

		// Then handle dragging
		if (!isDragging || !dragState || !containerRef.current) return;

		const rect = containerRef.current.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const deltaX = mouseX - dragState.mouseStart.x;
		const deltaY = mouseY - dragState.mouseStart.y;

		let newX = dragState.startPosition.x + deltaX;
		let newY = dragState.startPosition.y + deltaY;

		// Get the widget being dragged
		const draggedWidget = widgets.find(w => w.id === dragState.widgetId);
		if (!draggedWidget) return;

		// Boundary constraints - prevent widgets from going outside container
		const minX = 0;
		const minY = 0;
		const maxX = containerBounds.width - draggedWidget.size.width;
		const maxY = containerBounds.height - draggedWidget.size.height;

		// Clamp position to container bounds
		newX = Math.max(minX, Math.min(maxX, newX));
		newY = Math.max(minY, Math.min(maxY, newY));

		// Grid snapping
		if (enableSnapping) {
			newX = Math.round(newX / gridSize) * gridSize;
			newY = Math.round(newY / gridSize) * gridSize;

			// Re-clamp after snapping to ensure we stay within bounds
			newX = Math.max(minX, Math.min(maxX, newX));
			newY = Math.max(minY, Math.min(maxY, newY));
		}

		// Collision detection
		if (enableCollisionDetection) {
			const draggedRect: Rectangle = {
				x: newX,
				y: newY,
				width: draggedWidget.size.width,
				height: draggedWidget.size.height,
			};

			const otherWidgets = widgets
				.filter(w => w.id !== dragState.widgetId)
				.map(w => ({
					x: w.position.x,
					y: w.position.y,
					width: w.size.width,
					height: w.size.height,
				}));

			const dockPosition = CollisionDetector.findNearestDockPosition(
				draggedRect,
				otherWidgets,
				containerBounds
			);

			// Ensure dock position is also within bounds
			newX = Math.max(minX, Math.min(maxX, dockPosition.x));
			newY = Math.max(minY, Math.min(maxY, dockPosition.y));
		}

		// Snap guides
		if (enableSnapping) {
			const draggedRect: Rectangle = {
				x: newX,
				y: newY,
				width: draggedWidget.size.width,
				height: draggedWidget.size.height,
			};

			const otherWidgets = widgets
				.filter(w => w.id !== dragState.widgetId)
				.map(w => ({
					x: w.position.x,
					y: w.position.y,
					width: w.size.width,
					height: w.size.height,
				}));

			const guides = SnapGuide.findAlignmentGuides(draggedRect, otherWidgets);
			setSnapGuides(guides);

			if (guides.snapX !== undefined) {
				newX = guides.snapX;
				newX = Math.max(minX, Math.min(maxX, newX)); // Re-clamp after snapping
			}
			if (guides.snapY !== undefined) {
				newY = guides.snapY;
				newY = Math.max(minY, Math.min(maxY, newY)); // Re-clamp after snapping
			}
		}

		// Update drag state
		dispatch(setDragState({
			...dragState,
			currentPosition: { x: newX, y: newY },
		}));

		// Update widget position
		dispatch(moveWidget({ id: dragState.widgetId, position: { x: newX, y: newY } }));
	}, [isDragging, isResizing, dragState, resizeState, widgets, enableSnapping, enableCollisionDetection, gridSize, containerBounds, dispatch]);

	// Handle mouse up
	const handleMouseUp = useCallback(() => {
		if (isDragging) {
			dispatch(setIsDragging(false));
			dispatch(setDragState(null));
			setSnapGuides({});
		}
		if (isResizing) {
			dispatch(setIsResizing(false));
			dispatch(setResizeState(null));
		}
	}, [isDragging, isResizing, dispatch]);

	// Add global mouse event listeners
	useEffect(() => {
		if (isDragging || isResizing) {
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			return () => {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};
		}
	}, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

	// Listen for EDF loading lifecycle events published by WidgetComponent
	useEffect(() => {
		const onStart = () => setIsGlobalLoading(true);
		const onDone = () => setIsGlobalLoading(false);
		window.addEventListener('dda:loading-start', onStart as EventListener);
		window.addEventListener('dda:edf-loaded', onDone as EventListener);
		window.addEventListener('dda:loading-error', onDone as EventListener);
		return () => {
			window.removeEventListener('dda:loading-start', onStart as EventListener);
			window.removeEventListener('dda:edf-loaded', onDone as EventListener);
			window.removeEventListener('dda:loading-error', onDone as EventListener);
		};
	}, []);

	// Handle container click to deselect
	const handleContainerClick = useCallback((e: React.MouseEvent) => {
		if (e.target === e.currentTarget) {
			dispatch(setSelectedWidget(null));
		}
	}, [dispatch]);

	return (
		<div
			ref={containerRef}
			className={cn(
				'relative w-full h-full bg-background overflow-hidden',
				className
			)}
			onClick={handleContainerClick}
		>
			{/* Global loading overlay */}
			{isGlobalLoading && (
				<div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
						Loading EDF data...
					</div>
				</div>
			)}
			{/* Grid background */}
			<div className="absolute inset-0 opacity-5">
				<svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
					<defs>
						<pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
							<path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="currentColor" strokeWidth="0.5" />
						</pattern>
					</defs>
					<rect width="100%" height="100%" fill="url(#grid)" />
				</svg>
			</div>

			{/* Snap guides */}
			{enableSnapping && (snapGuides.x !== undefined || snapGuides.y !== undefined) && (
				<>
					{snapGuides.x !== undefined && (
						<div
							className="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10"
							style={{ left: snapGuides.x }}
						/>
					)}
					{snapGuides.y !== undefined && (
						<div
							className="absolute left-0 right-0 h-0.5 bg-blue-500 z-10"
							style={{ top: snapGuides.y }}
						/>
					)}
				</>
			)}

			{/* Widgets */}
			{widgets.map((widget) => {
				return (
					<WidgetComponent
						key={widget.id}
						widget={widget}
						isSelected={selectedWidgetId === widget.id}
						onMouseDown={handleMouseDown}
						onSelect={() => dispatch(setSelectedWidget(widget.id))}
					/>
				);
			})}
		</div>
	);
} 