"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "../../lib/utils/misc";

// ===== IMPROVED DRAGGING SYSTEM - SOLID PRINCIPLES =====

// Interface for position and size
interface Rectangle {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface DragState {
	widgetId: string;
	startPosition: { x: number; y: number };
	currentPosition: { x: number; y: number };
	mouseStart: { x: number; y: number };
}

// Single Responsibility: Handle collision detection
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

		// Try docking to each other widget
		otherWidgets.forEach(other => {
			// Calculate potential dock positions
			const dockPositions = [
				// Left side
				{ x: other.x - draggedWidget.width - 10, y: other.y },
				// Right side
				{ x: other.x + other.width + 10, y: other.y },
				// Top side
				{ x: other.x, y: other.y - draggedWidget.height - 10 },
				// Bottom side
				{ x: other.x, y: other.y + other.height + 10 },
			];

			dockPositions.forEach(pos => {
				// Check if position is within container bounds
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
						// Check if this position would overlap with any widget
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

// Single Responsibility: Handle smooth animations
class SmoothAnimator {
	static easeOutCubic(t: number): number {
		return 1 - Math.pow(1 - t, 3);
	}

	static interpolate(start: number, end: number, progress: number): number {
		return start + (end - start) * this.easeOutCubic(progress);
	}
}

// Single Responsibility: Handle alignment guides
class SnapGuide {
	static findAlignmentGuides(
		draggedWidget: Rectangle,
		otherWidgets: Rectangle[],
		tolerance: number = 10
	): { x?: number; y?: number; snapX?: number; snapY?: number } {
		const guides: { x?: number; y?: number; snapX?: number; snapY?: number } = {};
		let minXDistance = tolerance + 1;
		let minYDistance = tolerance + 1;

		otherWidgets.forEach(other => {
			// Vertical alignment checks
			const alignments = [
				{ pos: other.x, snap: other.x }, // Left to left
				{ pos: other.x + other.width, snap: other.x + other.width }, // Left to right
				{ pos: other.x, snap: other.x - draggedWidget.width }, // Right to left
				{ pos: other.x + other.width, snap: other.x + other.width - draggedWidget.width }, // Right to right
				{ pos: other.x + other.width / 2, snap: other.x + (other.width - draggedWidget.width) / 2 } // Center to center
			];

			alignments.forEach(({ pos, snap }) => {
				const distance = Math.abs(draggedWidget.x - snap);
				if (distance < minXDistance) {
					minXDistance = distance;
					guides.x = pos;
					guides.snapX = snap;
				}
			});

			// Horizontal alignment checks
			const hAlignments = [
				{ pos: other.y, snap: other.y }, // Top to top
				{ pos: other.y + other.height, snap: other.y + other.height }, // Top to bottom
				{ pos: other.y, snap: other.y - draggedWidget.height }, // Bottom to top
				{ pos: other.y + other.height, snap: other.y + other.height - draggedWidget.height }, // Bottom to bottom
				{ pos: other.y + other.height / 2, snap: other.y + (other.height - draggedWidget.height) / 2 } // Center to center
			];

			hAlignments.forEach(({ pos, snap }) => {
				const distance = Math.abs(draggedWidget.y - snap);
				if (distance < minYDistance) {
					minYDistance = distance;
					guides.y = pos;
					guides.snapY = snap;
				}
			});
		});

		return guides;
	}
}

// Single Responsibility: Handle drag operations
class DragHandler {
	private animationFrame?: number;

	constructor(
		private onUpdate: (id: string, position: { x: number; y: number }) => void,
		private onGuidesUpdate: (guides: { x?: number; y?: number }) => void
	) { }

	processDrag(
		dragState: DragState,
		mousePosition: { x: number; y: number },
		widgets: Widget[],
		containerBounds: Rectangle
	): void {
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
		}

		this.animationFrame = requestAnimationFrame(() => {
			const deltaX = mousePosition.x - dragState.mouseStart.x;
			const deltaY = mousePosition.y - dragState.mouseStart.y;

			let newX = dragState.startPosition.x + deltaX;
			let newY = dragState.startPosition.y + deltaY;

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

			const otherWidgets = widgets
				.filter(w => w.id !== dragState.widgetId && !w.isPopOut)
				.map(w => ({
					x: w.position.x,
					y: w.position.y,
					width: w.size.width,
					height: w.size.height
				}));

			const draggedRect = {
				x: newX,
				y: newY,
				width: draggedWidget.size.width,
				height: draggedWidget.size.height
			};

			// Find alignment guides and snap positions
			const guides = SnapGuide.findAlignmentGuides(draggedRect, otherWidgets);

			// Apply snapping with boundary re-clamping
			if (guides.snapX !== undefined) {
				newX = guides.snapX;
				newX = Math.max(minX, Math.min(maxX, newX)); // Re-clamp after snapping
			}
			if (guides.snapY !== undefined) {
				newY = guides.snapY;
				newY = Math.max(minY, Math.min(maxY, newY)); // Re-clamp after snapping
			}

			// Update guides display
			this.onGuidesUpdate({ x: guides.x, y: guides.y });

			// Update position
			this.onUpdate(dragState.widgetId, { x: newX, y: newY });
		});
	}

	finishDrag(
		dragState: DragState,
		widgets: Widget[],
		containerBounds: Rectangle
	): void {
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
		}

		const draggedWidget = widgets.find(w => w.id === dragState.widgetId);
		if (!draggedWidget) return;

		const otherWidgets = widgets
			.filter(w => w.id !== dragState.widgetId && !w.isPopOut)
			.map(w => ({
				x: w.position.x,
				y: w.position.y,
				width: w.size.width,
				height: w.size.height
			}));

		const draggedRect = {
			x: draggedWidget.position.x,
			y: draggedWidget.position.y,
			width: draggedWidget.size.width,
			height: draggedWidget.size.height
		};

		// Find best dock position if close enough
		const dockPosition = CollisionDetector.findNearestDockPosition(
			draggedRect,
			otherWidgets,
			containerBounds,
			50 // Dock tolerance
		);

		// Smooth animate to dock position if different
		if (dockPosition.x !== draggedRect.x || dockPosition.y !== draggedRect.y) {
			this.animateToPosition(
				dragState.widgetId,
				{ x: draggedRect.x, y: draggedRect.y },
				{ x: dockPosition.x, y: dockPosition.y },
				300
			);
		}

		// Clear guides
		this.onGuidesUpdate({});
	}

	private animateToPosition(
		widgetId: string,
		from: { x: number; y: number },
		to: { x: number; y: number },
		duration: number
	): void {
		const startTime = Date.now();

		const animate = () => {
			const elapsed = Date.now() - startTime;
			const progress = Math.min(elapsed / duration, 1);

			const currentX = SmoothAnimator.interpolate(from.x, to.x, progress);
			const currentY = SmoothAnimator.interpolate(from.y, to.y, progress);

			this.onUpdate(widgetId, { x: currentX, y: currentY });

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		requestAnimationFrame(animate);
	}

	destroy(): void {
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
		}
	}
}

// ===== END IMPROVED DRAGGING SYSTEM =====

export interface Widget {
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

interface DashboardGridProps {
	widgets: Widget[];
	onWidgetUpdate?: (id: string, updates: Partial<Widget>) => void;
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

// Legacy helper functions removed - now using SOLID architecture classes above

export function DashboardGrid({
	widgets,
	onWidgetUpdate,
	onWidgetRemove,
	onWidgetPopOut,
	onWidgetSwapIn,
	className,
	gridSize = 10,
	enableSnapping = false,
	enableCollisionDetection = false
}: DashboardGridProps) {
	const [dragState, setDragState] = useState<DragState | null>(null);
	const [dragPreview, setDragPreview] = useState<{ widgetId: string; x: number; y: number } | null>(null);
	const [resizing, setResizing] = useState<string | null>(null);
	const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
	const [resizePreview, setResizePreview] = useState<ResizePreview>({ x: 0, y: 0, width: 0, height: 0, visible: false });
	const [alignmentGuides, setAlignmentGuides] = useState<{ x?: number; y?: number }>({});
	const containerRef = useRef<HTMLDivElement>(null);
	const dragHandlerRef = useRef<DragHandler | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const lastUpdateTimeRef = useRef<number>(0);
	const updateThrottleMs = 16; // ~60fps

	// Initialize drag handler
	useEffect(() => {
		if (!dragHandlerRef.current && onWidgetUpdate) {
			dragHandlerRef.current = new DragHandler(
				(id, position) => onWidgetUpdate(id, { position }),
				(guides) => setAlignmentGuides(guides)
			);
		}

		return () => {
			if (dragHandlerRef.current) {
				dragHandlerRef.current.destroy();
				dragHandlerRef.current = null;
			}
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = null;
			}
		};
	}, [onWidgetUpdate]);

	// Handle mouse move for dragging and resizing
	const handleMouseMove = useCallback((e: MouseEvent) => {
		if (dragState && containerRef.current && onWidgetUpdate) {
			// Cancel any pending animation frame to prevent multiple updates
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}

			// Use requestAnimationFrame for smooth visual updates
			animationFrameRef.current = requestAnimationFrame(() => {
				const containerRect = containerRef.current?.getBoundingClientRect();
				if (!containerRect) return;

				const deltaX = e.clientX - dragState.mouseStart.x;
				const deltaY = e.clientY - dragState.mouseStart.y;

				let newX = dragState.startPosition.x + deltaX;
				let newY = dragState.startPosition.y + deltaY;

				const widget = widgets.find(w => w.id === dragState.widgetId);
				if (widget) {
					// Keep within bounds
					newX = Math.max(0, Math.min(newX, containerRect.width - widget.size.width));
					newY = Math.max(0, Math.min(newY, containerRect.height - widget.size.height));

					// Find other widgets for alignment
					const otherWidgets = widgets.filter(w => w.id !== dragState.widgetId && !w.isPopOut);
					const guides: { x?: number; y?: number } = {};
					const tolerance = 10;

					// Simple alignment detection
					otherWidgets.forEach(other => {
						// Vertical alignment (X-axis)
						if (Math.abs(newX - other.position.x) < tolerance) {
							newX = other.position.x;
							guides.x = other.position.x;
						} else if (Math.abs(newX + widget.size.width - (other.position.x + other.size.width)) < tolerance) {
							newX = other.position.x + other.size.width - widget.size.width;
							guides.x = other.position.x + other.size.width;
						}

						// Horizontal alignment (Y-axis)
						if (Math.abs(newY - other.position.y) < tolerance) {
							newY = other.position.y;
							guides.y = other.position.y;
						} else if (Math.abs(newY + widget.size.height - (other.position.y + other.size.height)) < tolerance) {
							newY = other.position.y + other.size.height - widget.size.height;
							guides.y = other.position.y + other.size.height;
						}
					});

					// Update alignment guides immediately for visual feedback
					setAlignmentGuides(guides);

					// Update drag preview for instant visual feedback
					setDragPreview({ widgetId: dragState.widgetId, x: newX, y: newY });

					// Throttle actual widget updates to reduce re-renders
					const now = Date.now();
					if (now - lastUpdateTimeRef.current > updateThrottleMs) {
						onWidgetUpdate(dragState.widgetId, { position: { x: newX, y: newY } });
						lastUpdateTimeRef.current = now;
					}
				}
				animationFrameRef.current = null;
			});
		}

		if (resizing) {
			const deltaX = e.clientX - resizeStart.x;
			const deltaY = e.clientY - resizeStart.y;
			const widget = widgets.find(w => w.id === resizing);

			if (widget && containerRef.current) {
				const containerRect = containerRef.current.getBoundingClientRect();
				let newWidth = resizeStart.width + deltaX;
				let newHeight = resizeStart.height + deltaY;

				// Enhanced boundary constraints for resize
				const minWidth = widget.minSize?.width || 200;
				const minHeight = widget.minSize?.height || 150;
				const maxWidth = Math.min(
					widget.maxSize?.width || containerRect.width,
					containerRect.width - widget.position.x
				);
				const maxHeight = Math.min(
					widget.maxSize?.height || containerRect.height,
					containerRect.height - widget.position.y
				);

				// Clamp size to container bounds
				newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
				newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

				// Ensure widget doesn't extend beyond container boundaries
				if (widget.position.x + newWidth > containerRect.width) {
					newWidth = containerRect.width - widget.position.x;
				}
				if (widget.position.y + newHeight > containerRect.height) {
					newHeight = containerRect.height - widget.position.y;
				}

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
	}, [dragState, resizing, resizeStart, widgets, onWidgetUpdate]);

	// Handle mouse up to stop dragging/resizing
	const handleMouseUp = useCallback(() => {
		if (dragState && containerRef.current && onWidgetUpdate) {
			const containerRect = containerRef.current.getBoundingClientRect();
			const widget = widgets.find(w => w.id === dragState.widgetId);

			if (widget) {
				// Find potential dock positions
				const otherWidgets = widgets.filter(w => w.id !== dragState.widgetId && !w.isPopOut);
				const currentPos = { x: widget.position.x, y: widget.position.y };
				let bestDockPos = currentPos;
				let minDistance = 50; // Only dock if within 50px

				otherWidgets.forEach(other => {
					const dockPositions = [
						// Right of other widget
						{ x: other.position.x + other.size.width + 10, y: other.position.y },
						// Left of other widget
						{ x: other.position.x - widget.size.width - 10, y: other.position.y },
						// Below other widget
						{ x: other.position.x, y: other.position.y + other.size.height + 10 },
						// Above other widget
						{ x: other.position.x, y: other.position.y - widget.size.height - 10 }
					];

					dockPositions.forEach(pos => {
						if (pos.x >= 0 && pos.y >= 0 &&
							pos.x + widget.size.width <= containerRect.width &&
							pos.y + widget.size.height <= containerRect.height) {

							const distance = Math.sqrt(
								Math.pow(pos.x - currentPos.x, 2) +
								Math.pow(pos.y - currentPos.y, 2)
							);

							if (distance < minDistance) {
								minDistance = distance;
								bestDockPos = pos;
							}
						}
					});
				});

				// Smooth animate to dock position if different
				if (bestDockPos.x !== currentPos.x || bestDockPos.y !== currentPos.y) {
					const startTime = Date.now();
					const duration = 200;

					const animate = () => {
						const elapsed = Date.now() - startTime;
						const progress = Math.min(elapsed / duration, 1);
						const eased = 1 - Math.pow(1 - progress, 3); // Ease out cubic

						const currentX = currentPos.x + (bestDockPos.x - currentPos.x) * eased;
						const currentY = currentPos.y + (bestDockPos.y - currentPos.y) * eased;

						onWidgetUpdate(dragState.widgetId, { position: { x: currentX, y: currentY } });

						if (progress < 1) {
							requestAnimationFrame(animate);
						}
					};

					requestAnimationFrame(animate);
				}
			}
		}

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

		// Ensure final position is committed before cleanup
		if (dragPreview && onWidgetUpdate) {
			onWidgetUpdate(dragPreview.widgetId, {
				position: { x: dragPreview.x, y: dragPreview.y }
			});
		}

		// Clean up states and animation frames
		if (animationFrameRef.current) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}

		setDragState(null);
		setDragPreview(null);
		setResizing(null);
		setResizePreview(prev => ({ ...prev, visible: false }));
		setAlignmentGuides({});
		lastUpdateTimeRef.current = 0;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}, [dragState, resizing, resizePreview, widgets, onWidgetUpdate]);

	// Add global event listeners
	useEffect(() => {
		if (dragState || resizing) {
			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
			document.body.style.userSelect = 'none';
			document.body.style.webkitUserSelect = 'none';

			if (resizing) {
				document.body.style.cursor = 'se-resize';
			} else if (dragState) {
				document.body.style.cursor = 'move';
			}

			return () => {
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
				document.body.style.webkitUserSelect = '';
			};
		}
	}, [dragState, resizing, handleMouseMove, handleMouseUp]);

	// Cleanup effect to ensure text selection is restored if operations are interrupted
	useEffect(() => {
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

	// Start dragging
	const handleDragStart = useCallback((widgetId: string, e: React.MouseEvent) => {
		e.preventDefault();
		const widget = widgets.find(w => w.id === widgetId);
		if (widget) {
			setDragState({
				widgetId,
				startPosition: { x: widget.position.x, y: widget.position.y },
				currentPosition: { x: widget.position.x, y: widget.position.y },
				mouseStart: { x: e.clientX, y: e.clientY }
			});
		}
	}, [widgets]);

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
			className={cn("relative w-full h-full bg-muted/5 min-w-full overflow-hidden", className)}
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
						// Only apply transitions when not dragging for better performance
						dragState?.widgetId !== widget.id && "transition-all duration-150 hover:shadow-lg",
						dragState?.widgetId === widget.id && "shadow-2xl ring-2 ring-blue-500/50 scale-[1.01] rotate-[0.5deg]",
						resizing === widget.id && "shadow-xl ring-2 ring-blue-500/40"
					)}
					style={{
						// Use drag preview position if this widget is being dragged
						left: dragPreview?.widgetId === widget.id ? dragPreview.x : widget.position.x,
						top: dragPreview?.widgetId === widget.id ? dragPreview.y : widget.position.y,
						width: widget.size.width,
						height: widget.size.height,
						zIndex: (dragState?.widgetId === widget.id || resizing === widget.id) ? 1000 : 1
					}}
				>
					{/* Widget Header - Drag handle */}
					<div
						className={cn(
							"flex items-center justify-between px-3 py-2 border-b border-border bg-muted/5 cursor-move",
							"hover:bg-blue-500/10 transition-all duration-200",
							"active:bg-blue-500/20",
							"select-none", // Prevent text selection
							dragState?.widgetId === widget.id && "bg-blue-500/15 text-blue-900"
						)}
						onMouseDown={(e) => handleDragStart(widget.id, e)}
						title="Drag to move widget - snap to edges when close to other widgets"
						style={{
							userSelect: 'none',
							WebkitUserSelect: 'none',
							MozUserSelect: 'none',
							msUserSelect: 'none'
						}}
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
							"opacity-60 hover:opacity-100",
							"select-none" // Prevent text selection
						)}
						onMouseDown={(e) => handleResizeStart(widget.id, e)}
						title="Drag to resize widget"
						style={{
							userSelect: 'none',
							WebkitUserSelect: 'none',
							MozUserSelect: 'none',
							msUserSelect: 'none'
						}}
					>
						<div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-border opacity-80 group-hover:opacity-100 group-hover:border-primary transition-all" />
					</div>
				</div>
			))}
		</div>
	);
}
