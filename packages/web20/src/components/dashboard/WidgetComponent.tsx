'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Widget } from '@/types/dashboard';
import { useAppDispatch } from '@/store/hooks';
import { minimizeWidget, maximizeWidget, restoreWidget, popOutWidget, popInWidget, setResizeState, setIsResizing as setIsResizingAction, updateWidget } from '@/store/slices/dashboardSlice';
import { cn } from '@/lib/utils';
import { createWidgetContent } from '@/lib/widgetFactory';
import { useUnifiedSessionData } from '@/hooks/useUnifiedSession';
import {
	Maximize2,
	Minimize2,
	X,
	MoreHorizontal,
	GripVertical
} from 'lucide-react';
import { useLayoutPersistence } from '@/hooks/useLayoutPersistence';

interface WidgetComponentProps {
	widget: Widget;
	isSelected: boolean;
	onMouseDown: (e: React.MouseEvent, widgetId: string) => void;
	onSelect: () => void;
}

export function WidgetComponent({
	widget,
	isSelected,
	onMouseDown,
	onSelect,
}: WidgetComponentProps) {
	const dispatch = useAppDispatch();
	const { data: session } = useUnifiedSessionData();
	const { removeWidget } = useLayoutPersistence();

	const [isResizing, setIsResizing] = useState(false);
	const [showDropdown, setShowDropdown] = useState(false);
	const resizeRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setShowDropdown(false);
			}
		};

		if (showDropdown) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [showDropdown]);

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onSelect();
		onMouseDown(e, widget.id);
	}, [onSelect, onMouseDown, widget.id]);

	const handleResizeStart = useCallback((e: React.MouseEvent, handle: string) => {
		e.preventDefault();
		e.stopPropagation();
		dispatch(setIsResizingAction(true));
		dispatch(setResizeState({
			widgetId: widget.id,
			startSize: { ...widget.size },
			currentSize: { ...widget.size },
			resizeHandle: handle,
			mouseStart: { x: e.clientX, y: e.clientY },
		}));
		setIsResizing(true);
	}, [dispatch, widget.id, widget.size]);

	const handleMinimize = useCallback(() => {
		dispatch(minimizeWidget(widget.id));
		setShowDropdown(false);
	}, [dispatch, widget.id]);

	const handleMaximize = useCallback(() => {
		dispatch(maximizeWidget(widget.id));
		setShowDropdown(false);
	}, [dispatch, widget.id]);

	const handleRestore = useCallback(() => {
		dispatch(restoreWidget(widget.id));
		setShowDropdown(false);
	}, [dispatch, widget.id]);

	const handleRemove = useCallback(() => {
		removeWidget(widget.id);
		setShowDropdown(false);
	}, [removeWidget, widget.id]);

	const handlePopOut = useCallback(() => {
		dispatch(popOutWidget(widget.id));
		setShowDropdown(false);
	}, [dispatch, widget.id]);

	const handlePopIn = useCallback(() => {
		dispatch(popInWidget(widget.id));
		setShowDropdown(false);
	}, [dispatch, widget.id]);

	// Provide file selection callback to file-browser widgets
	const handleFileSelect = useCallback((filePath: string) => {
		// The FileBrowserDialog handles loading and event dispatch; avoid duplicate events here
		console.log('[web20] File selected:', filePath);
	}, []);

	// Listen for widget data updates

	if (widget.isMinimized) {
		return (
			<div
				className={cn(
					'absolute bg-card border rounded-lg shadow-sm cursor-pointer transition-all duration-200',
					isSelected && 'ring-2 ring-primary',
					'hover:shadow-md'
				)}
				style={{
					left: widget.position.x,
					top: widget.position.y,
					width: 200,
					height: 40,
				}}
				onClick={onSelect}
			>
				<div className="flex items-center justify-between h-full px-3">
					<div className="flex items-center gap-2">
						<GripVertical className="h-4 w-4 text-muted-foreground" />
						<span className="text-sm font-medium truncate">{widget.title}</span>
					</div>
					<button
						onClick={handleRestore}
						className="h-6 w-6 p-0 hover:bg-muted rounded"
					>
						<Maximize2 className="h-3 w-3" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				'absolute bg-card border rounded-lg shadow-sm transition-all duration-200 flex flex-col overflow-hidden',
				isSelected && 'ring-2 ring-primary',
				'hover:shadow-md'
			)}
			style={{
				left: widget.position.x,
				top: widget.position.y,
				width: widget.size.width,
				height: widget.size.height,
				zIndex: isSelected ? 10 : 1,
			}}
			onClick={onSelect}
		>
			{/* Widget Header */}
			<div
				className="flex items-center justify-between h-8 px-2 border-b bg-muted/50 cursor-move"
				onMouseDown={handleMouseDown}
			>
				<div className="flex items-center gap-2">
					<GripVertical className="h-4 w-4 text-muted-foreground" />
					<span className="text-sm font-medium truncate">{widget.title}</span>
				</div>

				<div className="flex items-center gap-1">
					{widget.isMaximized ? (
						<button
							onClick={handleRestore}
							className="h-6 w-6 p-0 hover:bg-muted rounded"
						>
							<Minimize2 className="h-3 w-3" />
						</button>
					) : (
						<button
							onClick={handleMaximize}
							className="h-6 w-6 p-0 hover:bg-muted rounded"
						>
							<Maximize2 className="h-3 w-3" />
						</button>
					)}

					<div className="relative" ref={dropdownRef}>
						<button
							onClick={() => setShowDropdown(!showDropdown)}
							className="h-6 w-6 p-0 hover:bg-muted rounded"
						>
							<MoreHorizontal className="h-3 w-3" />
						</button>

						{showDropdown && (
							<div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg z-50 min-w-[120px]">
								<button
									onClick={handlePopOut}
									className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
								>
									Pop Out
								</button>
								<button
									onClick={handleMinimize}
									className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
								>
									Minimize
								</button>
								<button
									onClick={handleRemove}
									className="w-full px-3 py-2 text-left text-sm hover:bg-muted text-destructive"
								>
									Remove
								</button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Widget Content */}
			<div className="flex-1 min-h-0 p-1 overflow-hidden">
				{createWidgetContent(widget.type, widget.id, widget.isPopOut, handleFileSelect, widget.data)}
			</div>

			{/* Resize Handles */}
			{isSelected && (
				<>
					<div
						ref={resizeRef}
						className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
						onMouseDown={(e) => handleResizeStart(e, 'se')}
					/>
					<div
						className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize"
						onMouseDown={(e) => handleResizeStart(e, 'ne')}
					/>
					<div
						className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize"
						onMouseDown={(e) => handleResizeStart(e, 'sw')}
					/>
					<div
						className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
						onMouseDown={(e) => handleResizeStart(e, 'nw')}
					/>
				</>
			)}
		</div>
	);
} 