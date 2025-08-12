'use client';

import React from 'react';
import { useAppDispatch, useFooterVisible } from '@/store/hooks';
import { toggleFooter } from '@/store/slices/userSlice';
import {
	Activity,
	Wifi,
	Database,
	EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui';

export function Footer() {
	const dispatch = useAppDispatch();
	const footerVisible = useFooterVisible();

	if (!footerVisible) return null;

	return (
		<footer className="flex h-12 items-center justify-between border-t bg-background px-4 text-sm">
			<div className="flex items-center gap-4">
				{/* Status Indicators */}
				<div className="flex items-center gap-2">
					<div className="flex items-center gap-1">
						<div className="h-2 w-2 rounded-full bg-green-500" />
						<span className="text-muted-foreground">Online</span>
					</div>

					<div className="flex items-center gap-1">
						<Wifi className="h-3 w-3 text-muted-foreground" />
						<span className="text-muted-foreground">Connected</span>
					</div>

					<div className="flex items-center gap-1">
						<Database className="h-3 w-3 text-muted-foreground" />
						<span className="text-muted-foreground">DB: Active</span>
					</div>
				</div>

				{/* System Status */}
				<div className="flex items-center gap-2">
					<Activity className="h-3 w-3 text-muted-foreground" />
					<span className="text-muted-foreground">CPU: 23%</span>
					<span className="text-muted-foreground">•</span>
					<span className="text-muted-foreground">Memory: 45%</span>
				</div>
			</div>

			<div className="flex items-center gap-2">
				{/* Version Info */}
				<span className="text-muted-foreground">v1.0.0</span>

				{/* Footer Toggle */}
				<Button
					variant="ghost"
					size="sm"
					onClick={() => dispatch(toggleFooter())}
					className="h-6 w-6 p-0"
				>
					<EyeOff className="h-3 w-3" />
				</Button>
			</div>
		</footer>
	);
}
