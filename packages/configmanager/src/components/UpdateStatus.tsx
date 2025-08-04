import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { RefreshCw, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface UpdateInfo {
	version: string;
	releaseDate: string;
	releaseNotes?: string;
	currentVersion?: string;
	newVersion?: string;
}

interface UpdateStatus {
	status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'idle';
	message: string;
	data?: UpdateInfo;
	timestamp?: string;
}

declare global {
	interface Window {
		electronAPI: import("../../preload").ElectronAPI;
	}
}

export const UpdateStatus: React.FC = () => {
	const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
		status: 'idle',
		message: 'No update check performed'
	});
	const [currentVersion, setCurrentVersion] = useState<string>('');
	const [environment, setEnvironment] = useState<string>('');
	const [isChecking, setIsChecking] = useState(false);

	useEffect(() => {
		// Get initial version and environment
		const getInitialData = async () => {
			try {
				const version = await window.electronAPI.getCurrentVersion();
				const env = await window.electronAPI.getEnvironment();
				setCurrentVersion(version);
				setEnvironment(env);
			} catch (error) {
				console.error('Error getting initial data:', error);
			}
		};

		getInitialData();

		// Listen for update status events from main process
		const removeListener = window.electronAPI.onUpdateStatus((data) => {
			const status: UpdateStatus = {
				status: data.status as any,
				message: data.message,
				data: data.data,
				timestamp: data.timestamp
			};
			setUpdateStatus(status);
			setIsChecking(false);
		});

		return () => {
			removeListener();
		};
	}, []);

	const handleCheckForUpdates = async () => {
		setIsChecking(true);
		setUpdateStatus({
			status: 'checking',
			message: 'Checking for updates...'
		});

		try {
			await window.electronAPI.checkForUpdates();
		} catch (error) {
			console.error('Error checking for updates:', error);
			setUpdateStatus({
				status: 'error',
				message: 'Failed to check for updates'
			});
			setIsChecking(false);
		}
	};

	const handleDownloadUpdate = async () => {
		try {
			await window.electronAPI.downloadUpdate();
		} catch (error) {
			console.error('Error downloading update:', error);
		}
	};

	const getStatusIcon = () => {
		switch (updateStatus.status) {
			case 'checking':
				return <RefreshCw className="h-4 w-4 animate-spin" />;
			case 'available':
				return <Download className="h-4 w-4 text-blue-500" />;
			case 'downloading':
				return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />;
			case 'downloaded':
				return <CheckCircle className="h-4 w-4 text-green-500" />;
			case 'error':
				return <XCircle className="h-4 w-4 text-red-500" />;
			case 'not-available':
				return <CheckCircle className="h-4 w-4 text-green-500" />;
			default:
				return <AlertCircle className="h-4 w-4 text-gray-500" />;
		}
	};

	const getStatusColor = () => {
		switch (updateStatus.status) {
			case 'available':
				return 'bg-blue-100 text-blue-800 border-blue-200';
			case 'downloading':
				return 'bg-blue-100 text-blue-800 border-blue-200';
			case 'downloaded':
				return 'bg-green-100 text-green-800 border-green-200';
			case 'error':
				return 'bg-red-100 text-red-800 border-red-200';
			case 'not-available':
				return 'bg-green-100 text-green-800 border-green-200';
			default:
				return 'bg-gray-100 text-gray-800 border-gray-200';
		}
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{getStatusIcon()}
					Update Status
				</CardTitle>
				<CardDescription>
					Current version: {currentVersion} ({environment})
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between">
					<Badge className={getStatusColor()}>
						{updateStatus.status.replace('-', ' ').toUpperCase()}
					</Badge>
					<div className="flex gap-2">
						<Button
							onClick={handleCheckForUpdates}
							disabled={isChecking}
							size="sm"
							variant="outline"
						>
							{isChecking ? (
								<>
									<RefreshCw className="h-4 w-4 animate-spin mr-2" />
									Checking...
								</>
							) : (
								<>
									<RefreshCw className="h-4 w-4 mr-2" />
									Check for Updates
								</>
							)}
						</Button>
						{environment === 'dev' && (
							<Button
								onClick={() => window.electronAPI.testUpdateCheck()}
								size="sm"
								variant="secondary"
							>
								Test Update
							</Button>
						)}
					</div>
				</div>

				<div className="text-sm text-gray-600">
					{updateStatus.message}
				</div>

				{updateStatus.data && updateStatus.status === 'available' && (
					<Alert>
						<AlertDescription>
							<div className="space-y-2">
								<div>
									<strong>New Version:</strong> {updateStatus.data.newVersion}
								</div>
								<div>
									<strong>Release Date:</strong> {updateStatus.data.releaseDate}
								</div>
								{updateStatus.data.releaseNotes && (
									<div>
										<strong>Release Notes:</strong>
										<div className="mt-1 text-sm bg-gray-50 p-2 rounded">
											{updateStatus.data.releaseNotes}
										</div>
									</div>
								)}
								<Button
									onClick={handleDownloadUpdate}
									className="w-full mt-2"
									size="sm"
								>
									<Download className="h-4 w-4 mr-2" />
									Download Update
								</Button>
							</div>
						</AlertDescription>
					</Alert>
				)}

				{updateStatus.timestamp && (
					<div className="text-xs text-gray-500">
						Last checked: {new Date(updateStatus.timestamp).toLocaleString()}
					</div>
				)}
			</CardContent>
		</Card>
	);
}; 