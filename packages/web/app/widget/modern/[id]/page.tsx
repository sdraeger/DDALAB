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
import { useWidgetDataSync } from "shared/hooks/useWidgetDataSync";
import { useAppDispatch } from "shared/store";
import { setPlotsState } from "shared/store/slices/plotSlice";
import logger from "shared/lib/utils/logger";

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
	const dispatch = useAppDispatch();

	const [widget, setWidget] = useState<IDashboardWidget | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [popoutSize, setPopoutSize] = useState<PopoutSize>('large');

	const widgetId = params?.id as string;
	const widgetFactory = WidgetFactoryService.getInstance();
	const { sendMessage, registerDataListener, unregisterDataListener } = useWidgetDataSync(widgetId, true);

	// Effect for handling data synchronization from the main window
	useEffect(() => {
		if (!widgetId) return;

		const handlePlotsData = (plotsData: any) => {
			if (plotsData && Object.keys(plotsData).length > 0) {
				logger.info(`[Popout] Received plots data for widget ${widgetId}, dispatching to Redux...`);
				dispatch(setPlotsState(plotsData));
			}
		};

		// Listen for the initial data response
		registerDataListener('INITIAL_DATA_RESPONSE', handlePlotsData);

		// Also listen for continuous updates
		registerDataListener('plots', handlePlotsData);

		// Request the initial data from the main window
		logger.info(`[Popout] Requesting initial data for widget ${widgetId}...`);
		sendMessage('INITIAL_DATA_REQUEST', {}, 'plots');

		return () => {
			unregisterDataListener('INITIAL_DATA_RESPONSE');
			unregisterDataListener('plots');
		};
	}, [widgetId, dispatch, registerDataListener, unregisterDataListener, sendMessage]);


	// Effect for initializing the widget from localStorage
	useEffect(() => {
		if (!widgetId) {
			setError("Widget ID not provided");
			return;
		}

		const storageKey = `modern-popped-widget-${widgetId}`;
		const storedWidget = localStorage.getItem(storageKey);

		if (storedWidget) {
			try {
				const parsedWidget: SerializableModernWidget = JSON.parse(storedWidget);

				const recreatedWidget = widgetFactory.createWidget(parsedWidget.type, {
					id: parsedWidget.id,
					title: parsedWidget.title,
					metadata: parsedWidget.metadata,
					isPopout: true,
					popoutSize: popoutSize,
				});

				setWidget(recreatedWidget);

				const defaultSize = parsedWidget.popoutPreferences?.defaultSize || 'large';
				setPopoutSize(defaultSize);

			} catch (err) {
				console.error('Error parsing widget data:', err);
				setError("Failed to parse widget data");
			}
		} else {
			setError("Widget data not found");
		}
	}, [widgetId, widgetFactory, popoutSize]);


	// Effect for handling window messages (e.g., pop-in)
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.origin !== window.location.origin) return;

			if (event.data.type === 'SWAP_IN_MODERN_WIDGET') {
				// This message is handled by the main window, not the pop-out.
				// The pop-out initiates the swap via handleSwapIn.
			}
		};
		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, []);


	const handleSwapIn = useCallback(() => {
		if (window.opener && widget) {
			window.opener.postMessage(
				{
					type: "SWAP_IN_MODERN_WIDGET",
					widgetId: widget.id,
				},
				window.location.origin
			);
			window.close();
		}
	}, [widget]);

	const handleCopyWidgetInfo = useCallback(() => {
		if (!widget) return;

		const widgetInfo = `Widget: ${widget.title}\nType: ${widget.type}\nID: ${widget.id}`;
		navigator.clipboard.writeText(widgetInfo).then(() => {
			toast({
				title: "Widget Info Copied",
				description: "Widget information has been copied to clipboard.",
				duration: 2000,
			});
		});
	}, [widget, toast]);

	const toggleSize = (size: PopoutSize) => {
		setPopoutSize(size);
	};

	const getSizeClasses = () => {
		switch (popoutSize) {
			case 'normal':
				return 'max-w-4xl mx-auto';
			case 'large':
				return 'max-w-7xl mx-auto';
			case 'fullscreen':
				return 'w-full h-full';
			default:
				return 'max-w-7xl mx-auto';
		}
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey) {
				if (event.key === 'c') {
					handleCopyWidgetInfo();
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleCopyWidgetInfo]);

	if (error) {
		return (
			<div className="flex flex-col items-center justify-center min-h-screen bg-muted">
				<div className="text-center p-8 bg-background rounded-lg shadow-xl">
					<h2 className="text-2xl font-bold text-destructive mb-4">Widget Error</h2>
					<p className="text-muted-foreground mb-6">{error}</p>
					<Button onClick={() => router.push('/dashboard')}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Return to Dashboard
					</Button>
				</div>
			</div>
		);
	}

	if (!widget) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-muted">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
					<p className="text-lg font-semibold">Loading Widget...</p>
					<p className="text-muted-foreground">Please wait a moment</p>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("popout-widget-page bg-background flex flex-col h-screen overflow-hidden", getSizeClasses())}>
			{/* Header */}
			<header className="flex items-center justify-between p-3 border-b bg-muted/40 flex-shrink-0">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={handleSwapIn} title="Return to Dashboard">
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div>
						<h1 className="text-lg font-semibold">{widget.title}</h1>
						<p className="text-sm text-muted-foreground">{widget.type}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Button variant={popoutSize === 'normal' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('normal')}>Normal</Button>
					<Button variant={popoutSize === 'large' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('large')}>Large</Button>
					<Button variant={popoutSize === 'fullscreen' ? 'secondary' : 'ghost'} size="sm" onClick={() => toggleSize('fullscreen')}>Fullscreen</Button>
					<Button variant="ghost" size="icon" onClick={handleCopyWidgetInfo} title="Copy Widget Info (Cmd/Ctrl+C)">
						<Copy className="h-5 w-5" />
					</Button>
				</div>
			</header>

			{/* Widget Content */}
			<main className="flex-1 overflow-auto p-4">
				<div className="h-full w-full">
					{widget.content}
				</div>
			</main>
		</div>
	);
}
