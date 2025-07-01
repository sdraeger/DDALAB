"use client";

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils/misc';
import { IDashboardWidget } from '../../types/dashboard';
import { Button } from '../ui/button';
import { X, Maximize2, Minimize2, GripVertical, ExternalLink } from 'lucide-react';
import { useToast } from '../ui/use-toast';
import { useAppSelector } from '../../store';

interface ModernWidgetContainerProps {
	widget: IDashboardWidget;
	onRemove?: () => void;
	onUpdate?: (updates: Partial<IDashboardWidget>) => void;
	className?: string;
}

export function ModernWidgetContainer({
	widget,
	onRemove,
	onUpdate,
	className,
}: ModernWidgetContainerProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [isMinimized, setIsMinimized] = useState(false);
	const { toast } = useToast();

	// Get plot state for chart widgets
	const plots = useAppSelector(state => state.plots);

	const handleMinimize = useCallback((e: React.MouseEvent) => {
		// Prevent drag event from being triggered
		e.preventDefault();
		e.stopPropagation();

		setIsMinimized(!isMinimized);
		onUpdate?.({ metadata: { ...widget.metadata, isMinimized: !isMinimized } });
	}, [isMinimized, onUpdate, widget.metadata]);

	const handleTitleEdit = useCallback((newTitle: string) => {
		onUpdate?.({ title: newTitle });
	}, [onUpdate]);

	const handlePopout = useCallback((e: React.MouseEvent) => {
		// Prevent drag event from being triggered
		e.preventDefault();
		e.stopPropagation();

		try {
			// Create a serializable version of the widget for the new tab
			const serializableWidget = {
				id: widget.id,
				title: widget.title,
				type: widget.type,
				metadata: widget.metadata,
				constraints: widget.constraints,
				supportsPopout: widget.supportsPopout,
				popoutPreferences: widget.popoutPreferences,
			};

			// Capture widget-specific state for synchronization
			const widgetStateKeys = [
				`widget-state-${widget.id}`,
				`widget-state-chart-widget-default`,
				`widget-state-dda-widget-default`,
				`widget-state-dda-lineplot-widget-default`
			];

			const capturedStates: Record<string, any> = {};
			widgetStateKeys.forEach(key => {
				const storedState = localStorage.getItem(key);
				if (storedState) {
					try {
						capturedStates[key] = JSON.parse(storedState);
					} catch (error) {
						console.warn(`Failed to capture state for ${key}:`, error);
					}
				}
			});

			// For widgets that depend on plots data (chart, dda-line-plot), capture the entire plots state
			const plotDependentWidgets = ['chart', 'dda-line-plot'];
			if (plotDependentWidgets.includes(widget.type) && plots) {
				// Capture the entire plots state for data synchronization
				serializableWidget.metadata = {
					...serializableWidget.metadata,
					initialPlotsState: plots
				};

				// Also capture specific plot state for backward compatibility (chart widgets)
				if (widget.type === 'chart') {
					const latestFilePath = Object.keys(plots).find(filePath =>
						plots[filePath]?.metadata && plots[filePath]?.edfData
					);

					if (latestFilePath && plots[latestFilePath]) {
						const plotState = plots[latestFilePath];
						serializableWidget.metadata.plotState = {
							edfData: plotState.edfData,
							metadata: plotState.metadata,
							selectedChannels: plotState.selectedChannels,
							filePath: latestFilePath,
							timeWindow: plotState.timeWindow,
							absoluteTimeWindow: plotState.absoluteTimeWindow,
							zoomLevel: plotState.zoomLevel,
							annotations: plotState.annotations,
							chunkStart: plotState.chunkStart,
							currentChunkNumber: plotState.currentChunkNumber,
							chunkSizeSeconds: plotState.chunkSizeSeconds,
						};
					}
				}
			}

			// Store captured widget states for the popped-out window
			serializableWidget.metadata = {
				...serializableWidget.metadata,
				capturedStates
			};

			// Store widget data in localStorage for the new tab to access
			const storageKey = `modern-popped-widget-${widget.id}`;
			localStorage.setItem(storageKey, JSON.stringify(serializableWidget));

			// Open widget in new tab
			const popoutUrl = `/widget/modern/${widget.id}`;
			const newWindow = window.open(popoutUrl, `widget-${widget.id}`,
				'width=1200,height=800,scrollbars=yes,resizable=yes'
			);

			if (newWindow) {
				// Focus the new window
				newWindow.focus();

				toast({
					title: "Widget Popped Out",
					description: `${widget.title} has been opened in a new tab.`,
					duration: 2000,
				});
			} else {
				toast({
					title: "Pop-out Failed",
					description: "Could not open widget in new tab. Please check your browser's pop-up settings.",
					variant: "destructive",
					duration: 4000,
				});
			}
		} catch (error) {
			console.error('Error popping out widget:', error);
			toast({
				title: "Pop-out Error",
				description: "Failed to open widget in new tab.",
				variant: "destructive",
				duration: 3000,
			});
		}
	}, [widget, toast]);

	return (
		<div
			className={cn(
				'modern-widget-container h-full w-full bg-background border border-border rounded-lg shadow-sm overflow-hidden',
				'transition-all duration-200 ease-in-out',
				'hover:shadow-md hover:border-primary/20',
				className
			)}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Widget Header */}
			<div
				className={cn(
					'flex items-center justify-between px-3 py-2 border-b border-border bg-muted/20',
					'transition-all duration-200',
					'hover:bg-primary/10 hover:border-primary/20',
					isHovered && 'bg-primary/5'
				)}
			>
				{/* Left side - Drag handle and title (DRAGGABLE AREA) */}
				<div
					className={cn(
						'drag-handle flex items-center gap-2 flex-1 min-w-0 cursor-move',
						'transition-colors duration-200',
						isHovered && 'text-primary'
					)}
				>
					<GripVertical
						className={cn(
							'h-4 w-4 text-muted-foreground transition-colors duration-200',
							isHovered && 'text-primary'
						)}
					/>
					<EditableTitle
						title={widget.title}
						onTitleChange={handleTitleEdit}
						className="truncate text-sm font-medium"
					/>
				</div>

				{/* Right side - Action buttons (NON-DRAGGABLE AREA) */}
				<div
					className={cn(
						'flex items-center gap-1 transition-opacity duration-200 cursor-auto',
						'relative z-10', // Ensure buttons are above drag area
						isHovered ? 'opacity-100' : 'opacity-0'
					)}
					onMouseDown={(e) => {
						// Prevent any mouse events from bubbling to drag system
						e.stopPropagation();
					}}
					onTouchStart={(e) => {
						// Prevent touch events from bubbling to drag system
						e.stopPropagation();
					}}
				>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0 hover:bg-primary/20"
						onClick={handlePopout}
						onMouseDown={(e) => {
							// Double protection: stop propagation at button level too
							e.stopPropagation();
						}}
						title="Pop out widget"
					>
						<ExternalLink className="h-3 w-3" />
					</Button>

					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0 hover:bg-primary/20"
						onClick={handleMinimize}
						onMouseDown={(e) => {
							// Double protection: stop propagation at button level too
							e.stopPropagation();
						}}
						title={isMinimized ? 'Expand widget' : 'Minimize widget'}
					>
						{isMinimized ? (
							<Maximize2 className="h-3 w-3" />
						) : (
							<Minimize2 className="h-3 w-3" />
						)}
					</Button>

					{onRemove && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								onRemove();
							}}
							onMouseDown={(e) => {
								// Double protection: stop propagation at button level too
								e.stopPropagation();
							}}
							title="Remove widget"
						>
							<X className="h-3 w-3" />
						</Button>
					)}
				</div>
			</div>

			{/* Widget Content */}
			<div
				className={cn(
					'widget-content overflow-auto transition-all duration-300',
					isMinimized ? 'h-0 opacity-0' : 'h-[calc(100%-49px)] opacity-100'
				)}
			>
				<div className="p-3 h-full">
					{widget.content}
				</div>
			</div>

			{/* Minimized indicator */}
			{isMinimized && (
				<div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
					Widget minimized - click to expand
				</div>
			)}


		</div>
	);
}

