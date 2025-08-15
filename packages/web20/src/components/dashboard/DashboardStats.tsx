'use client';

import React, { useEffect } from 'react';
import { useAppDispatch, useDashboardStats, useApiLoading, useApiError } from '@/store/hooks';
import { fetchDashboardStats } from '@/store/slices/apiSlice';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { Badge } from '@/components/ui';
import { Alert, AlertDescription } from '@/components/ui';
import { Activity, Database, Users, BarChart3 } from 'lucide-react';
import { useSearchable, useSearchableItems } from '@/hooks/useSearchable';

export function DashboardStats() {
	const dispatch = useAppDispatch();
	const stats = useDashboardStats();
	const isLoading = useApiLoading();
	const error = useApiError();

	useEffect(() => {
		dispatch(fetchDashboardStats());
	}, [dispatch]);

	// Make dashboard stats searchable
	const statsItems = useSearchableItems(
		'dashboard-stats',
		'metrics',
		stats ? [
			{ 
				title: 'Total Artifacts',
				value: stats.totalArtifacts,
				description: 'Data artifacts in the system',
				icon: 'database'
			},
			{
				title: 'Total Analyses', 
				value: stats.totalAnalyses,
				description: 'Completed analyses',
				icon: 'chart'
			},
			{
				title: 'Active Users',
				value: stats.activeUsers, 
				description: 'Users active in last 30 minutes',
				icon: 'users'
			},
			{
				title: 'System Health',
				value: stats.systemHealth,
				description: 'Overall system status',
				icon: 'activity'
			}
		] : [],
		(item, index) => ({
			title: `${item.title}: ${item.value}`,
			description: item.description,
			keywords: [item.title.toLowerCase(), 'dashboard', 'metrics', 'stats', item.icon],
			onSelect: () => {
				// Could scroll to the specific metric or show details
				console.log(`Selected metric: ${item.title}`);
			},
			icon: React.createElement(
				item.icon === 'database' ? Database :
				item.icon === 'chart' ? BarChart3 :
				item.icon === 'users' ? Users : Activity,
				{ className: 'h-4 w-4' }
			),
		})
	);

	useSearchable({
		id: 'dashboard-stats',
		category: 'metrics',
		items: statsItems,
		priority: 7,
	});

	if (isLoading) {
		return (
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				{[...Array(4)].map((_, i) => (
					<Card key={i} className="animate-pulse">
						<CardHeader className="pb-2">
							<div className="h-4 bg-muted rounded w-3/4"></div>
						</CardHeader>
						<CardContent>
							<div className="h-8 bg-muted rounded w-1/2"></div>
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Alert variant="destructive">
				<AlertDescription>Failed to load dashboard statistics: {error}</AlertDescription>
			</Alert>
		);
	}

	if (!stats) {
		return null;
	}

	const getHealthColor = (health: string) => {
		switch (health) {
			case 'excellent':
				return 'bg-green-500';
			case 'good':
				return 'bg-blue-500';
			case 'fair':
				return 'bg-yellow-500';
			case 'poor':
				return 'bg-red-500';
			default:
				return 'bg-gray-500';
		}
	};

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Total Artifacts</CardTitle>
					<Database className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{stats.totalArtifacts}</div>
					<p className="text-xs text-muted-foreground">
						Data artifacts in the system
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Total Analyses</CardTitle>
					<BarChart3 className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{stats.totalAnalyses}</div>
					<p className="text-xs text-muted-foreground">
						Completed analyses
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Active Users</CardTitle>
					<Users className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{stats.activeUsers}</div>
					<p className="text-xs text-muted-foreground">
						Users active in last 30 minutes
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">System Health</CardTitle>
					<Activity className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="flex items-center space-x-2">
						<Badge
							variant="secondary"
							className={`${getHealthColor(stats.systemHealth)} text-white`}
						>
							{stats.systemHealth}
						</Badge>
					</div>
					<p className="text-xs text-muted-foreground mt-1">
						Overall system status
					</p>
				</CardContent>
			</Card>
		</div>
	);
} 