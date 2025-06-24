"use client";

import React from "react";
import { cn } from "../../lib/utils/misc";
import { useHorizontalResizable } from "../../hooks/useHorizontalResizable";

interface HorizontalResizableContainerProps {
	children: React.ReactNode;
	className?: string;
	storageKey?: string;
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	enabled?: boolean;
	onWidthChange?: (width: number) => void;
}

export function HorizontalResizableContainer({
	children,
	className,
	storageKey,
	defaultWidth = 300,
	minWidth = 200,
	maxWidth = 600,
	enabled = true,
	onWidthChange,
}: HorizontalResizableContainerProps) {
	const { width, isResizing, resizeHandleProps } = useHorizontalResizable({
		storageKey,
		defaultWidth,
		minWidth,
		maxWidth,
		onWidthChange,
	});

	if (!enabled) {
		return (
			<div className={className} style={{ width: defaultWidth }}>
				{children}
			</div>
		);
	}

	return (
		<div
			className={cn("relative overflow-visible", className)}
			style={{ width }}
		>
			{children}

			{/* Resize Handle */}
			<div
				{...resizeHandleProps}
				title="Drag to resize width"
				className={cn(
					resizeHandleProps.className,
					isResizing && "bg-primary/15 border-primary/70"
				)}
			>
				{/* Prominent resize indicator with double bars and arrows */}
				<div
					className={cn(
						"flex flex-row items-center justify-center w-full h-full gap-0.5 transition-all duration-200",
						isResizing
							? "opacity-100 scale-110"
							: "opacity-60 group-hover:opacity-100"
					)}
				>
					{/* Left arrow */}
					<div
						className={cn(
							"w-0 h-0 border-t-2 border-b-2 border-r-2 border-transparent transition-colors",
							isResizing
								? "border-r-primary"
								: "border-r-muted-foreground group-hover:border-r-primary"
						)}
					/>

					{/* Double bars */}
					<div className="flex flex-row gap-0.5">
						<div
							className={cn(
								"w-0.5 h-8 rounded-full transition-colors",
								isResizing
									? "bg-primary"
									: "bg-muted-foreground/60 group-hover:bg-primary/80"
							)}
						/>
						<div
							className={cn(
								"w-0.5 h-8 rounded-full transition-colors",
								isResizing
									? "bg-primary"
									: "bg-muted-foreground/60 group-hover:bg-primary/80"
							)}
						/>
					</div>

					{/* Right arrow */}
					<div
						className={cn(
							"w-0 h-0 border-t-2 border-b-2 border-l-2 border-transparent transition-colors",
							isResizing
								? "border-l-primary"
								: "border-l-muted-foreground group-hover:border-l-primary"
						)}
					/>
				</div>

				{/* Subtle background highlight with shadow */}
				<div
					className={cn(
						"absolute inset-0 bg-gradient-to-b from-transparent to-transparent transition-all duration-200",
						"shadow-sm group-hover:shadow-md",
						isResizing
							? "via-primary/15 shadow-lg shadow-primary/25"
							: "via-muted-foreground/5 group-hover:via-primary/10"
					)}
				/>

				{/* Optional dotted guide lines for better visibility */}
				<div
					className={cn(
						"absolute top-0 bottom-0 left-1 w-px bg-dotted opacity-0 transition-opacity duration-200",
						"group-hover:opacity-30",
						isResizing && "opacity-60"
					)}
					style={{
						backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
						backgroundSize: "1px 6px",
						backgroundRepeat: "repeat-y",
					}}
				/>
			</div>

			{/* Resize feedback overlay */}
			{isResizing && (
				<div className="absolute top-2 right-2 bg-background/90 border rounded px-2 py-1 text-xs font-mono backdrop-blur-sm">
					{width}px
				</div>
			)}
		</div>
	);
}
