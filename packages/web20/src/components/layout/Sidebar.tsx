'use client';

import React, { useState } from 'react';
import { useAppDispatch, useSidebarCollapsed } from '@/store/hooks';
import { setSidebarCollapsed } from '@/store/slices/userSlice';
import { addWidget } from '@/store/slices/dashboardSlice';
import {
	LayoutDashboard,
	BarChart3,
	Settings,
	Users,
	FileText,
	Database,
	ChevronLeft,
	ChevronRight,
	Plus,
	Grid3X3
} from 'lucide-react';
import { Button, ScrollArea, Separator } from '@/components/ui/index';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AddWidgetDialog, WidgetType } from '@/components/dialog/AddWidgetDialog';
import { createWidgetFromType } from '@/lib/widgetFactory';
import { useLayoutPersistence } from '@/hooks/useLayoutPersistence';

interface SidebarProps {
	className?: string;
}

export function Sidebar({ className }: SidebarProps) {
	const dispatch = useAppDispatch();
	const sidebarCollapsed = useSidebarCollapsed();
	const [addWidgetDialogOpen, setAddWidgetDialogOpen] = useState(false);
	const { addWidget: addWidgetPersist } = useLayoutPersistence();

	const handleAddWidget = (widgetType: WidgetType) => {
		const widget = createWidgetFromType(widgetType);
		// Use persistence-aware add to avoid overwrite on initial load
		addWidgetPersist(widget);
	};

	const navigationItems = [
		{
			title: 'Dashboard',
			icon: LayoutDashboard,
			href: '/',
			active: true,
		},
		{
			title: 'Analytics',
			icon: BarChart3,
			href: '/analytics',
			active: false,
		},
		{
			title: 'Users',
			icon: Users,
			href: '/users',
			active: false,
		},
		{
			title: 'Documents',
			icon: FileText,
			href: '/documents',
			active: false,
		},
		{
			title: 'Database',
			icon: Database,
			href: '/database',
			active: false,
		},
	];

	const widgetTypes = [
		{
			title: 'Chart Widget',
			icon: BarChart3,
			type: 'chart',
		},
		{
			title: 'Data Table',
			icon: Database,
			type: 'table',
		},
		{
			title: 'Metrics',
			icon: LayoutDashboard,
			type: 'metrics',
		},
		{
			title: 'File Browser',
			icon: FileText,
			type: 'file-browser',
		},
	];

	return (
		<div
			className={cn(
				'flex h-full flex-col border-r bg-background transition-all duration-300',
				sidebarCollapsed ? 'w-16' : 'w-64',
				className
			)}
		>
			{/* Header */}
			<div className="flex h-16 items-center justify-between border-b px-4">
				{!sidebarCollapsed && (
					<div className="flex items-center gap-2">
						<Grid3X3 className="h-6 w-6 text-primary" />
						<span className="font-semibold">DDALAB</span>
					</div>
				)}
				<Button
					variant="ghost"
					size="sm"
					onClick={() => dispatch(setSidebarCollapsed(!sidebarCollapsed))}
					className="h-8 w-8 p-0"
				>
					{sidebarCollapsed ? (
						<ChevronRight className="h-4 w-4" />
					) : (
						<ChevronLeft className="h-4 w-4" />
					)}
				</Button>
			</div>

			{/* Navigation */}
			<ScrollArea className="flex-1">
				<div className="p-4">
					<div className="space-y-2">
						{!sidebarCollapsed && (
							<h3 className="text-sm font-medium text-muted-foreground">Navigation</h3>
						)}
						{navigationItems.map((item) => (
							<Link key={item.href} href={item.href} className="block">
								<Button
									variant={item.active ? 'secondary' : 'ghost'}
									className={cn(
										'w-full justify-start',
										sidebarCollapsed && 'justify-center px-2'
									)}
								>
									<item.icon className={cn('h-4 w-4', !sidebarCollapsed && 'mr-2')} />
									{!sidebarCollapsed && item.title}
								</Button>
							</Link>
						))}
					</div>

					<Separator className="my-4" />

					{/* Widget Types */}
					<div className="space-y-2">
						{!sidebarCollapsed && (
							<h3 className="text-sm font-medium text-muted-foreground">Widgets</h3>
						)}
						{widgetTypes.map((widget) => (
							<Button
								key={widget.type}
								variant="ghost"
								className={cn(
									'w-full justify-start',
									sidebarCollapsed && 'justify-center px-2'
								)}
								onClick={() => handleAddWidget({
									id: widget.type,
									title: widget.title,
									description: '',
									icon: widget.icon,
									type: widget.type,
									defaultSize: widget.type === 'metrics' ? { width: 300, height: 200 } : widget.type === 'table' ? { width: 500, height: 300 } : widget.type === 'file-browser' ? { width: 350, height: 400 } : { width: 400, height: 300 },
									minSize: { width: 200, height: 150 },
									maxSize: { width: 1000, height: 800 },
									category: widget.type === 'file-browser' ? 'utility' : 'visualization'
								} as any)}
							>
								<widget.icon className={cn('h-4 w-4', !sidebarCollapsed && 'mr-2')} />
								{!sidebarCollapsed && widget.title}
							</Button>
						))}
					</div>

					<Separator className="my-4" />

					{/* Settings */}
					<div className="space-y-2">
						{!sidebarCollapsed && (
							<h3 className="text-sm font-medium text-muted-foreground">Settings</h3>
						)}
						<Button
							variant="ghost"
							className={cn(
								'w-full justify-start',
								sidebarCollapsed && 'justify-center px-2'
							)}
						>
							<Settings className={cn('h-4 w-4', !sidebarCollapsed && 'mr-2')} />
							{!sidebarCollapsed && 'Settings'}
						</Button>
					</div>
				</div>
			</ScrollArea>

			{/* Footer */}
			{!sidebarCollapsed && (
				<div className="border-t p-4">
					<Button
						className="w-full"
						size="sm"
						onClick={() => setAddWidgetDialogOpen(true)}
					>
						<Plus className="mr-2 h-4 w-4" />
						Add Widget
					</Button>
				</div>
			)}

			{/* Add Widget Dialog */}
			<AddWidgetDialog
				open={addWidgetDialogOpen}
				onOpenChange={setAddWidgetDialogOpen}
				onAddWidget={handleAddWidget}
			/>
		</div>
	);
}
