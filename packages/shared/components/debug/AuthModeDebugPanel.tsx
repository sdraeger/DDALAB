"use client";

import React from 'react';
import { useAuthMode } from '../../contexts/AuthModeContext';
import { userPreferencesStorage, dashboardStorage, plotStorage, widgetLayoutStorage } from '../../lib/utils/authModeStorage';

interface AuthModeDebugPanelProps {
	isVisible?: boolean;
	className?: string;
}

export function AuthModeDebugPanel({ isVisible = true, className = '' }: AuthModeDebugPanelProps) {
	const {
		authMode,
		isLocalMode,
		isMultiUserMode,
		switchToLocalMode,
		switchToMultiUserMode,
		clearCurrentModeData,
		hasDataForMode,
		migrateDataBetweenModes,
	} = useAuthMode();

	if (!isVisible) {
		return null;
	}

	const handleClearData = () => {
		if (window.confirm(`Are you sure you want to clear all data for ${authMode} mode?`)) {
			clearCurrentModeData();
			alert(`Cleared all data for ${authMode} mode`);
		}
	};

	const handleMigrateData = (fromMode: 'local' | 'multi-user') => {
		const toMode = fromMode === 'local' ? 'multi-user' : 'local';
		if (window.confirm(`Migrate data from ${fromMode} to ${toMode} mode?`)) {
			migrateDataBetweenModes(fromMode, toMode);
			alert(`Migrated data from ${fromMode} to ${toMode} mode`);
		}
	};

	const getStorageInfo = () => {
		return {
			currentMode: authMode,
			hasLocalData: hasDataForMode('local'),
			hasMultiUserData: hasDataForMode('multi-user'),
			storageKeys: {
				preferences: userPreferencesStorage.getAllKeys(),
				dashboard: dashboardStorage.getAllKeys(),
				plots: plotStorage.getAllKeys(),
				widgets: widgetLayoutStorage.getAllKeys(),
			}
		};
	};

	const storageInfo = getStorageInfo();

	return (
		<div className={`fixed bottom-4 right-4 bg-white border border-gray-300 shadow-lg p-4 rounded-lg z-50 max-w-md ${className}`}>
			<h3 className="text-lg font-semibold mb-3">Auth Mode Debug Panel</h3>

			{/* Current Mode Status */}
			<div className="mb-4">
				<h4 className="font-medium mb-2">Current Mode</h4>
				<div className="flex items-center gap-2">
					<span className={`px-2 py-1 rounded text-sm ${isLocalMode ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
						}`}>
						{authMode}
					</span>
					<span className="text-sm text-gray-600">
						{isLocalMode ? '(No authentication)' : '(Authentication required)'}
					</span>
				</div>
			</div>

			{/* Mode Switching */}
			<div className="mb-4">
				<h4 className="font-medium mb-2">Switch Mode</h4>
				<div className="flex gap-2">
					<button
						onClick={switchToLocalMode}
						disabled={isLocalMode}
						className="px-3 py-1 text-sm bg-green-500 text-white rounded disabled:bg-gray-300"
					>
						Local Mode
					</button>
					<button
						onClick={switchToMultiUserMode}
						disabled={isMultiUserMode}
						className="px-3 py-1 text-sm bg-blue-500 text-white rounded disabled:bg-gray-300"
					>
						Multi-User Mode
					</button>
				</div>
			</div>

			{/* Data Status */}
			<div className="mb-4">
				<h4 className="font-medium mb-2">Data Status</h4>
				<div className="text-sm space-y-1">
					<div>Local Mode Data: {storageInfo.hasLocalData ? '✅ Yes' : '❌ None'}</div>
					<div>Multi-User Data: {storageInfo.hasMultiUserData ? '✅ Yes' : '❌ None'}</div>
				</div>
			</div>

			{/* Storage Keys */}
			<div className="mb-4">
				<h4 className="font-medium mb-2">Storage Keys ({authMode})</h4>
				<div className="text-xs space-y-1 max-h-32 overflow-y-auto">
					{Object.entries(storageInfo.storageKeys).map(([category, keys]) => (
						<div key={category}>
							<strong>{category}:</strong> {keys.length > 0 ? keys.join(', ') : 'none'}
						</div>
					))}
				</div>
			</div>

			{/* Actions */}
			<div className="space-y-2">
				<button
					onClick={handleClearData}
					className="w-full px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
				>
					Clear {authMode} Data
				</button>

				{storageInfo.hasLocalData && authMode === 'multi-user' && (
					<button
						onClick={() => handleMigrateData('local')}
						className="w-full px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
					>
						Migrate Local → Multi-User
					</button>
				)}

				{storageInfo.hasMultiUserData && authMode === 'local' && (
					<button
						onClick={() => handleMigrateData('multi-user')}
						className="w-full px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
					>
						Migrate Multi-User → Local
					</button>
				)}
			</div>

			{/* Storage Raw Data (collapsible) */}
			<details className="mt-3">
				<summary className="text-sm font-medium cursor-pointer">Raw Storage Data</summary>
				<pre className="text-xs bg-gray-100 p-2 mt-2 rounded overflow-auto max-h-40">
					{JSON.stringify(storageInfo, null, 2)}
				</pre>
			</details>
		</div>
	);
}

// Hook for easy access to auth mode debug info
export function useAuthModeDebug() {
	const authMode = useAuthMode();

	const getDebugInfo = () => {
		return {
			...authMode,
			storageInfo: {
				preferences: userPreferencesStorage.getAllKeys(),
				dashboard: dashboardStorage.getAllKeys(),
				plots: plotStorage.getAllKeys(),
				widgets: widgetLayoutStorage.getAllKeys(),
			}
		};
	};

	return {
		...authMode,
		getDebugInfo,
	};
}