// Editable title component
interface EditableTitleProps {
	title: string;
	onTitleChange?: (newTitle: string) => void;
	className?: string;
}

function EditableTitle({ title, onTitleChange, className }: EditableTitleProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(title);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleDoubleClick = useCallback((e: React.MouseEvent) => {
		// Prevent drag when double-clicking to edit title
		e.stopPropagation();

		if (onTitleChange) {
			setIsEditing(true);
			setEditValue(title);
		}
	}, [title, onTitleChange]);

	const handleSubmit = useCallback(() => {
		if (editValue.trim() && editValue !== title) {
			onTitleChange?.(editValue.trim());
		}
		setIsEditing(false);
	}, [editValue, title, onTitleChange]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			handleSubmit();
		} else if (e.key === 'Escape') {
			setEditValue(title);
			setIsEditing(false);
		}
	}, [handleSubmit, title]);

	// Select all text when editing starts
	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.select();
		}
	}, [isEditing]);

	if (isEditing) {
		return (
			<input
				ref={inputRef}
				type="text"
				value={editValue}
				onChange={(e) => setEditValue(e.target.value)}
				onBlur={handleSubmit}
				onKeyDown={handleKeyDown}
				onMouseDown={(e) => {
					// Prevent drag when interacting with input field
					e.stopPropagation();
				}}
				onFocus={(e) => {
					// Prevent drag when focusing input field
					e.stopPropagation();
				}}
				className="bg-transparent border-none outline-none text-sm font-medium w-full"
				autoFocus
			/>
		);
	}

	return (
		<span
			className={cn(className, onTitleChange && 'cursor-pointer hover:text-primary')}
			onDoubleClick={handleDoubleClick}
			title={onTitleChange ? 'Double-click to edit' : undefined}
		>
			{title}
		</span>
	);
}
