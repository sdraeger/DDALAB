"use client";

import React, { useEffect, useCallback } from 'react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '../ui/dialog';
import { IDashboardWidget } from '../../types/dashboard';
import { cn } from '../../lib/utils/misc';
import { Button } from '../ui/button';
import { Maximize2, Minimize2, Copy } from 'lucide-react';
import { useToast } from '../ui/use-toast';

interface WidgetPopoutDialogProps {
	widget: IDashboardWidget;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	className?: string;
}

type PopoutSize = 'normal' | 'large' | 'fullscreen';

export function WidgetPopoutDialog({
	widget,
	isOpen,
	onOpenChange,
	className,
}: WidgetPopoutDialogProps) {
	const { toast } = useToast();

	// Use widget's preferred default size if available
	const defaultSize = widget.popoutPreferences?.defaultSize || 'large';
	const [popoutSize, setPopoutSize] = React.useState<PopoutSize>(defaultSize);

	// Reset to default size when widget changes
	React.useEffect(() => {
		setPopoutSize(widget.popoutPreferences?.defaultSize || 'large');
	}, [widget.id, widget.popoutPreferences?.defaultSize]);

	// Handle keyboard shortcuts
	const handleKeyDown = useCallback((event: KeyboardEvent) => {
		if (!isOpen) return;

		// Escape key to close (handled by dialog)
		if (event.key === 'Escape') {
			return; // Let dialog handle this
		}

		// F11 or Cmd/Ctrl + F for fullscreen toggle
		if (event.key === 'F11' || ((event.metaKey || event.ctrlKey) && event.key === 'f')) {
			event.preventDefault();
			setPopoutSize(prev => prev === 'fullscreen' ? 'large' : 'fullscreen');
		}

		// Cmd/Ctrl + C to copy widget info
		if ((event.metaKey || event.ctrlKey) && event.key === 'c' && event.shiftKey) {
			event.preventDefault();
			handleCopyWidgetInfo();
		}
	}, [isOpen]);

	// Add keyboard event listeners
	useEffect(() => {
		if (isOpen) {
			document.addEventListener('keydown', handleKeyDown);
			return () => document.removeEventListener('keydown', handleKeyDown);
		}
	}, [isOpen, handleKeyDown]);

	const handleCopyWidgetInfo = useCallback(() => {
		const widgetInfo = `Widget: ${widget.title}\nType: ${widget.type}\nID: ${widget.id}`;
		navigator.clipboard.writeText(widgetInfo).then(() => {
			toast({
				title: "Widget Info Copied",
				description: "Widget information has been copied to clipboard.",
				duration: 2000,
			});
		}).catch(() => {
			toast({
				title: "Copy Failed",
				description: "Failed to copy widget information.",
				variant: "destructive",
				duration: 2000,
			});
		});
	}, [widget, toast]);

	const getSizeClasses = () => {
		switch (popoutSize) {
			case 'normal':
				return "max-w-2xl w-[70vw] h-[70vh] max-h-[600px]";
			case 'large':
				return "max-w-4xl w-[90vw] h-[90vh] max-h-[800px]";
			case 'fullscreen':
				return "w-[98vw] h-[98vh] max-w-none max-h-none";
			default:
				return "max-w-4xl w-[90vw] h-[90vh] max-h-[800px]";
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"flex flex-col gap-0 transition-all duration-200",
					getSizeClasses(),
					className
				)}
			>
				<DialogHeader className="pb-4 border-b border-border">
					<div className="flex items-center justify-between">
						<DialogTitle className="text-left flex items-center gap-2">
							<span className="truncate">{widget.title}</span>
							<span className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded-md font-normal">
								{widget.type}
							</span>
						</DialogTitle>

						{/* Size control buttons */}
						<div className="flex items-center gap-1">
							{(widget.popoutPreferences?.allowResize !== false) && (
								<>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 w-6 p-0"
										onClick={() => setPopoutSize('normal')}
										title="Normal size"
										disabled={popoutSize === 'normal'}
									>
										<Minimize2 className="h-3 w-3" />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-6 w-6 p-0"
										onClick={() => setPopoutSize(popoutSize === 'fullscreen' ? 'large' : 'fullscreen')}
										title={popoutSize === 'fullscreen' ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'}
									>
										<Maximize2 className="h-3 w-3" />
									</Button>
								</>
							)}
							<Button
								variant="ghost"
								size="sm"
								className="h-6 w-6 p-0"
								onClick={handleCopyWidgetInfo}
								title="Copy widget info (Ctrl+Shift+C)"
							>
								<Copy className="h-3 w-3" />
							</Button>
						</div>
					</div>
				</DialogHeader>

				<div className="flex-1 overflow-auto p-6 min-h-0">
					<div className="h-full">
						{/* Clone the widget content for the popup */}
						{React.isValidElement(widget.content)
							? React.cloneElement(widget.content as React.ReactElement, {
								// Pass additional props that widgets can use to optimize for popout
								isPopout: true,
								popoutSize: popoutSize,
								// Provide more space for widgets in popout mode
								maxHeight: 'none',
								containerHeight: '100%',
							})
							: widget.content
						}
					</div>
				</div>

				{/* Footer with widget info and keyboard shortcuts */}
				<div className="border-t border-border px-6 py-3 bg-muted/20">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<div className="flex items-center gap-4">
							<span>Widget ID: {widget.id}</span>
							<span>•</span>
							<span>Size: {popoutSize}</span>
						</div>
						{(widget.popoutPreferences?.showKeyboardShortcuts !== false) && (
							<div className="flex items-center gap-4">
								<span>F11: Fullscreen</span>
								<span>•</span>
								<span>Ctrl+Shift+C: Copy info</span>
								<span>•</span>
								<span>Esc: Close</span>
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
