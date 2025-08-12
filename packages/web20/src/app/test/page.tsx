'use client';

import React from 'react';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { useAppDispatch, useWidgets } from '@/store/hooks';
import { addWidget } from '@/store/slices/dashboardSlice';
import { generateId } from '@/lib/utils';

export default function TestPage() {
	const dispatch = useAppDispatch();
	const widgets = useWidgets();

	const addTestWidget = () => {
		const newWidget = {
			id: generateId(),
			title: `Test Widget ${widgets.length + 1}`,
			type: 'test',
			position: { x: Math.random() * 400, y: Math.random() * 300 },
			size: { width: 300, height: 200 },
			minSize: { width: 150, height: 100 },
			maxSize: { width: 600, height: 400 },
		};
		dispatch(addWidget(newWidget));
	};

	return (
		<div className="h-screen flex flex-col">
			<div className="p-4 border-b">
				<h1 className="text-2xl font-bold mb-4">Dashboard Test Page</h1>
				<div className="flex gap-4">
					<button
						onClick={addTestWidget}
						className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
					>
						Add Test Widget
					</button>
					<span className="py-2 text-sm text-gray-600">
						Widgets: {widgets.length}
					</span>
				</div>
			</div>
			<div className="flex-1">
				<DashboardGrid />
			</div>
		</div>
	);
} 