"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSettings } from "@/contexts/settings-context";
import { useSession } from "next-auth/react";
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
import logger from "@/lib/utils/logger";

const SESSION_EXPIRATION_OPTIONS = [
  { value: 10 * 60, label: "10 minutes" },
  { value: 30 * 60, label: "30 minutes" },
  { value: 60 * 60, label: "1 hour" },
  { value: 2 * 60 * 60, label: "2 hours" },
  { value: 5 * 60 * 60, label: "5 hours" },
];

export function SessionExpirationSettings() {
  // Generate stable component ID for debugging
  const componentId = useRef(
    `session-expiration-${Math.random().toString(36).substring(2, 9)}`
  );
  const { userPreferences, pendingChanges, updatePreference } = useSettings();
  const { data: session, status } = useSession();

  const [selectedExpiration, setSelectedExpiration] = useState<string>(
    (30 * 60).toString()
  );
  const [expirationTimeText, setExpirationTimeText] =
    useState<string>("Unknown");

  const isUpdatingRef = useRef(false);
  const wasInitializedRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize component once
  useEffect(() => {
    if (wasInitializedRef.current) return;

    // Set initial expiration from userPreferences or pendingChanges
    const initialValue =
      pendingChanges.sessionExpiration ??
      userPreferences.sessionExpiration ??
      30 * 60;
    setSelectedExpiration(initialValue.toString());
    logger.info(`[${componentId.current}] Initialized with ${initialValue}`);

    wasInitializedRef.current = true;
  }, [userPreferences.sessionExpiration, pendingChanges.sessionExpiration]);

  // Effect to update from context changes
  useEffect(() => {
    if (isUpdatingRef.current) return;

    const pendingValue = pendingChanges.sessionExpiration;
    const prefsValue = userPreferences.sessionExpiration;

    const contextValue =
      pendingValue !== undefined ? pendingValue : (prefsValue ?? 30 * 60);

    if (contextValue.toString() !== selectedExpiration) {
      logger.info(
        `[${componentId.current}] Context session expiration changed to ${contextValue}`
      );
      setSelectedExpiration(contextValue.toString());
    }
  }, [
    pendingChanges.sessionExpiration,
    userPreferences.sessionExpiration,
    selectedExpiration,
  ]);

  // Get formatted time until expiration
  const getExpirationTimeText = useCallback(() => {
    if (!session?.expires) return "Unknown";

    const expirationTime = new Date(session.expires).getTime();
    const timeRemaining = expirationTime - Date.now();
    if (timeRemaining <= 0) return "Expired";

    const date = new Date(expirationTime);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");

    return `${hours}:${minutes}`;
  }, [session]);

  // Set up expiration time update
  useEffect(() => {
    setExpirationTimeText(getExpirationTimeText());
    intervalRef.current = setInterval(() => {
      setExpirationTimeText(getExpirationTimeText());
    }, 60000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [getExpirationTimeText]);

  // Handle expiration selection change
  const handleExpirationChange = useCallback(
    (value: string) => {
      if (isUpdatingRef.current || value === selectedExpiration) return;

      logger.info(
        `[${componentId.current}] User changed session expiration to ${value}`
      );

      setSelectedExpiration(value);
      isUpdatingRef.current = true;

      setTimeout(() => {
        const expirationSeconds = parseInt(value, 10);
        updatePreference("sessionExpiration", expirationSeconds);
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
