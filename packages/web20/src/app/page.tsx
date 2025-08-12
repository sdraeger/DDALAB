'use client';

import React, { useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Footer } from '@/components/layout/Footer';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { useAppDispatch, useHeaderVisible, useFooterVisible, useSidebarCollapsed, useWidgets } from '@/store/hooks';
import { useLayoutPersistence } from '@/hooks/useLayoutPersistence';
import { generateId } from '@/lib/utils';
import { Save, RefreshCw, Trash2 } from 'lucide-react';

export default function DashboardPage() {
	const dispatch = useAppDispatch();
	const sidebarCollapsed = useSidebarCollapsed();
	const headerVisible = useHeaderVisible();
	const footerVisible = useFooterVisible();
	const widgets = useWidgets();

	// Use layout persistence hook
	const {
		addWidget,
		removeWidget,
		updateWidget,
		saveLayout,
		loadLayout,
		clearLayout,
		isInitialized
	} = useLayoutPersistence();

	// Add sample widgets only if no saved layout exists
	useEffect(() => {
		// Only add sample widgets if no layout has been loaded and we're initialized
		if (isInitialized && widgets.length === 0) {
			console.log('No saved layout found, adding sample widgets');

			const sampleWidgets = [
				{
					id: generateId(),
					title: 'Analytics Chart',
					type: 'chart',
					position: { x: 10, y: 10 },
					size: { width: 400, height: 300 },
					minSize: { width: 200, height: 150 },
					maxSize: { width: 800, height: 600 },
				},
				{
					id: generateId(),
					title: 'Data Table',
					type: 'table',
					position: { x: 420, y: 10 },
					size: { width: 500, height: 300 },
					minSize: { width: 300, height: 200 },
					maxSize: { width: 1000, height: 800 },
				},
				{
					id: generateId(),
					title: 'Metrics Overview',
					type: 'metrics',
					position: { x: 10, y: 320 },
					size: { width: 300, height: 200 },
					minSize: { width: 150, height: 100 },
					maxSize: { width: 600, height: 400 },
				},
			];

			// Add sample widgets one by one with persistence
			sampleWidgets.forEach(widget => {
				addWidget(widget);
			});
		}
	}, [isInitialized, widgets.length, addWidget]);

	const handleManualSave = async () => {
		try {
			await saveLayout();
			console.log('Layout saved successfully');
		} catch (error) {
			console.error('Failed to save layout:', error);
		}
	};

	const handleManualLoad = async () => {
		try {
			await loadLayout();
			console.log('Layout loaded successfully');
		} catch (error) {
			console.error('Failed to load layout:', error);
		}
	};

	const handleClearLayout = async () => {
		try {
			await clearLayout();
			console.log('Layout cleared successfully');
		} catch (error) {
			console.error('Failed to clear layout:', error);
		}
	};

	return (
		<AuthProvider>
			<div className="min-h-screen w-full bg-background">
				<div className="flex h-screen">
					<Sidebar />
					<div className="flex flex-col flex-1 min-w-0">
						{headerVisible && <Header />}
						<main className="flex-1 overflow-hidden flex flex-col min-h-0">
							<div className="p-6 space-y-6">
								<DashboardStats />

								{/* Layout Controls */}
								<div className="flex items-center gap-2">
									<button
										onClick={handleManualSave}
										className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md"
									>
										<Save className="h-3 w-3" />
										Save Layout
									</button>
									<button
										onClick={handleManualLoad}
										className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md"
									>
										<RefreshCw className="h-3 w-3" />
										Reload
									</button>
									<button
										onClick={handleClearLayout}
										className="inline-flex items-center justify-center gap-1 px-3 py-2 text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-destructive hover:text-destructive"
									>
										<Trash2 className="h-3 w-3" />
										Clear
									</button>
								</div>

								{/* Debug Info */}
								<div className="text-xs text-muted-foreground">
									Widgets: {widgets.length} | Initialized: {isInitialized ? 'Yes' : 'No'}
								</div>
							</div>
							<div className="flex-1 min-h-0 relative">
								<DashboardGrid />
							</div>
						</main>
						{footerVisible && <Footer />}
					</div>
				</div>
			</div>
		</AuthProvider>
	);
} 