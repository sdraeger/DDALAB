"use client";

import React from "react";
import { cn } from "../../lib/utils/misc";
import { Loader2, FileText, Zap, Upload, Server } from "lucide-react";
import { Progress } from "./progress";
import type { LoadingOperation } from "../../store/slices/loadingSlice";

interface LoadingOverlayProps {
	show: boolean;
	message?: string;
	progress?: number;
	type?: LoadingOperation['type'];
	variant?: 'modal' | 'inline' | 'fullscreen';
	size?: 'sm' | 'md' | 'lg';
	className?: string;
	children?: React.ReactNode;
}

const typeIcons = {
	'file-load': FileText,
	'dda-processing': Zap,
	'auth': Server,
	'upload': Upload,
	'api-request': Server,
	'data-fetch': FileText,
};

const typeColors = {
	'file-load': 'text-blue-500',
	'dda-processing': 'text-purple-500',
	'auth': 'text-green-500',
	'upload': 'text-orange-500',
	'api-request': 'text-gray-500',
	'data-fetch': 'text-blue-500',
};

export function LoadingOverlay({
	show,
	message = "Loading...",
	progress,
	type = 'api-request',
	variant = 'modal',
	size = 'md',
	className,
	children,
}: LoadingOverlayProps) {
	const Icon = typeIcons[type] || Loader2;
	const iconColor = typeColors[type] || 'text-primary';

	if (!show) return children || null;

	const loadingContent = (
		<div className="flex flex-col items-center justify-center space-y-4">
			{/* Icon and spinner */}
			<div className="relative">
				<Icon className={cn("h-8 w-8", iconColor)} />
				<Loader2 className="absolute inset-0 h-8 w-8 animate-spin text-muted-foreground/30" />
			</div>

			{/* Message */}
			<div className="text-center space-y-2">
				<p className={cn(
					"font-medium",
					size === 'sm' && "text-sm",
					size === 'md' && "text-base",
					size === 'lg' && "text-lg"
				)}>
					{message}
				</p>

				{/* Progress bar */}
				{progress !== undefined && (
					<div className="w-48 space-y-1">
						<Progress value={progress} className="w-full" />
						<p className="text-xs text-muted-foreground text-center">
							{Math.round(progress)}%
						</p>
					</div>
				)}
			</div>
		</div>
	);

	// Fullscreen overlay
	if (variant === 'fullscreen') {
		return (
			<div className={cn(
				"fixed inset-0 z-50 flex items-center justify-center",
				"bg-background/80 backdrop-blur-sm",
				className
			)}>
				{loadingContent}
			</div>
		);
	}

	// Modal overlay
	if (variant === 'modal') {
		return (
			<div className={cn(
				"absolute inset-0 z-40 flex items-center justify-center",
				"bg-background/80 backdrop-blur-sm rounded-lg",
				className
			)}>
				{loadingContent}
			</div>
		);
	}

	// Inline overlay
	return (
		<div className={cn(
			"flex items-center justify-center",
			size === 'sm' && "h-16",
			size === 'md' && "h-24",
			size === 'lg' && "h-32",
			className
		)}>
			{loadingContent}
		</div>
	);
}

// Specialized loading overlays for common use cases
export function FileLoadingOverlay({ show, message, progress, className }: {
	show: boolean;
	message?: string;
	progress?: number;
	className?: string;
}) {
	return (
		<LoadingOverlay
			show={show}
			message={message || "Loading file..."}
			progress={progress}
			type="file-load"
			variant="modal"
			className={className}
		/>
	);
}

export function DDAProcessingOverlay({ show, message, progress, className }: {
	show: boolean;
	message?: string;
	progress?: number;
	className?: string;
}) {
	return (
		<LoadingOverlay
			show={show}
			message={message || "Processing DDA analysis..."}
			progress={progress}
			type="dda-processing"
			variant="fullscreen"
			size="lg"
			className={className}
		/>
	);
}

export function UploadOverlay({ show, message, progress, className }: {
	show: boolean;
	message?: string;
	progress?: number;
	className?: string;
}) {
	return (
		<LoadingOverlay
			show={show}
			message={message || "Uploading file..."}
			progress={progress}
			type="upload"
			variant="modal"
			className={className}
		/>
	);
}

// Simple loading spinner for inline use
export function LoadingSpinner({
	size = 'md',
	message,
	className
}: {
	size?: 'sm' | 'md' | 'lg';
	message?: string;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center space-x-2", className)}>
			<Loader2 className={cn(
				"animate-spin",
				size === 'sm' && "h-4 w-4",
				size === 'md' && "h-5 w-5",
				size === 'lg' && "h-6 w-6"
			)} />
			{message && (
				<span className={cn(
					"text-muted-foreground",
					size === 'sm' && "text-xs",
					size === 'md' && "text-sm",
					size === 'lg' && "text-base"
				)}>
					{message}
				</span>
			)}
		</div>
	);
}
