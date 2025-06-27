"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SimpleWidget, SerializableWidget } from "shared/components/dashboard/SimpleDashboardGrid";
import { Button } from "shared/components/ui/button";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { createWidgetContent } from "shared/lib/utils/widgetFactory";

interface PoppedOutWidgetPageProps { }

export default function PoppedOutWidgetPage({ }: PoppedOutWidgetPageProps) {
	const params = useParams();
	const router = useRouter();
	const [widget, setWidget] = useState<SimpleWidget | null>(null);
	const [error, setError] = useState<string | null>(null);

	const widgetId = params?.id as string;

	useEffect(() => {
		if (!widgetId) {
			setError("Widget ID not provided");
			return;
		}

		// Get widget data from localStorage (passed from parent window)
		const storageKey = `popped-widget-${widgetId}`;
		const storedWidget = localStorage.getItem(storageKey);

		if (storedWidget) {
			try {
				const parsedWidget: SerializableWidget = JSON.parse(storedWidget);
				// Reconstruct the widget with content based on type
				const reconstructedWidget: SimpleWidget = {
					...parsedWidget,
					content: createWidgetContent(parsedWidget.type)
				};
				setWidget(reconstructedWidget);
			} catch (err) {
				setError("Failed to parse widget data");
			}
		} else {
			setError("Widget data not found");
		}

		// Listen for updates from parent window
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === storageKey && e.newValue) {
				try {
					const updatedWidget: SerializableWidget = JSON.parse(e.newValue);
					// Reconstruct the widget with content based on type
					const reconstructedWidget: SimpleWidget = {
						...updatedWidget,
						content: createWidgetContent(updatedWidget.type)
					};
					setWidget(reconstructedWidget);
				} catch (err) {
					console.error("Failed to parse updated widget data", err);
				}
			}
		};

		window.addEventListener("storage", handleStorageChange);
		return () => window.removeEventListener("storage", handleStorageChange);
	}, [widgetId]);

	const handleSwapIn = () => {
		// Signal to parent window to swap the widget back in
		if (window.opener && widget) {
			window.opener.postMessage(
				{
					type: "SWAP_IN_WIDGET",
					widgetId: widget.id,
				},
				window.location.origin
			);
			window.close();
		} else {
			// Fallback: redirect to dashboard
			router.push("/dashboard");
		}
	};

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background">
				<div className="text-center space-y-4">
					<div className="text-destructive text-lg font-medium">Error</div>
					<div className="text-muted-foreground">{error}</div>
					<Button onClick={() => router.push("/dashboard")} className="gap-2">
						<ArrowLeft className="h-4 w-4" />
						Return to Dashboard
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
		<div className="min-h-screen bg-background flex flex-col">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b bg-muted/5">
				<div className="flex items-center gap-3">
					<h1 className="text-lg font-semibold">{widget.title}</h1>
					<span className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
						Pop-out Widget
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Button onClick={handleSwapIn} variant="outline" size="sm" className="gap-2">
						<RotateCcw className="h-4 w-4" />
						Swap Back to Dashboard
					</Button>
					<Button
						onClick={() => router.push("/dashboard")}
						variant="outline"
						size="sm"
						className="gap-2"
					>
						<ArrowLeft className="h-4 w-4" />
						Dashboard
					</Button>
				</div>
			</div>

			{/* Widget Content */}
			<div className="flex-1 p-6">
				<div className="h-full bg-background border border-border rounded-lg shadow-sm overflow-hidden">
					<div className="h-full p-4 overflow-auto">
						{widget.content}
					</div>
				</div>
			</div>
		</div>
	);
}
