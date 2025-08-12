"use client";

import { useAppDispatch } from "../../../store";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Checkbox } from "../../ui/checkbox";
import { useToast } from "../../ui/use-toast";
import { useLoadingManager } from "../../../hooks/useLoadingManager";
import { post } from "../../../lib/utils/request";
import { setDDAResults } from "../../../store/slices/plotSlice";
import { useWidgetState } from "../../../hooks/useWidgetState";
import { Play, Loader2, Settings } from "lucide-react";
import { useUnifiedSessionData } from "../../../hooks/useUnifiedSession";
import { usePopoutAuth } from "../../../hooks/usePopoutAuth";
import { useCurrentEdfFile } from "../../../hooks/useCurrentEdfFile";
import { useAuthMode } from "../../../contexts/AuthModeContext";
import { useForm, FormProvider } from "react-hook-form";
import { FormValues } from "../../../types/preprocessing";
import { FilterOptionsGroup } from "../../ui/preprocessing/FilterOptionsGroup";
import { SignalProcessingGroup } from "../../ui/preprocessing/SignalProcessingGroup";
import { NormalizationGroup } from "../../ui/preprocessing/NormalizationGroup";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";

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
  isAdvancedOpen: boolean;
}

export function DDAWidget({
  widgetId = "dda-widget-default",
  isPopout = false,
}: DDAWidgetProps = {}) {
  console.log("[DDAWidget] Component rendered with widgetId:", widgetId);

  const { data: session } = useUnifiedSessionData();
  const { currentFilePath, currentPlotState } = useCurrentEdfFile();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { isLocalMode } = useAuthMode();

  // Use popout authentication hook
  const { tokenInfo, isAuthenticated, authState } = usePopoutAuth({
    widgetId,
    isPopout,
    onAuthError: (error) => {
      toast({
        title: "Authentication Error",
        description: `Authentication failed in popout window: ${error}`,
        variant: "destructive",
      });
    },
    onTokenRefresh: (token) => {
      console.log("[DDAWidget] Authentication token refreshed");
    },
  });
  const loadingManager = useLoadingManager();

  // Synchronized form state
  const { state: formData, updateState: setFormData } =
    useWidgetState<DDAFormState>(
      widgetId,
      {
        windowSize: 1.0,
        stepSize: 0.5,
        frequencyBand: "8-12",
        enablePreprocessing: true,
        includeMetadata: false,
        isAdvancedOpen: false,
      },
      isPopout
    );

  // Advanced preprocessing form
  const preprocessingForm = useForm<FormValues>({
    defaultValues: {
      preprocessingSteps: [],
      removeOutliers: false,
      smoothing: false,
      smoothingWindow: 3,
      normalization: "none",
    },
  });

  const latestFilePath = currentFilePath;
  const plotState = currentPlotState;
  const selectedChannels = plotState?.selectedChannels || [];
  const metadata = plotState?.metadata;

  // Debug logging for DDA widget state
  console.log("[DDAWidget] Current state:", {
    latestFilePath,
    currentFilePath,
    hasPlotState: !!plotState,
    selectedChannelsCount: selectedChannels.length,
    selectedChannels,
    hasMetadata: !!metadata,
    buttonDisabled: !latestFilePath || selectedChannels.length === 0,
  });

  const handleFormChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleDDAProcess = async () => {
    console.log("[DDAWidget] *** handleDDAProcess called ***");
    console.log("[DDAWidget] Current state:", {
      latestFilePath,
      hasPlotState: !!plotState,
      hasEdfData: !!plotState?.edfData,
      selectedChannels,
      metadata,
      selectedChannelsLength: selectedChannels.length,
    });

    if (!latestFilePath || !plotState?.edfData) {
      console.log("[DDAWidget] *** EARLY RETURN: Missing file path or EDF data ***", {
        latestFilePath: !!latestFilePath,
        hasPlotState: !!plotState,
        hasEdfData: !!plotState?.edfData,
      });
      toast({
        title: "No Data Available",
        description: "Please select and load a file first.",
        variant: "destructive",
      });
      return;
    }

    if (selectedChannels.length === 0) {
      console.log("[DDAWidget] *** EARLY RETURN: No channels selected ***", {
        selectedChannelsLength: selectedChannels.length,
        selectedChannels,
      });
      toast({
        title: "No Channels Selected",
        description: "Please select at least one channel to analyze.",
        variant: "destructive",
      });
      return;
    }

    console.log("[DDAWidget] *** All checks passed, proceeding with DDA ***");

    // Get authentication token - prioritize popout auth for popout windows
    const token = isPopout ? tokenInfo.token : session?.accessToken;

    console.log("[DDAWidget] Authentication check:", {
      isPopout,
      hasToken: !!token,
      isAuthenticated,
      isLocalMode,
      hasSession: !!session,
      sessionKeys: session ? Object.keys(session) : null,
    });

    // In local mode, authentication is handled by the server
    // If we have a token, trust that the server will handle auth validation
    const authenticationPassed = isLocalMode || isAuthenticated || !!token;

    if (!authenticationPassed) {
      console.log("[DDAWidget] *** EARLY RETURN: Authentication failed ***", {
        hasToken: !!token,
        isAuthenticated,
        isLocalMode,
        authenticationPassed,
        isPopout,
      });
      toast({
        title: "Authentication Required",
        description: isPopout
          ? "Authentication failed in popout window. Please refresh or return to main window."
          : "Please log in to run DDA.",
        variant: "destructive",
      });
      return;
    }

    console.log("[DDAWidget] *** Authentication passed, preparing request ***");

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
        .map((channelName) => availableChannels.indexOf(channelName) + 1)
        .filter((index) => index !== 0); // Filter out channels not found (index 0 means not found)

      if (channelIndices.length === 0) {
        throw new Error("Selected channels could not be mapped to indices");
      }

      loadingManager.updateProgress(loadingId, 20, "Preparing DDA request...");

      // Get advanced preprocessing options
      const advancedOptions = preprocessingForm.getValues();

      // Make actual DDA API call
      const requestData = {
        file_path: latestFilePath,
        channel_list: channelIndices,
        preprocessing_options: formData.enablePreprocessing
          ? {
            // Use advanced preprocessing options if available
            preprocessingSteps: advancedOptions.preprocessingSteps || [],
            removeOutliers: advancedOptions.removeOutliers || false,
            smoothing: advancedOptions.smoothing || false,
            smoothingWindow: advancedOptions.smoothingWindow || 3,
            normalization: advancedOptions.normalization || "none",
            // Legacy options for backward compatibility
            resample: true,
            lowpassFilter:
              advancedOptions.preprocessingSteps?.some((step) =>
                typeof step === "string"
                  ? step === "lowpass"
                  : step.id === "lowpass"
              ) || false,
            highpassFilter:
              advancedOptions.preprocessingSteps?.some((step) =>
                typeof step === "string"
                  ? step === "highpass"
                  : step.id === "highpass"
              ) || false,
            notchFilter:
              advancedOptions.preprocessingSteps?.some((step) =>
                typeof step === "string"
                  ? step === "notch"
                  : step.id === "notch"
              ) || false,
            detrend:
              advancedOptions.preprocessingSteps?.some((step) =>
                typeof step === "string"
                  ? step === "detrend"
                  : step.id === "detrend"
              ) || false,
          }
          : {
            // Minimal preprocessing when disabled
            preprocessingSteps: [],
            removeOutliers: false,
            smoothing: false,
            smoothingWindow: 3,
            normalization: "none",
            resample: false,
            lowpassFilter: false,
            highpassFilter: false,
            notchFilter: false,
            detrend: false,
          },
      };

      loadingManager.updateProgress(loadingId, 40, "Submitting DDA request...");

      console.log("[DDAWidget] *** Making API request to /api/dda ***", {
        url: "/api/dda",
        method: "POST",
        hasToken: !!token,
        requestData: {
          ...requestData,
          // Don't log the full preprocessing options to avoid spam
          preprocessing_options: requestData.preprocessing_options ? "present" : "null",
        },
      });

      const response = await post<
        {
          Q: (number | null)[][];
          metadata?: any;
          artifact_id?: string;
          file_path?: string;
          error?: string;
          error_message?: string;
        }
      >(
        "/api/dda",
        requestData,
        token
      );

      console.log("[DDAWidget] DDA API response:", {
        hasQ: !!response.Q,
        QLength: response.Q?.length,
        QFirstRowLength: response.Q?.[0]?.length,
        error: response.error,
        error_message: response.error_message,
      });

      // Check for server errors
      if (response.error === "DDA_BINARY_INVALID") {
        throw new Error(
          response.error_message ||
          "DDA binary is not properly configured on the server"
        );
      }

      if (!response.Q || !Array.isArray(response.Q)) {
        throw new Error("Invalid DDA response: no Q matrix received");
      }

      loadingManager.updateProgress(loadingId, 80, "Processing results...");

      // Store results in Redux store
      console.log("[DDAWidget] About to dispatch setDDAResults:", {
        filePath: latestFilePath,
        Q: response.Q,
        QLength: response.Q?.length,
        QFirstRowLength: response.Q?.[0]?.length,
        metadata: response.metadata,
        artifact_id: response.artifact_id,
      });

      // Use the original file path for DDA API calls (preserve absolute path)
      const ddaFilePath = latestFilePath;
      console.log("[DDAWidget] Using file path for DDA:", {
        original: latestFilePath,
        ddaFilePath: ddaFilePath,
      });

      dispatch(
        setDDAResults({
          filePath: ddaFilePath,
          results: {
            Q: response.Q,
            metadata: response.metadata,
            artifact_id: response.artifact_id,
            file_path: response.file_path || ddaFilePath,
          },
        })
      );

      console.log("[DDAWidget] setDDAResults dispatched successfully");

      loadingManager.updateProgress(loadingId, 100, "DDA request complete!");

      setTimeout(() => {
        loadingManager.stop(loadingId);
        toast({
          title: "DDA Complete",
          description: `Successfully analyzed ${selectedChannels.length
            } channels. Matrix size: ${response.Q.length}×${response.Q[0]?.length || 0
            }`,
        });
      }, 500);
    } catch (error) {
      console.error("DDA processing error:", error);
      loadingManager.stop(loadingId);
      toast({
        title: "DDA Processing Error",
        description: `Failed to process DDA request: ${error instanceof Error ? error.message : "Unknown error"
          }`,
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings className="h-4 w-4" />
          DDA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File Information */}
        <div>
          <label className="text-sm font-medium">Selected File</label>
          <Input
            placeholder="No file selected"
            value={latestFilePath ? latestFilePath.split("/").pop() : ""}
            className="mt-1"
            readOnly
          />
        </div>

        {/* Channel Information */}
        <div>
          <label className="text-sm font-medium">Selected Channels</label>
          <div className="mt-1 p-2 border border-border rounded-md text-sm text-muted-foreground max-h-20 overflow-y-auto">
            {selectedChannels.length > 0
              ? selectedChannels.join(", ")
              : metadata
                ? "No channels selected"
                : "Loading channels..."}
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
              onChange={(e) =>
                handleFormChange(
                  "windowSize",
                  parseFloat(e.target.value) || 1.0
                )
              }
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
              onChange={(e) =>
                handleFormChange("stepSize", parseFloat(e.target.value) || 0.5)
              }
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Frequency Band (Hz)</label>
            <Input
              value={formData.frequencyBand}
              onChange={(e) =>
                handleFormChange("frequencyBand", e.target.value)
              }
              placeholder="e.g., 8-12"
              className="mt-1"
            />
          </div>

          {/* Basic Processing Options */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="enablePreprocessing"
                checked={formData.enablePreprocessing}
                onCheckedChange={(checked) =>
                  handleFormChange("enablePreprocessing", checked)
                }
              />
              <label htmlFor="enablePreprocessing" className="text-sm">
                Enable Preprocessing
              </label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="includeMetadata"
                checked={formData.includeMetadata}
                onCheckedChange={(checked) =>
                  handleFormChange("includeMetadata", checked)
                }
              />
              <label htmlFor="includeMetadata" className="text-sm">
                Include Metadata
              </label>
            </div>
          </div>

          {/* Advanced Preprocessing Options */}
          {formData.enablePreprocessing && (
            <div className="pt-2 border-t">
              <Collapsible
                open={formData.isAdvancedOpen}
                onOpenChange={(open) =>
                  handleFormChange("isAdvancedOpen", open)
                }
              >
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full mb-3">
                    {formData.isAdvancedOpen ? "Hide" : "Show"} Advanced
                    Preprocessing
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <FormProvider {...preprocessingForm}>
                    <div className="space-y-4">
                      <FilterOptionsGroup form={preprocessingForm} />
                      <SignalProcessingGroup form={preprocessingForm} />
                      <NormalizationGroup form={preprocessingForm} />
                    </div>
                  </FormProvider>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>

        {/* Run DDA Button */}
        <Button
          onClick={() => {
            console.log("[DDAWidget] DDA button clicked");
            handleDDAProcess();
          }}
          className="w-full"
          disabled={!latestFilePath || selectedChannels.length === 0}
        >
          {loadingManager.isUploading ? (
            <>
              <Loader2 className="animate-spin mr-2 h-4 w-4" />
              Running DDA...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run DDA
            </>
          )}
        </Button>

        {/* Debug info - only show in development */}
        {process.env.NODE_ENV === "development" && (
          <div className="text-xs text-muted-foreground mt-4 pt-2 border-t">
            <div>
              Button disabled:{" "}
              {(!latestFilePath || selectedChannels.length === 0).toString()}
            </div>
            <div>Has file path: {!!latestFilePath}</div>
            <div>Selected channels: {selectedChannels.length}</div>
            <div>Has plot state: {!!plotState}</div>
            <div>Has EDF data: {!!plotState?.edfData}</div>
            <div>
              Available channels: {metadata?.availableChannels?.length || 0}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
