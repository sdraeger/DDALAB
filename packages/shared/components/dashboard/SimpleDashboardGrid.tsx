"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "../../lib/utils/misc";

export interface SimpleWidget {
	id: string;
	title: string;
	content: React.ReactNode;
	position: { x: number; y: number };
	size: { width: number; height: number };
	minSize?: { width: number; height: number };
	maxSize?: { width: number; height: number };
	isPopOut?: boolean;
	type?: string; // Widget type for serialization
}

export interface SerializableWidget {
	id: string;
	title: string;
	position: { x: number; y: number };
	size: { width: number; height: number };
	minSize?: { width: number; height: number };
	maxSize?: { width: number; height: number };
	isPopOut?: boolean;
	type?: string;
}

interface SimpleDashboardGridProps {
	widgets: SimpleWidget[];
	onWidgetUpdate?: (id: string, updates: Partial<SimpleWidget>) => void;
	onWidgetRemove?: (id: string) => void;
	onWidgetPopOut?: (id: string) => void;
	onWidgetSwapIn?: (id: string) => void;
	className?: string;
	gridSize?: number;
	enableSnapping?: boolean;
	enableCollisionDetection?: boolean;
}

interface ResizePreview {
	x: number;
	y: number;
	width: number;
	height: number;
	visible: boolean;
}

// Helper function to check if two rectangles overlap
const rectanglesOverlap = (rect1: { x: number; y: number; width: number; height: number }, rect2: { x: number; y: number; width: number; height: number }) => {
	return !(rect1.x + rect1.width <= rect2.x ||
		rect2.x + rect2.width <= rect1.x ||
		rect1.y + rect1.height <= rect2.y ||
		rect2.y + rect2.height <= rect1.y);
};

// Helper function to snap to grid
const snapToGrid = (value: number, gridSize: number) => {
	return Math.round(value / gridSize) * gridSize;
};

// Helper function to find non-overlapping position
const findNonOverlappingPosition = (
	widget: { x: number; y: number; width: number; height: number },
	otherWidgets: { x: number; y: number; width: number; height: number }[],
	containerWidth: number,
	containerHeight: number
) => {
	let newX = widget.x;
	let newY = widget.y;

	// Try positions in expanding spiral pattern
	const maxAttempts = 50;
	let attempts = 0;

	while (attempts < maxAttempts) {
		const testWidget = { ...widget, x: newX, y: newY };

		// Check if this position overlaps with any other widget
		const hasOverlap = otherWidgets.some(other => rectanglesOverlap(testWidget, other));

		if (!hasOverlap && newX >= 0 && newY >= 0 &&
			newX + widget.width <= containerWidth &&
			newY + widget.height <= containerHeight) {
			return { x: newX, y: newY };
		}

		// Move in spiral pattern
		if (attempts % 4 === 0) newX += 20;
		else if (attempts % 4 === 1) newY += 20;
		else if (attempts % 4 === 2) newX -= 20;
		else newY -= 20;

		attempts++;
	}

	// If no non-overlapping position found, stack vertically
	const maxY = Math.max(0, ...otherWidgets.map(w => w.y + w.height));
	return { x: widget.x, y: maxY + 10 };
};

