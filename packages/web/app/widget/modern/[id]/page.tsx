"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "shared/components/ui/button";
import { ArrowLeft, RotateCcw, Maximize2, Minimize2, Copy } from "lucide-react";
import { WidgetFactoryService } from "shared/services/WidgetFactoryService";
import { IDashboardWidget } from "shared/types/dashboard";
import { useToast } from "shared/components/ui/use-toast";
import { cn } from "shared/lib/utils/misc";

interface SerializableModernWidget {
	id: string;
	title: string;
	type: string;
	metadata?: Record<string, any>;
	constraints?: any;
	supportsPopout?: boolean;
	popoutPreferences?: any;
}

type PopoutSize = 'normal' | 'large' | 'fullscreen';

export default function ModernWidgetPopoutPage() {
	const params = useParams();
	const router = useRouter();
	const { data: session } = useSession();
	const { toast } = useToast();

	const [widget, setWidget] = useState<IDashboardWidget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [popoutSize, setPopoutSize] = useState<PopoutSize>('large');

	const widgetId = params?.id as string;
	const widgetFactory = WidgetFactoryService.getInstance();

	useEffect(() => {
		if (!widgetId) {
			setError("Widget ID not provided");
			return;
		}

		// Get widget data from localStorage (passed from parent window)
		const storageKey = `modern-popped-widget-${widgetId}`;
		const storedWidget = localStorage.getItem(storageKey);

		if (storedWidget) {
			try {
				const parsedWidget: SerializableModernWidget = JSON.parse(storedWidget);

				// Restore captured widget states to localStorage for synchronization
				if (parsedWidget.metadata?.capturedStates) {
					Object.entries(parsedWidget.metadata.capturedStates).forEach(([key, state]) => {
						localStorage.setItem(key, JSON.stringify(state));
					});
				}

				// Initialize plots data for widgets that depend on it
				if (parsedWidget.metadata?.initialPlotsState) {
					try {
						// Store the initial plots state for data synchronization
						const plotsKey = `widget-data-update-${widgetId}`;
						const plotsMessage = {
							type: 'DATA_UPDATE',
							widgetId: widgetId,
							dataType: 'plots',
							data: parsedWidget.metadata.initialPlotsState,
							timestamp: Date.now(),
						};
						localStorage.setItem(plotsKey, JSON.stringify(plotsMessage));

						console.log(`Initialized plots data for popout widget: ${widgetId}`);
					} catch (error) {
						console.warn('Failed to initialize plots state for popout:', error);
					}
				}

				// Recreate the widget using the factory
				const recreatedWidget = widgetFactory.createWidget(parsedWidget.type, {
					id: parsedWidget.id,
					title: parsedWidget.title,
					metadata: parsedWidget.metadata,
					// Pass popout-specific props
					isPopout: true,
					popoutSize: popoutSize,
					maxHeight: 'none',
					containerHeight: '100%',
					// Pass any plot state data for chart widgets
					popoutPlotState: parsedWidget.metadata?.plotState,
				});

				setWidget(recreatedWidget);

				// Set initial size based on widget preferences
				const defaultSize = parsedWidget.popoutPreferences?.defaultSize || 'large';
				setPopoutSize(defaultSize);

			} catch (err) {
				console.error('Error parsing widget data:', err);
				setError("Failed to parse widget data");
			}
		} else {
			setError("Widget data not found");
		}

		// Listen for updates from parent window
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === storageKey && e.newValue) {
				try {
					const updatedWidget: SerializableModernWidget = JSON.parse(e.newValue);

					// Restore captured widget states
					if (updatedWidget.metadata?.capturedStates) {
						Object.entries(updatedWidget.metadata.capturedStates).forEach(([key, state]) => {
							localStorage.setItem(key, JSON.stringify(state));
						});
					}

					// Update plots data if available
					if (updatedWidget.metadata?.initialPlotsState) {
						try {
							const plotsKey = `widget-data-update-${widgetId}`;
							const plotsMessage = {
								type: 'DATA_UPDATE',
								widgetId: widgetId,
								dataType: 'plots',
								data: updatedWidget.metadata.initialPlotsState,
								timestamp: Date.now(),
							};
							localStorage.setItem(plotsKey, JSON.stringify(plotsMessage));
						} catch (error) {
							console.warn('Failed to update plots state for popout:', error);
						}
					}

					const recreatedWidget = widgetFactory.createWidget(updatedWidget.type, {
						id: updatedWidget.id,
						title: updatedWidget.title,
						metadata: updatedWidget.metadata,
						isPopout: true,
						popoutSize: popoutSize,
						maxHeight: 'none',
						containerHeight: '100%',
						popoutPlotState: updatedWidget.metadata?.plotState,
					});
					setWidget(recreatedWidget);
				} catch (err) {
					console.error("Failed to parse updated widget data", err);
				}
			}
		};

		// Listen for messages from parent window
		const handleMessage = (e: MessageEvent) => {
			if (e.origin !== window.location.origin) return;

			if (e.data.type === 'UPDATE_WIDGET_DATA' && e.data.widgetId === widgetId) {
				// Handle real-time updates from parent dashboard
				try {
					// Restore captured widget states from message
					if (e.data.widget.metadata?.capturedStates) {
						Object.entries(e.data.widget.metadata.capturedStates).forEach(([key, state]) => {
							localStorage.setItem(key, JSON.stringify(state));
						});
					}

					// Update plots data from message if available
					if (e.data.widget.metadata?.initialPlotsState) {
						try {
							const plotsKey = `widget-data-update-${widgetId}`;
							const plotsMessage = {
								type: 'DATA_UPDATE',
								widgetId: widgetId,
								dataType: 'plots',
								data: e.data.widget.metadata.initialPlotsState,
								timestamp: Date.now(),
							};
							localStorage.setItem(plotsKey, JSON.stringify(plotsMessage));
						} catch (error) {
							console.warn('Failed to update plots state from message:', error);
						}
					}

					const updatedWidget = widgetFactory.createWidget(e.data.widget.type, {
						...e.data.widget,
						isPopout: true,
						popoutSize: popoutSize,
						maxHeight: 'none',
						containerHeight: '100%',
						popoutPlotState: e.data.widget.metadata?.plotState,
					});
					setWidget(updatedWidget);
				} catch (err) {
					console.error("Failed to update widget from message", err);
				}
			}
		};

		window.addEventListener("storage", handleStorageChange);
		window.addEventListener("message", handleMessage);

		return () => {
			window.removeEventListener("storage", handleStorageChange);
			window.removeEventListener("message", handleMessage);
		};
	}, [widgetId, widgetFactory, popoutSize]);

	const handleSwapIn = useCallback(() => {
		// Signal to parent window to swap the widget back in
		if (window.opener && widget) {
			window.opener.postMessage(
				{
					type: "SWAP_IN_MODERN_WIDGET",
					widgetId: widget.id,
				},
				window.location.origin
			);

			toast({
				title: "Widget Returned",
				description: `${widget.title} has been returned to the dashboard.`,
				duration: 2000,
			});

			// Clean up localStorage
			localStorage.removeItem(`modern-popped-widget-${widgetId}`);

			// Close the window after a short delay
			setTimeout(() => {
				window.close();
			}, 500);
		} else {
			// Fallback: redirect to dashboard
			router.push("/dashboard/modern");
		}
	}, [widget, widgetId, toast, router]);

	const handleCopyWidgetInfo = useCallback(() => {
		if (!widget) return;

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
				return "max-w-4xl mx-auto";
			case 'large':
				return "max-w-6xl mx-auto";
			case 'fullscreen':
				return "w-full";
			default:
				return "max-w-6xl mx-auto";
		}
	};

	// Handle keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// F11 for fullscreen toggle
			if (event.key === 'F11') {
				event.preventDefault();
				setPopoutSize(prev => prev === 'fullscreen' ? 'large' : 'fullscreen');
			}

			// Ctrl+Shift+C to copy widget info
			if ((event.metaKey || event.ctrlKey) && event.key === 'c' && event.shiftKey) {
				event.preventDefault();
				handleCopyWidgetInfo();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleCopyWidgetInfo]);

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<div className="text-center space-y-4">
					<div className="text-destructive text-lg font-medium">Error</div>
					<div className="text-muted-foreground">{error}</div>
					<Button onClick={() => router.push("/dashboard/modern")} className="gap-2">
						<ArrowLeft className="h-4 w-4" />
						Return to Modern Dashboard
					</Button>
				</div>
			</div>
		);
	}

	if (!widget) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<div className="text-center space-y-4">
					<div className="text-lg font-medium">Loading widget...</div>
					<div className="text-muted-foreground">Please wait while the widget loads.</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-background to-muted/20 flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b bg-background/80 backdrop-blur-sm">
				<div className="flex items-center gap-3">
					<h1 className="text-lg font-semibold">{widget.title}</h1>
					<span className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded-md font-normal">
						{widget.type}
					</span>
					<span className="text-xs text-muted-foreground bg-primary/10 text-primary px-2 py-1 rounded">
						Popped Out
					</span>
				</div>

				<div className="flex items-center gap-2">
					{/* Size controls */}
					<div className="flex items-center gap-1 mr-2">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 p-0"
							onClick={() => setPopoutSize('normal')}
							title="Normal size"
							disabled={popoutSize === 'normal'}
						>
							<Minimize2 className="h-3 w-3" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 p-0"
							onClick={() => setPopoutSize(popoutSize === 'fullscreen' ? 'large' : 'fullscreen')}
							title={popoutSize === 'fullscreen' ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'}
						>
							<Maximize2 className="h-3 w-3" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 w-7 p-0"
							onClick={handleCopyWidgetInfo}
							title="Copy widget info (Ctrl+Shift+C)"
						>
							<Copy className="h-3 w-3" />
						</Button>
					</div>

					<Button onClick={handleSwapIn} variant="outline" size="sm" className="gap-2">
						<RotateCcw className="h-4 w-4" />
						Return to Dashboard
					</Button>
					<Button
						onClick={() => router.push("/dashboard/modern")}
						variant="outline"
						size="sm"
						className="gap-2"
					>
						<ArrowLeft className="h-4 w-4" />
						Modern Dashboard
					</Button>
				</div>
			</div>

			{/* Widget Content */}
			<div className="flex-1 p-6">
				<div className={cn("h-full transition-all duration-200", getSizeClasses())}>
					<div className="h-full bg-background border border-border rounded-lg shadow-sm overflow-hidden">
						<div className="h-full overflow-auto">
							<div className="p-6 h-full">
								{widget.content}
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Footer */}
			<div className="border-t border-border px-6 py-3 bg-muted/20">
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<div className="flex items-center gap-4">
						<span>Widget ID: {widget.id}</span>
						<span>•</span>
						<span>Size: {popoutSize}</span>
						<span>•</span>
						<span>Session: {session?.user?.email || 'Guest'}</span>
					</div>
					<div className="flex items-center gap-4">
						<span>F11: Fullscreen</span>
						<span>•</span>
						<span>Ctrl+Shift+C: Copy info</span>
						<span>•</span>
						<span>Return to sync with dashboard</span>
					</div>
				</div>
			</div>
		</div>
	);
}
