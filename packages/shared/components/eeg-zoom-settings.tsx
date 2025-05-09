"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "../contexts/settings-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "./ui/card";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

// Default value for zoom factor
const DEFAULT_ZOOM_FACTOR = 0.05; // 5%

// Minimum and maximum allowed zoom factors
const MIN_ZOOM_FACTOR = 0.01; // 1%
const MAX_ZOOM_FACTOR = 0.2; // 20%

export function EEGZoomSettings() {
  // Generate stable component ID for debugging
  const componentId = useRef(
    `eeg-zoom-${Math.random().toString(36).substring(2, 9)}`
  );
  const { userPreferences, pendingChanges, updatePreference } = useSettings();

  // Local UI state
  const [zoomFactor, setZoomFactor] = useState<number>(DEFAULT_ZOOM_FACTOR);

  // Track update state
  const isUpdatingRef = useRef(false);
  const wasInitializedRef = useRef(false);

  // Initialize once
  useEffect(() => {
    if (wasInitializedRef.current) return;

    // Load from preferences or use default
    if (userPreferences?.eegZoomFactor !== undefined) {
      setZoomFactor(userPreferences.eegZoomFactor);
    }

    wasInitializedRef.current = true;
  }, [userPreferences]);

  // Listen for context changes
  useEffect(() => {
    if (isUpdatingRef.current) return;

    const pendingValue = pendingChanges.eegZoomFactor as number | undefined;
    const prefsValue = userPreferences?.eegZoomFactor as number | undefined;

    // Get value from pending changes or preferences
    const contextValue = pendingValue !== undefined ? pendingValue : prefsValue;

    // Update local UI if needed
    if (
      contextValue !== undefined &&
      Math.abs(contextValue - zoomFactor) > 0.0001
    ) {
      console.log(
        `[${componentId.current}] Context zoom changed to ${contextValue}`
      );
      setZoomFactor(contextValue);
    }
  }, [
    pendingChanges.eegZoomFactor,
    userPreferences?.eegZoomFactor,
    zoomFactor,
  ]);

  // Handle slider value change
  const handleZoomChange = useCallback(
    (value: number[]) => {
      if (isUpdatingRef.current) return;

      const newZoomFactor = value[0] / 100;

      // Skip if value essentially unchanged (floating point comparison)
      if (Math.abs(newZoomFactor - zoomFactor) < 0.0001) return;

      console.log(
        `[${componentId.current}] User changed zoom to ${newZoomFactor}`
      );

      // Update local UI first
      setZoomFactor(newZoomFactor);

      // Prevent further updates while we're updating
      isUpdatingRef.current = true;

      // Schedule context update
      setTimeout(() => {
        updatePreference("eegZoomFactor", newZoomFactor);

        // Reset update flag after a delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 50);
      }, 0);
    },
    [zoomFactor, updatePreference]
  );

  // Handle reset button click
  const handleReset = useCallback(() => {
    if (isUpdatingRef.current) return;
    if (Math.abs(zoomFactor - DEFAULT_ZOOM_FACTOR) < 0.0001) return;

    console.log(
      `[${componentId.current}] Resetting zoom to default ${DEFAULT_ZOOM_FACTOR}`
    );

    // Update local UI
    setZoomFactor(DEFAULT_ZOOM_FACTOR);

    // Prevent further updates
    isUpdatingRef.current = true;

    // Schedule preference update
    setTimeout(() => {
      updatePreference("eegZoomFactor", DEFAULT_ZOOM_FACTOR);

      // Reset update flag
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 50);
    }, 0);
  }, [zoomFactor, updatePreference]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>EEG Chart Zoom Settings</CardTitle>
        <CardDescription>
          Customize how quickly the chart zooms when using the mouse wheel
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="zoom-factor">
              Zoom Factor: {(zoomFactor * 100).toFixed(0)}%
            </Label>
            <div className="text-xs text-muted-foreground">
              {Math.abs(zoomFactor - DEFAULT_ZOOM_FACTOR) < 0.0001
                ? "(Default)"
                : ""}
            </div>
          </div>
          <Slider
            id="zoom-factor"
            min={MIN_ZOOM_FACTOR * 100}
            max={MAX_ZOOM_FACTOR * 100}
            step={1}
            value={[zoomFactor * 100]}
            onValueChange={handleZoomChange}
            className="py-4"
          />
          <div className="flex justify-between text-xs text-muted-foreground pb-2">
            <span>Subtle (1%)</span>
            <span>Default (5%)</span>
            <span>Aggressive (20%)</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Higher values make zooming more aggressive, while lower values
            provide finer control
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={Math.abs(zoomFactor - DEFAULT_ZOOM_FACTOR) < 0.0001}
          size="sm"
        >
          Reset to Default
        </Button>
      </CardFooter>
    </Card>
  );
}
