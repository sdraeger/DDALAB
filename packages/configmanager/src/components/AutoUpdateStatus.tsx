import React, { useEffect, useState } from 'react';

interface UpdateInfo {
	version: string;
	releaseDate: string;
	releaseNotes?: string;
	downloadUrl?: string;
}

interface UpdateStatus {
	status: string;
	message: string;
	data?: any;
	timestamp: string;
}

export const AutoUpdateStatus: React.FC = () => {
	const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
	const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
	const [currentStatus, setCurrentStatus] = useState<UpdateStatus | null>(null);
	const [isChecking, setIsChecking] = useState(false);

	useEffect(() => {
		// Listen for update status events from main process
		const unsubscribe = window.electronAPI.onUpdateStatus((data: UpdateStatus) => {
			setCurrentStatus(data);

			if (data.status === 'available') {
				setIsUpdateAvailable(true);
				setUpdateInfo(data.data);
			} else if (data.status === 'downloaded') {
				setIsUpdateAvailable(false);
			}
		});

		// Check initial update status
		checkUpdateStatus();

		return unsubscribe;
	}, []);

	const checkUpdateStatus = async () => {
		setIsChecking(true);
		try {
			const available = await window.electronAPI.isUpdateAvailable();
			const info = await window.electronAPI.getUpdateInfo();

			setIsUpdateAvailable(available);
			setUpdateInfo(info);
		} catch (error) {
			console.error('Error checking update status:', error);
		} finally {
			setIsChecking(false);
		}
	};

	const handleCheckForUpdates = async () => {
		setIsChecking(true);
		try {
			await window.electronAPI.checkForUpdates();
		} catch (error) {
			console.error('Error checking for updates:', error);
		} finally {
			setIsChecking(false);
		}
	};

	const getStatusColor = () => {
		if (!currentStatus) return 'text-gray-500';

		switch (currentStatus.status) {
			case 'available':
				return 'text-green-600';
			case 'downloading':
				return 'text-blue-600';
			case 'downloaded':
				return 'text-green-600';
			case 'error':
				return 'text-red-600';
			default:
				return 'text-gray-500';
		}
	};

	const getStatusText = () => {
		if (!currentStatus) return 'Update status unknown';
		return currentStatus.message;
	};

	return (
		<div className="auto-update-status">
			<div className="flex items-center space-x-2 mb-4">
				<div className={`font-medium ${getStatusColor()}`}>
					{getStatusText()}
				</div>
				{isChecking && (
					<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
				)}
				<button
					onClick={handleCheckForUpdates}
					disabled={isChecking}
					className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
				>
					Check for Updates
				</button>
			</div>

			{updateInfo && (
				<div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
					<h3 className="font-medium text-blue-800 mb-2">
						Update Available: v{updateInfo.version}
					</h3>
					<div className="text-sm text-blue-700 space-y-1">
						<div>Release Date: {updateInfo.releaseDate}</div>
						{updateInfo.releaseNotes && (
							<div>
								<div className="font-medium">Release Notes:</div>
								<div className="whitespace-pre-line text-xs mt-1">
									{updateInfo.releaseNotes}
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{currentStatus?.status === 'downloading' && currentStatus.data && (
				<div className="mt-3">
					<div className="w-full bg-gray-200 rounded-full h-2">
						<div
							className="bg-blue-600 h-2 rounded-full transition-all duration-300"
							style={{ width: `${currentStatus.data.percent || 0}%` }}
						></div>
					</div>
					<div className="text-xs text-gray-600 mt-1">
						Downloading: {Math.round(currentStatus.data.percent || 0)}%
					</div>
				</div>
			)}

			{currentStatus?.status === 'error' && (
				<div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
					<div className="text-sm text-red-700">
						Update error: {currentStatus.message}
					</div>
				</div>
			)}
		</div>
	);
};
