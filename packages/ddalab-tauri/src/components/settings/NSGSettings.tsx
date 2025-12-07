"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/ui/error-state";
import { TauriService } from "@/services/tauriService";
import {
  Cloud,
  Lock,
  Link2,
  RefreshCw,
  Pencil,
  X,
  Eye,
  EyeOff,
} from "lucide-react";

// Placeholder for masked credentials
const CREDENTIAL_MASK = "••••••••••••";

export function NSGSettings() {
  const [nsgCredentials, setNsgCredentials] = useState({
    username: "",
    password: "",
    appKey: "",
  });
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [nsgConnectionStatus, setNsgConnectionStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [nsgError, setNsgError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showAppKey, setShowAppKey] = useState(false);

  // Load NSG credentials status on mount (never actual credentials)
  useEffect(() => {
    const loadNsgCredentialsStatus = async () => {
      if (!TauriService.isTauri()) return;
      try {
        const hasCredentials = await TauriService.hasNSGCredentials();
        setHasNsgCredentials(hasCredentials);

        if (hasCredentials) {
          const creds = await TauriService.getNSGCredentials();
          if (creds) {
            // Only show username - password and app_key are never returned from backend
            setNsgCredentials({
              username: creds.username,
              password: "", // Never pre-populated for security
              appKey: "", // Never pre-populated for security
            });
          }
        }
      } catch {
        // Ignore errors - credentials may not be set yet
      }
    };

    loadNsgCredentialsStatus();
  }, []);

  const handleSaveNsgCredentials = async () => {
    if (!TauriService.isTauri()) return;

    if (
      !nsgCredentials.username ||
      !nsgCredentials.password ||
      !nsgCredentials.appKey
    ) {
      setNsgError("All fields are required");
      return;
    }

    try {
      setNsgConnectionStatus("testing");
      setNsgError(null);

      await TauriService.saveNSGCredentials(
        nsgCredentials.username,
        nsgCredentials.password,
        nsgCredentials.appKey,
      );

      setHasNsgCredentials(true);
      setIsEditing(false);
      setNsgConnectionStatus("success");

      // Clear the password and appKey from state after saving
      setNsgCredentials((prev) => ({
        ...prev,
        password: "",
        appKey: "",
      }));

      setTimeout(() => {
        setNsgConnectionStatus("idle");
      }, 2000);
    } catch (error) {
      setNsgConnectionStatus("error");
      setNsgError(
        error instanceof Error ? error.message : "Failed to save credentials",
      );
    }
  };

  const handleTestNsgConnection = async () => {
    if (!TauriService.isTauri()) return;

    try {
      setNsgConnectionStatus("testing");
      setNsgError(null);

      const success = await TauriService.testNSGConnection();

      if (success) {
        setNsgConnectionStatus("success");
        setTimeout(() => {
          setNsgConnectionStatus("idle");
        }, 2000);
      } else {
        setNsgConnectionStatus("error");
        setNsgError("Connection test failed");
      }
    } catch (error) {
      setNsgConnectionStatus("error");
      setNsgError(
        error instanceof Error ? error.message : "Connection test failed",
      );
    }
  };

  const handleDeleteNsgCredentials = async () => {
    if (!TauriService.isTauri()) return;

    try {
      await TauriService.deleteNSGCredentials();
      setHasNsgCredentials(false);
      setIsEditing(false);
      setNsgCredentials({
        username: "",
        password: "",
        appKey: "",
      });
      setNsgConnectionStatus("idle");
      setNsgError(null);
    } catch (error) {
      setNsgError(
        error instanceof Error ? error.message : "Failed to delete credentials",
      );
    }
  };

  const handleStartEditing = () => {
    setIsEditing(true);
    // Clear password and appKey fields for re-entry
    setNsgCredentials((prev) => ({
      ...prev,
      password: "",
      appKey: "",
    }));
  };

  const handleCancelEditing = () => {
    setIsEditing(false);
    setNsgError(null);
    // Clear the fields since we're canceling
    setNsgCredentials((prev) => ({
      ...prev,
      password: "",
      appKey: "",
    }));
  };

  if (!TauriService.isTauri()) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-2xl font-bold mb-2">
            Neuroscience Gateway (NSG)
          </h3>
          <p className="text-muted-foreground">
            NSG features are only available in the desktop application
          </p>
        </div>
      </div>
    );
  }

  const isCredentialFieldsDisabled = hasNsgCredentials && !isEditing;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Neuroscience Gateway (NSG)</h3>
        <p className="text-muted-foreground">
          Configure credentials for submitting DDA jobs to HPC clusters
        </p>
      </div>

      {/* Credentials Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5" />
                NSG Credentials
              </CardTitle>
              <CardDescription>
                Securely store your NSG credentials for HPC job submission
              </CardDescription>
            </div>
            {hasNsgCredentials && !isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEditing}
                className="gap-2"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="nsg-username">NSG Username</Label>
              <Input
                id="nsg-username"
                type="text"
                placeholder="your.email@institution.edu"
                value={nsgCredentials.username}
                onChange={(e) =>
                  setNsgCredentials({
                    ...nsgCredentials,
                    username: e.target.value,
                  })
                }
                disabled={isCredentialFieldsDisabled}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="nsg-password">NSG Password</Label>
              <div className="relative">
                <Input
                  id="nsg-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={
                    isCredentialFieldsDisabled
                      ? CREDENTIAL_MASK
                      : "Enter your NSG password"
                  }
                  value={
                    isCredentialFieldsDisabled
                      ? CREDENTIAL_MASK
                      : nsgCredentials.password
                  }
                  onChange={(e) =>
                    setNsgCredentials({
                      ...nsgCredentials,
                      password: e.target.value,
                    })
                  }
                  disabled={isCredentialFieldsDisabled}
                  className={
                    isCredentialFieldsDisabled ? "text-muted-foreground" : ""
                  }
                />
                {!isCredentialFieldsDisabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {isCredentialFieldsDisabled && (
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {/* App Key */}
            <div className="space-y-2">
              <Label htmlFor="nsg-appkey">NSG Application Key</Label>
              <div className="relative">
                <Input
                  id="nsg-appkey"
                  type={showAppKey ? "text" : "password"}
                  placeholder={
                    isCredentialFieldsDisabled
                      ? CREDENTIAL_MASK
                      : "Enter your NSG app key"
                  }
                  value={
                    isCredentialFieldsDisabled
                      ? CREDENTIAL_MASK
                      : nsgCredentials.appKey
                  }
                  onChange={(e) =>
                    setNsgCredentials({
                      ...nsgCredentials,
                      appKey: e.target.value,
                    })
                  }
                  disabled={isCredentialFieldsDisabled}
                  className={
                    isCredentialFieldsDisabled ? "text-muted-foreground" : ""
                  }
                />
                {!isCredentialFieldsDisabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowAppKey(!showAppKey)}
                  >
                    {showAppKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {isCredentialFieldsDisabled && (
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {nsgError && (
              <ErrorState
                message={nsgError}
                severity="error"
                variant="inline"
                onDismiss={() => setNsgError(null)}
              />
            )}

            {nsgConnectionStatus === "success" && (
              <Alert className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
                <AlertDescription className="text-green-800 dark:text-green-200">
                  {isEditing
                    ? "Credentials updated successfully!"
                    : hasNsgCredentials
                      ? "Connection successful!"
                      : "Credentials saved successfully!"}
                </AlertDescription>
              </Alert>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              {!hasNsgCredentials ? (
                <Button
                  onClick={handleSaveNsgCredentials}
                  disabled={
                    nsgConnectionStatus === "testing" ||
                    !nsgCredentials.username ||
                    !nsgCredentials.password ||
                    !nsgCredentials.appKey
                  }
                >
                  {nsgConnectionStatus === "testing" ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Credentials"
                  )}
                </Button>
              ) : isEditing ? (
                <>
                  <Button
                    onClick={handleSaveNsgCredentials}
                    disabled={
                      nsgConnectionStatus === "testing" ||
                      !nsgCredentials.username ||
                      !nsgCredentials.password ||
                      !nsgCredentials.appKey
                    }
                  >
                    {nsgConnectionStatus === "testing" ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Update Credentials"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelEditing}
                    disabled={nsgConnectionStatus === "testing"}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={handleTestNsgConnection}
                    variant="outline"
                    disabled={nsgConnectionStatus === "testing"}
                  >
                    {nsgConnectionStatus === "testing" ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Link2 className="mr-2 h-4 w-4" />
                        Test Connection
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleDeleteNsgCredentials}
                    variant="destructive"
                    disabled={nsgConnectionStatus === "testing"}
                  >
                    Delete Credentials
                  </Button>
                </>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>
                <strong>Security:</strong> NSG credentials are encrypted using
                AES-256-GCM and stored securely in your system keyring.
              </p>
              <p>
                To get NSG credentials, visit{" "}
                <a
                  href="https://www.nsgportal.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  nsgportal.org
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
