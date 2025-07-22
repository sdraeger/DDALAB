"use client";

import { useAppSelector, useAppDispatch } from "../../../store";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Checkbox } from "../../ui/checkbox";
import { useToast } from "../../ui/use-toast";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { apiRequest } from "../../../lib/utils/request";
import { setDDAResults } from "../../../store/slices/plotSlice";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { Play } from "lucide-react";
import { useUnifiedSessionData } from "../../../hooks/useUnifiedSession";

interface DDAWidgetProps {
	widgetId?: string;
	isPopout?: boolean;
}

interface DDAFormState {
	windowSize: number;
	stepSize: number;
	frequencyBand: string;
	enablePreprocessing: boolean;
	includeMetadata: boolean;
}

export function DDAWidget({ widgetId = 'dda-widget-default', isPopout = false }: DDAWidgetProps = {}) {
	const { data: session } = useUnifiedSessionData();
	const plots = useAppSelector(state => state.plots);
	const dispatch = useAppDispatch();
	const { toast } = useToast();
	const loadingManager = useLoadingManager();

	// Synchronized form state
	const { state: formData, updateState: setFormData } = useWidgetState<DDAFormState>(
		widgetId,
		{
			windowSize: 1.0,
			stepSize: 0.5,
			frequencyBand: "8-12",
			enablePreprocessing: true,
			includeMetadata: false,
		},
		isPopout
	);

	const latestFilePath = Object.keys(plots).find(filePath =>
		plots[filePath]?.metadata && plots[filePath]?.edfData
	);

	const plotState = latestFilePath ? plots[latestFilePath] : null;
	const selectedChannels = plotState?.selectedChannels || [];
	const metadata = plotState?.metadata;

	const handleFormChange = (field: string, value: any) => {
		setFormData(prev => ({
			...prev,
			[field]: value
		}));
	};

	const handleDDAProcess = async () => {
		if (!latestFilePath || !plotState?.edfData) {
			toast({
				title: "No Data Available",
				description: "Please select and load a file first.",
				variant: "destructive",
			});
			return;
		}

		if (selectedChannels.length === 0) {
			toast({
				title: "No Channels Selected",
				description: "Please select at least one channel to analyze.",
				variant: "destructive",
			});
			return;
		}

		const token = session?.accessToken;
		if (!token) {
			toast({
				title: "Authentication Required",
				description: "Please log in to run DDA.",
				variant: "destructive",
			});
			return;
		}

		const loadingId = `dda-processing-${Date.now()}`;

		try {
			// Start DDA processing with unified loading
			loadingManager.startDDAProcessing(
				loadingId,
				"Initializing DDA request..."
			);

			// Convert selected channels to indices (assuming metadata has available channels)
			const availableChannels = metadata?.availableChannels || [];
			const channelIndices = selectedChannels
				.map(channelName => availableChannels.indexOf(channelName) + 1)
				.filter(index => index !== 0); // Filter out channels not found (index 0 means not found)

			if (channelIndices.length === 0) {
				throw new Error("Selected channels could not be mapped to indices");
			}

			loadingManager.updateProgress(loadingId, 20, "Preparing DDA request...");

			// Make actual DDA API call
			const requestData = {
				file_path: latestFilePath,
				channel_list: channelIndices,
				preprocessing_options: {
					resample: formData.enablePreprocessing,
					lowpassFilter: formData.enablePreprocessing,
					highpassFilter: formData.enablePreprocessing,
					notchFilter: formData.enablePreprocessing,
					detrend: formData.enablePreprocessing,
					removeOutliers: formData.enablePreprocessing,
					smoothing: false,
					smoothingWindow: 3,
					normalization: "none",
				},
			};

			loadingManager.updateProgress(loadingId, 40, "Submitting DDA request...");

			const response = await apiRequest<{
				Q: (number | null)[][];
				metadata?: any;
				artifact_id?: string;
				file_path?: string;
				error?: string;
				error_message?: string;
			}>({
				url: "/api/dda",
				method: "POST",
				token,
				body: requestData,
				responseType: "json",
			});

			// Check for server errors
			if (response.error === "DDA_BINARY_INVALID") {
				throw new Error(response.error_message || "DDA binary is not properly configured on the server");
			}

			if (!response.Q || !Array.isArray(response.Q)) {
				throw new Error("Invalid DDA response: no Q matrix received");
			}

			loadingManager.updateProgress(loadingId, 80, "Processing results...");

			// Store results in Redux store
			dispatch(setDDAResults({
				filePath: latestFilePath,
				results: {
					Q: response.Q,
					metadata: response.metadata,
					artifact_id: response.artifact_id,
					file_path: response.file_path || latestFilePath,
				},
			}));

			loadingManager.updateProgress(loadingId, 100, "DDA request complete!");

			setTimeout(() => {
				loadingManager.stop(loadingId);
				toast({
					title: "DDA Complete",
					description: `Successfully analyzed ${selectedChannels.length} channels. Matrix size: ${response.Q.length}×${response.Q[0]?.length || 0}`,
				});
			}, 500);

		} catch (error) {
			console.error('DDA processing error:', error);
			loadingManager.stop(loadingId);
			toast({
				title: "DDA Processing Error",
				description: `Failed to process DDA request: ${error instanceof Error ? error.message : 'Unknown error'}`,
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			{/* File Information */}
			<div>
				<label className="text-sm font-medium">Selected File</label>
				<Input
					placeholder="No file selected"
					value={latestFilePath ? latestFilePath.split('/').pop() : ""}
					className="mt-1"
					readOnly
				/>
			</div>

			{/* Channel Information */}
			<div>
				<label className="text-sm font-medium">Selected Channels</label>
				<div className="mt-1 p-2 border border-border rounded-md text-sm text-muted-foreground max-h-20 overflow-y-auto">
					{selectedChannels.length > 0 ?
						selectedChannels.join(', ') :
						metadata ? 'No channels selected' : 'Loading channels...'
					}
				</div>
			</div>

			{/* DDA Parameters */}
			<div className="space-y-3 pt-2 border-t">
				<div>
					<label className="text-sm font-medium">Window Size (seconds)</label>
					<Input
						type="number"
						step="0.1"
						min="0.1"
						max="10"
						value={formData.windowSize}
						onChange={(e) => handleFormChange('windowSize', parseFloat(e.target.value) || 1.0)}
						className="mt-1"
					/>
				</div>

				<div>
					<label className="text-sm font-medium">Step Size (seconds)</label>
					<Input
						type="number"
						step="0.1"
						min="0.1"
						max="5"
						value={formData.stepSize}
						onChange={(e) => handleFormChange('stepSize', parseFloat(e.target.value) || 0.5)}
						className="mt-1"
					/>
				</div>

				<div>
					<label className="text-sm font-medium">Frequency Band (Hz)</label>
					<Input
						value={formData.frequencyBand}
						onChange={(e) => handleFormChange('frequencyBand', e.target.value)}
						placeholder="e.g., 8-12"
						className="mt-1"
					/>
				</div>

				{/* Processing Options */}
				<div className="space-y-2">
					<div className="flex items-center space-x-2">
						<Checkbox
							id="preprocessing"
							checked={formData.enablePreprocessing}
							onCheckedChange={(checked) => handleFormChange('enablePreprocessing', checked)}
						/>
						<label htmlFor="preprocessing" className="text-sm">Enable preprocessing</label>
					</div>

					<div className="flex items-center space-x-2">
						<Checkbox
							id="metadata"
							checked={formData.includeMetadata}
							onCheckedChange={(checked) => handleFormChange('includeMetadata', checked)}
						/>
						<label htmlFor="metadata" className="text-sm">Include metadata in results</label>
					</div>
				</div>
			</div>

			{/* Action Button */}
			<Button
				className="w-full"
				disabled={!plotState?.edfData || selectedChannels.length === 0}
				onClick={handleDDAProcess}
			>
				<Play className="h-4 w-4 mr-2" />
				Run DDA
			</Button>
		</div>
	);
}
