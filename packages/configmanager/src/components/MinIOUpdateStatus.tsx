import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { RefreshCw, Download, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface MinIOUpdateInfo {
	currentVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
	lastChecked: string;
}

declare global {
	interface Window {
		electronAPI: import("../../preload").ElectronAPI;
	}
}

export const MinIOUpdateStatus: React.FC = () => {
	const [updateInfo, setUpdateInfo] = useState<MinIOUpdateInfo | null>(null);
	const [isChecking, setIsChecking] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [updateResult, setUpdateResult] = useState<{ success: boolean; message: string } | null>(null);

	useEffect(() => {
		// Get initial update info
		const getInitialInfo = async () => {
			try {
				const info = await window.electronAPI.getMinIOUpdateInfo();
				setUpdateInfo(info);
			} catch (error) {
				console.error('Error getting initial MinIO update info:', error);
			}
		};

		getInitialInfo();
	}, []);

	const handleCheckForUpdates = async () => {
		setIsChecking(true);
		setUpdateResult(null);

		try {
			const info = await window.electronAPI.checkMinIOUpdate();
			setUpdateInfo(info);
		} catch (error) {
			console.error('Error checking for MinIO updates:', error);
			setUpdateResult({
				success: false,
				message: 'Failed to check for updates'
			});
		} finally {
			setIsChecking(false);
		}
	};

	const handleUpdateMinIO = async () => {
		setIsUpdating(true);
		setUpdateResult(null);

		try {
			const result = await window.electronAPI.updateMinIO();
			setUpdateResult(result);

			if (result.success) {
				// Refresh update info after successful update
				const info = await window.electronAPI.checkMinIOUpdate();
				setUpdateInfo(info);
			}
		} catch (error) {
			console.error('Error updating MinIO:', error);
			setUpdateResult({
				success: false,
				message: 'Update failed'
			});
		} finally {
			setIsUpdating(false);
		}
	};

	const getStatusIcon = () => {
		if (!updateInfo) return <AlertCircle className="h-4 w-4 text-gray-500" />;

		if (updateInfo.updateAvailable) {
			return <Download className="h-4 w-4 text-blue-500" />;
		} else {
			return <CheckCircle className="h-4 w-4 text-green-500" />;
		}
	};

	const getStatusColor = () => {
		if (!updateInfo) return 'bg-gray-100 text-gray-800 border-gray-200';

		if (updateInfo.updateAvailable) {
			return 'bg-blue-100 text-blue-800 border-blue-200';
		} else {
			return 'bg-green-100 text-green-800 border-green-200';
		}
	};

	const getStatusText = () => {
		if (!updateInfo) return 'UNKNOWN';

		if (updateInfo.updateAvailable) {
			return 'UPDATE AVAILABLE';
		} else {
			return 'UP TO DATE';
		}
	};

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					{getStatusIcon()}
					MinIO Update Status
				</CardTitle>
				<CardDescription>
					File storage service update management
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between">
					<Badge className={getStatusColor()}>
						{getStatusText()}
					</Badge>
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
				</div>

				{updateInfo && (
					<div className="space-y-2">
						<div className="text-sm">
							<strong>Current Version:</strong> {updateInfo.currentVersion}
						</div>
						<div className="text-sm">
							<strong>Latest Version:</strong> {updateInfo.latestVersion}
						</div>
						{updateInfo.lastChecked && (
							<div className="text-xs text-gray-500">
								Last checked: {new Date(updateInfo.lastChecked).toLocaleString()}
							</div>
						)}
					</div>
				)}

				{updateInfo?.updateAvailable && (
					<Alert>
						<AlertDescription>
							<div className="space-y-2">
								<div>
									A newer version of MinIO is available. This update includes:
								</div>
								<ul className="text-sm space-y-1">
									<li>• Security patches and bug fixes</li>
									<li>• Performance improvements</li>
									<li>• Latest features and compatibility</li>
								</ul>
								<Button
									onClick={handleUpdateMinIO}
									disabled={isUpdating}
									className="w-full mt-2"
									size="sm"
								>
									{isUpdating ? (
										<>
											<RefreshCw className="h-4 w-4 animate-spin mr-2" />
											Updating...
										</>
									) : (
										<>
											<Download className="h-4 w-4 mr-2" />
											Update MinIO
										</>
									)}
								</Button>
							</div>
						</AlertDescription>
					</Alert>
				)}

				{updateResult && (
					<Alert className={updateResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
						<AlertDescription>
							<div className="flex items-center gap-2">
								{updateResult.success ? (
									<CheckCircle className="h-4 w-4 text-green-600" />
								) : (
									<XCircle className="h-4 w-4 text-red-600" />
								)}
								<span className={updateResult.success ? 'text-green-800' : 'text-red-800'}>
									{updateResult.message}
								</span>
							</div>
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
};
