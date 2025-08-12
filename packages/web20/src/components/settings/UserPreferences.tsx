'use client';

import React, { useEffect } from 'react';
import { useAppDispatch, useApiUserPreferences, useApiLoading, useApiError } from '@/store/hooks';
import { fetchUserPreferences, updateUserPreferences, resetUserPreferences } from '@/store/slices/apiSlice';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Alert, AlertDescription } from '@/components/ui';
import { Loader2, RefreshCw } from 'lucide-react';

export function UserPreferences() {
	const dispatch = useAppDispatch();
	const preferences = useApiUserPreferences();
	const isLoading = useApiLoading();
	const error = useApiError();

	useEffect(() => {
		dispatch(fetchUserPreferences());
	}, [dispatch]);

	const handleThemeChange = async (theme: 'light' | 'dark' | 'system') => {
		try {
			await dispatch(updateUserPreferences({ theme })).unwrap();
		} catch (error) {
			console.error('Failed to update theme:', error);
		}
	};

	const handleZoomFactorChange = async (value: number[]) => {
		try {
			await dispatch(updateUserPreferences({ eeg_zoom_factor: value[0] })).unwrap();
		} catch (error) {
			console.error('Failed to update zoom factor:', error);
		}
	};

	const handleResetPreferences = async () => {
		try {
			await dispatch(resetUserPreferences()).unwrap();
		} catch (error) {
			console.error('Failed to reset preferences:', error);
		}
	};

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>User Preferences</CardTitle>
					<CardDescription>Manage your application settings</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-6 w-6 animate-spin" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (error) {
		return (
			<Alert variant="destructive">
				<AlertDescription>Failed to load user preferences: {error}</AlertDescription>
			</Alert>
		);
	}

	if (!preferences) {
		return (
			<Alert>
				<AlertDescription>No user preferences found</AlertDescription>
			</Alert>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>User Preferences</CardTitle>
				<CardDescription>Manage your application settings</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="theme">Theme</Label>
					<Select value={preferences.theme} onValueChange={handleThemeChange}>
						<SelectTrigger>
							<SelectValue placeholder="Select a theme" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="light">Light</SelectItem>
							<SelectItem value="dark">Dark</SelectItem>
							<SelectItem value="system">System</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-sm text-muted-foreground">
						Choose your preferred color scheme
					</p>
				</div>

				<div className="space-y-2">
					<Label>EEG Zoom Factor</Label>
					<div className="px-2">
						<Slider
							value={[preferences.eeg_zoom_factor]}
							onValueChange={handleZoomFactorChange}
							max={0.2}
							min={0.01}
							step={0.01}
							className="w-full"
						/>
					</div>
					<p className="text-sm text-muted-foreground">
						Current value: {preferences.eeg_zoom_factor}
					</p>
				</div>

				<div className="flex justify-end">
					<Button
						variant="outline"
						onClick={handleResetPreferences}
						className="flex items-center gap-2"
					>
						<RefreshCw className="h-4 w-4" />
						Reset to Defaults
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