export function SimpleDashboardGrid({
	widgets,
	onWidgetUpdate,
	onWidgetRemove,
	onWidgetPopOut,
	onWidgetSwapIn,
	className,
	gridSize = 10,
	enableSnapping = false,
	enableCollisionDetection = false
}: SimpleDashboardGridProps) {
	const [dragging, setDragging] = useState<string | null>(null);
	const [resizing, setResizing] = useState<string | null>(null);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

	const [resizePreview, setResizePreview] = useState<ResizePreview>({ x: 0, y: 0, width: 0, height: 0, visible: false });
	const [alignmentGuides, setAlignmentGuides] = useState<{ x?: number; y?: number }>({});
	const containerRef = useRef<HTMLDivElement>(null);

	// Handle mouse move for dragging and resizing
	const handleMouseMove = useCallback((e: MouseEvent) => {
		if (dragging) {
			const deltaX = e.clientX - dragStart.x;
			const deltaY = e.clientY - dragStart.y;
			const widget = widgets.find(w => w.id === dragging);

			if (widget && containerRef.current && onWidgetUpdate) {
				const containerRect = containerRef.current.getBoundingClientRect();
				let newX = widget.position.x + deltaX;
				let newY = widget.position.y + deltaY;

				// Keep within container bounds
				newX = Math.max(0, Math.min(newX, containerRect.width - widget.size.width));
				newY = Math.max(0, Math.min(newY, containerRect.height - widget.size.height));

				// Check for edge alignment and push functionality
				const otherWidgets = widgets.filter(w => w.id !== dragging);
				const guides: { x?: number; y?: number } = {};
				const pushedWidgets: { id: string; position: { x: number; y: number } }[] = [];

				// Alignment detection with visual guides (always active for better UX)
				const tolerance = 10; // Reasonable snap distance

				// Find vertical alignment guides
				otherWidgets.forEach(other => {
					// Left edges align
					if (Math.abs(newX - other.position.x) < tolerance) {
						newX = other.position.x;
						guides.x = other.position.x;
					}
					// Right edge to left edge align
					else if (Math.abs(newX - (other.position.x + other.size.width)) < tolerance) {
						newX = other.position.x + other.size.width;
						guides.x = other.position.x + other.size.width;
					}
					// Left edge to right edge align
					else if (Math.abs(newX + widget.size.width - other.position.x) < tolerance) {
						newX = other.position.x - widget.size.width;
						guides.x = other.position.x;
					}
					// Right edges align
					else if (Math.abs(newX + widget.size.width - (other.position.x + other.size.width)) < tolerance) {
						newX = other.position.x + other.size.width - widget.size.width;
						guides.x = other.position.x;
					}
					// Center alignment
					else if (Math.abs(newX + widget.size.width / 2 - (other.position.x + other.size.width / 2)) < tolerance) {
						newX = other.position.x + (other.size.width - widget.size.width) / 2;
						guides.x = other.position.x + other.size.width / 2;
					}
				});

				// Find horizontal alignment guides
				otherWidgets.forEach(other => {
					// Top edges align
					if (Math.abs(newY - other.position.y) < tolerance) {
						newY = other.position.y;
						guides.y = other.position.y;
					}
					// Bottom edge to top edge align
					else if (Math.abs(newY - (other.position.y + other.size.height)) < tolerance) {
						newY = other.position.y + other.size.height;
						guides.y = other.position.y + other.size.height;
					}
					// Top edge to bottom edge align
					else if (Math.abs(newY + widget.size.height - other.position.y) < tolerance) {
						newY = other.position.y - widget.size.height;
						guides.y = other.position.y;
					}
					// Bottom edges align
					else if (Math.abs(newY + widget.size.height - (other.position.y + other.size.height)) < tolerance) {
						newY = other.position.y + other.size.height - widget.size.height;
						guides.y = other.position.y;
					}
					// Center alignment
					else if (Math.abs(newY + widget.size.height / 2 - (other.position.y + other.size.height / 2)) < tolerance) {
						newY = other.position.y + (other.size.height - widget.size.height) / 2;
						guides.y = other.position.y + other.size.height / 2;
					}
				});

				// Push functionality - check for overlaps and push other widgets
				const draggedRect = {
					x: newX,
					y: newY,
					width: widget.size.width,
					height: widget.size.height
				};

				otherWidgets.forEach(otherWidget => {
					const otherRect = {
						x: otherWidget.position.x,
						y: otherWidget.position.y,
						width: otherWidget.size.width,
						height: otherWidget.size.height
					};

					// Check for overlap and calculate push direction
					if (rectanglesOverlap(draggedRect, otherRect)) {
						// Calculate overlap areas in each direction
						const overlapLeft = draggedRect.x + draggedRect.width - otherRect.x;
						const overlapRight = otherRect.x + otherRect.width - draggedRect.x;
						const overlapTop = draggedRect.y + draggedRect.height - otherRect.y;
						const overlapBottom = otherRect.y + otherRect.height - draggedRect.y;

						// Find the direction with minimum overlap (easiest push direction)
						const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

						let newOtherX = otherRect.x;
						let newOtherY = otherRect.y;

						if (minOverlap === overlapLeft && overlapLeft > 0) {
							// Push left
							newOtherX = draggedRect.x - otherRect.width - 5;
						} else if (minOverlap === overlapRight && overlapRight > 0) {
							// Push right
							newOtherX = draggedRect.x + draggedRect.width + 5;
						} else if (minOverlap === overlapTop && overlapTop > 0) {
							// Push up
							newOtherY = draggedRect.y - otherRect.height - 5;
						} else if (minOverlap === overlapBottom && overlapBottom > 0) {
							// Push down
							newOtherY = draggedRect.y + draggedRect.height + 5;
						}

						// Ensure pushed widget stays within container bounds
						newOtherX = Math.max(0, Math.min(newOtherX, containerRect.width - otherRect.width));
						newOtherY = Math.max(0, Math.min(newOtherY, containerRect.height - otherRect.height));

						pushedWidgets.push({
							id: otherWidget.id,
							position: { x: newOtherX, y: newOtherY }
						});
					}
				});

				// Apply pushed widget positions immediately for real-time feedback
				pushedWidgets.forEach(({ id, position }) => {
					onWidgetUpdate(id, { position });
				});

				// Update alignment guides
				setAlignmentGuides(guides);

				// Move the dragged widget in real-time
				onWidgetUpdate(dragging, { position: { x: newX, y: newY } });

				setDragStart({ x: e.clientX, y: e.clientY });
			}
		}

		if (resizing) {
			const deltaX = e.clientX - resizeStart.x;
			const deltaY = e.clientY - resizeStart.y;
			const widget = widgets.find(w => w.id === resizing);

			if (widget && containerRef.current) {
				const containerRect = containerRef.current.getBoundingClientRect();
				let newWidth = resizeStart.width + deltaX;
				let newHeight = resizeStart.height + deltaY;

				// Apply size constraints
				newWidth = Math.max(
					widget.minSize?.width || 200,
					Math.min(
						widget.maxSize?.width || containerRect.width - widget.position.x,
						newWidth
					)
				);
				newHeight = Math.max(
					widget.minSize?.height || 150,
					Math.min(
						widget.maxSize?.height || containerRect.height - widget.position.y,
						newHeight
					)
				);

				// Update resize preview
				setResizePreview({
					x: widget.position.x,
					y: widget.position.y,
					width: newWidth,
					height: newHeight,
					visible: true
				});
			}
		}
	}, [dragging, resizing, dragStart, resizeStart, widgets, onWidgetUpdate]);

	// Handle mouse up to stop dragging/resizing
	const handleMouseUp = useCallback(() => {
		if (resizing && resizePreview.visible) {
			const widget = widgets.find(w => w.id === resizing);
			if (widget && onWidgetUpdate) {
				onWidgetUpdate(resizing, {
					size: {
						width: resizePreview.width,
						height: resizePreview.height
					}
				});
			}
		}

		// Clean up states
		setDragging(null);
		setResizing(null);
		setResizePreview(prev => ({ ...prev, visible: false }));
		setAlignmentGuides({});
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}, [resizing, resizePreview, widgets, onWidgetUpdate]);

	// Add global event listeners
	useEffect(() => {
		if (dragging || resizing) {
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			document.body.style.userSelect = 'none';

			if (resizing) {
				document.body.style.cursor = 'se-resize';
			} else if (dragging) {
				document.body.style.cursor = 'move';
			}

			return () => {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
			};
		}
	}, [dragging, resizing, handleMouseMove, handleMouseUp]);

	// Start dragging
	const handleDragStart = useCallback((widgetId: string, e: React.MouseEvent) => {
		e.preventDefault();
		setDragging(widgetId);
		setDragStart({ x: e.clientX, y: e.clientY });
	}, []);

	// Start resizing
	const handleResizeStart = useCallback((widgetId: string, e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		const widget = widgets.find(w => w.id === widgetId);
		if (widget) {
			setResizing(widgetId);
			setResizeStart({
				x: e.clientX,
				y: e.clientY,
				width: widget.size.width,
				height: widget.size.height
			});
			setResizePreview({
				x: widget.position.x,
				y: widget.position.y,
				width: widget.size.width,
				height: widget.size.height,
				visible: true
			});
		}
	}, [widgets]);

	return (
		<div
			ref={containerRef}
			className={cn("relative w-full h-full bg-muted/5", className)}
			style={{
				minHeight: 'calc(100vh - 200px)'
			}}
		>
			{/* Alignment Guides - Subtle and helpful */}
			{alignmentGuides.x !== undefined && (
				<div
					className="absolute bg-blue-500 opacity-40 pointer-events-none z-50 animate-pulse"
					style={{
						left: alignmentGuides.x,
						top: 0,
						width: 2,
						height: '100%'
					}}
				/>
			)}
			{alignmentGuides.y !== undefined && (
				<div
					className="absolute bg-blue-500 opacity-40 pointer-events-none z-50 animate-pulse"
					style={{
						left: 0,
						top: alignmentGuides.y,
						width: '100%',
						height: 2
					}}
				/>
			)}

			{/* Resize Preview */}
			{resizePreview.visible && (
				<div
					className="absolute border-2 border-blue-500 border-dashed bg-blue-500/10 rounded-md pointer-events-none z-40"
					style={{
						left: resizePreview.x,
						top: resizePreview.y,
						width: resizePreview.width,
						height: resizePreview.height
					}}
				/>
			)}

			{/* Widgets */}
			{widgets.filter(widget => !widget.isPopOut).map((widget) => (
				<div
					key={widget.id}
					className={cn(
						"absolute bg-background border border-border rounded-lg shadow-md overflow-hidden",
						"transition-all duration-150 hover:shadow-lg",
						dragging === widget.id && "shadow-2xl ring-2 ring-blue-500/50 scale-[1.01] rotate-[0.5deg]",
						resizing === widget.id && "shadow-xl ring-2 ring-blue-500/40"
					)}
					style={{
						left: widget.position.x,
						top: widget.position.y,
						width: widget.size.width,
						height: widget.size.height,
						zIndex: (dragging === widget.id || resizing === widget.id) ? 1000 : 1
					}}
				>
					{/* Widget Header - Drag handle */}
					<div
						className={cn(
							"flex items-center justify-between px-3 py-2 border-b border-border bg-muted/5 cursor-move",
							"hover:bg-blue-500/10 transition-all duration-200",
							"active:bg-blue-500/20",
							dragging === widget.id && "bg-blue-500/15 text-blue-900"
						)}
						onMouseDown={(e) => handleDragStart(widget.id, e)}
						title="Drag to move widget - snap to edges when close to other widgets"
					>
						<h3 className="text-sm font-medium truncate">{widget.title}</h3>
						<div className="flex items-center gap-1">
							{/* Pop-out/Swap-in button */}
							{widget.isPopOut ? (
								onWidgetSwapIn && (
									<button
										onClick={() => onWidgetSwapIn(widget.id)}
										className="text-muted-foreground hover:text-primary transition-colors p-1 hover:bg-muted/20 rounded"
										onMouseDown={(e) => e.stopPropagation()}
										title="Swap back into dashboard"
									>
										<svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
										</svg>
									</button>
								)
							) : (
								onWidgetPopOut && (
									<button
										onClick={() => onWidgetPopOut(widget.id)}
										className="text-muted-foreground hover:text-primary transition-colors p-1 hover:bg-muted/20 rounded"
										onMouseDown={(e) => e.stopPropagation()}
										title="Pop out to new window"
									>
										<svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
										</svg>
									</button>
								)
							)}
							{/* Remove button */}
							{onWidgetRemove && (
								<button
									onClick={() => onWidgetRemove(widget.id)}
									className="text-muted-foreground hover:text-destructive transition-colors p-1 hover:bg-muted/20 rounded"
									onMouseDown={(e) => e.stopPropagation()}
								>
									×
								</button>
							)}
						</div>
					</div>

					{/* Widget Content */}
					<div className="p-3 h-[calc(100%-49px)] overflow-auto">
						{widget.content}
					</div>

					{/* Resize Handle */}
					<div
						className={cn(
							"absolute bottom-0 right-0 w-5 h-5 cursor-se-resize",
							"hover:bg-primary/20 transition-all duration-200 group rounded-tl-md",
							"opacity-60 hover:opacity-100"
						)}
						onMouseDown={(e) => handleResizeStart(widget.id, e)}
						title="Drag to resize widget"
					>
						<div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-border opacity-80 group-hover:opacity-100 group-hover:border-primary transition-all" />
					</div>
				</div>
			))}
		</div>
	);
}
