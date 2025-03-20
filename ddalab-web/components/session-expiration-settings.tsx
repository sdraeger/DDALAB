"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getTokenExpirationTime } from "@/lib/auth";
import { useSettings } from "@/contexts/settings-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SESSION_EXPIRATION_OPTIONS = [
  { value: 10 * 60, label: "10 minutes" }, // 10 minutes in seconds
  { value: 30 * 60, label: "30 minutes" }, // 30 minutes in seconds
  { value: 60 * 60, label: "1 hour" }, // 1 hour in seconds
  { value: 2 * 60 * 60, label: "2 hours" }, // 2 hours in seconds
  { value: 5 * 60 * 60, label: "5 hours" }, // 5 hours in seconds
];

export function SessionExpirationSettings() {
  // Generate stable component ID for debugging
  const componentId = useRef(
    `session-expiration-${Math.random().toString(36).substring(2, 9)}`
  );
  const { userPreferences, pendingChanges, updatePreference } = useSettings();

  // Local UI state
  const [selectedExpiration, setSelectedExpiration] = useState<string>(
    (30 * 60).toString()
  );

  // Tracking refs
  const isUpdatingRef = useRef(false);
  const wasInitializedRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Time display state
  const [expirationTimeText, setExpirationTimeText] =
    useState<string>("Unknown");

  // Initialize component once
  useEffect(() => {
    if (wasInitializedRef.current) return;

    // Set initial expiration from preferences or default
    if (userPreferences?.sessionExpiration) {
      const value = userPreferences.sessionExpiration.toString();
      setSelectedExpiration(value);
    }

    wasInitializedRef.current = true;
  }, [userPreferences]);

  // Effect to update from context changes
  useEffect(() => {
    if (isUpdatingRef.current) return;

    const pendingValue = pendingChanges.sessionExpiration as number | undefined;
    const prefsValue = userPreferences?.sessionExpiration as number | undefined;

    // Get the current value from context or preferences
    const contextValue =
      pendingValue !== undefined
        ? pendingValue.toString()
        : prefsValue !== undefined
        ? prefsValue.toString()
        : null;

    // Update local state if needed
    if (contextValue && contextValue !== selectedExpiration) {
      console.log(
        `[${componentId.current}] Context session expiration changed to ${contextValue}`
      );
      setSelectedExpiration(contextValue);
    }
  }, [
    pendingChanges.sessionExpiration,
    userPreferences?.sessionExpiration,
    selectedExpiration,
  ]);

  // Get formatted time until expiration
  const getExpirationTimeText = useCallback(() => {
    const expirationTime = getTokenExpirationTime();
    if (!expirationTime) return "Unknown";

    const timeRemaining = expirationTime - Date.now();
    if (timeRemaining <= 0) return "Expired";

    // Format as HH:MM
    const date = new Date(expirationTime);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");

    return `${hours}:${minutes}`;
  }, []);

  // Set up expiration time update
  useEffect(() => {
    // Update immediately
    setExpirationTimeText(getExpirationTimeText());

    // Set up interval for updates
    intervalRef.current = setInterval(() => {
      setExpirationTimeText(getExpirationTimeText());
    }, 60000); // Update every minute

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [getExpirationTimeText]);

  // Handle expiration selection change
  const handleExpirationChange = useCallback(
    (value: string) => {
      if (isUpdatingRef.current) return;
      if (value === selectedExpiration) return;

      console.log(
        `[${componentId.current}] User changed session expiration to ${value}`
      );

      // Update local UI state
      setSelectedExpiration(value);

      // Prevent further updates while processing
      isUpdatingRef.current = true;

      // Schedule context update
      setTimeout(() => {
        const expirationSeconds = parseInt(value, 10);
        updatePreference("sessionExpiration", expirationSeconds);

        // Reset update flag
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 50);
      }, 0);
    },
    [selectedExpiration, updatePreference]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session Timeout</CardTitle>
        <CardDescription>
          Choose how long until your session expires from inactivity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="session-expiration">Timeout Duration</Label>
          <Select
            value={selectedExpiration}
            onValueChange={handleExpirationChange}
          >
            <SelectTrigger id="session-expiration">
              <SelectValue placeholder="Select timeout duration" />
            </SelectTrigger>
            <SelectContent>
              {SESSION_EXPIRATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          This setting controls how long you can stay logged in without
          activity. After this time, you will be automatically logged out and
          need to sign in again.
        </p>
        <div className="text-sm text-muted-foreground mt-2">
          Your current session will expire at{" "}
          <span className="font-medium">{expirationTimeText}</span> if there is
          no activity.
        </div>
      </CardContent>
    </Card>
  );
}
