import React, { useEffect, useState } from 'react';

interface DockerInstallationStatus {
	dockerInstalled: boolean;
	dockerComposeInstalled: boolean;
	dockerVersion?: string;
	dockerComposeVersion?: string;
	error?: string;
}

interface DockerInstallationCheckProps {
	onStatusChange?: (status: DockerInstallationStatus) => void;
}

export const DockerInstallationCheck: React.FC<DockerInstallationCheckProps> = ({
	onStatusChange
}) => {
	const [status, setStatus] = useState<DockerInstallationStatus | null>(null);
	const [instructions, setInstructions] = useState<string>('');
	const [showInstructions, setShowInstructions] = useState(false);
	const [isChecking, setIsChecking] = useState(false);

	useEffect(() => {
		// Listen for Docker installation check events from main process
		const unsubscribe = window.electronAPI.onDockerInstallationCheck((data) => {
			setStatus(data.status);
			setInstructions(data.instructions);
			if (!data.status.dockerInstalled || !data.status.dockerComposeInstalled) {
				setShowInstructions(true);
			}
			onStatusChange?.(data.status);
		});

		// Initial check
		checkDockerInstallation();

		return unsubscribe;
	}, [onStatusChange]);

	const checkDockerInstallation = async () => {
		setIsChecking(true);
		try {
			const dockerStatus = await window.electronAPI.checkDockerInstallation();
			const instructionsText = await window.electronAPI.getDockerInstallationInstructions();

			setStatus(dockerStatus);
			setInstructions(instructionsText);

			if (!dockerStatus.dockerInstalled || !dockerStatus.dockerComposeInstalled) {
				setShowInstructions(true);
			}

			onStatusChange?.(dockerStatus);
		} catch (error) {
			console.error('Error checking Docker installation:', error);
		} finally {
			setIsChecking(false);
		}
	};

	const getStatusColor = () => {
		if (!status) return 'text-gray-500';
		if (status.dockerInstalled && status.dockerComposeInstalled) {
			return 'text-green-600';
		}
		return 'text-red-600';
	};

	const getStatusText = () => {
		if (!status) return 'Checking Docker installation...';
		if (status.dockerInstalled && status.dockerComposeInstalled) {
			return 'Docker installation verified';
		}
		return 'Docker installation issues detected';
	};

	if (!status && !isChecking) {
		return null;
	}

	return (
		<div className="docker-installation-check">
			<div className="flex items-center space-x-2 mb-4">
				<div className={`font-medium ${getStatusColor()}`}>
					{getStatusText()}
				</div>
				{isChecking && (
					<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
				)}
				<button
					onClick={checkDockerInstallation}
					disabled={isChecking}
					className="px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
				>
					Refresh
				</button>
			</div>

			{status && (
				<div className="space-y-2 text-sm">
					<div className="flex items-center space-x-2">
						<span className={status.dockerInstalled ? 'text-green-600' : 'text-red-600'}>
							{status.dockerInstalled ? '✓' : '✗'}
						</span>
						<span>Docker: {status.dockerInstalled ? status.dockerVersion || 'Installed' : 'Not installed'}</span>
					</div>
					<div className="flex items-center space-x-2">
						<span className={status.dockerComposeInstalled ? 'text-green-600' : 'text-red-600'}>
							{status.dockerComposeInstalled ? '✓' : '✗'}
						</span>
						<span>Docker Compose: {status.dockerComposeInstalled ? status.dockerComposeVersion || 'Installed' : 'Not installed'}</span>
					</div>
					{status.error && (
						<div className="text-red-600 text-xs">
							Error: {status.error}
						</div>
					)}
				</div>
			)}

			{showInstructions && instructions && (
				<div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
					<div className="flex items-center justify-between mb-2">
						<h3 className="font-medium text-yellow-800">Docker Installation Required</h3>
						<button
							onClick={() => setShowInstructions(false)}
							className="text-yellow-600 hover:text-yellow-800"
						>
							×
						</button>
					</div>
					<div className="text-sm text-yellow-700 whitespace-pre-line">
						{instructions}
					</div>
					<div className="mt-3">
						<button
							onClick={() => window.open('https://www.docker.com/products/docker-desktop', '_blank')}
							className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
						>
							Download Docker Desktop
						</button>
					</div>
				</div>
			)}
		</div>
	);
};
