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
import { Cloud, Lock, Shield, Link2, RefreshCw } from "lucide-react";

export function NSGSettings() {
  const [nsgCredentials, setNsgCredentials] = useState({
    username: "",
    password: "",
    appKey: "",
  });
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false);
  const [nsgConnectionStatus, setNsgConnectionStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [nsgError, setNsgError] = useState<string | null>(null);
  const [showNsgPassword, setShowNsgPassword] = useState(false);

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
      setNsgConnectionStatus("success");

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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold mb-2">Neuroscience Gateway (NSG)</h3>
        <p className="text-muted-foreground">
          Configure credentials for submitting DDA jobs to HPC clusters
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            NSG Credentials
          </CardTitle>
          <CardDescription>
            Securely store your NSG credentials for HPC job submission
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
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
                disabled={hasNsgCredentials}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nsg-password">NSG Password</Label>
              <div className="relative">
                <Input
                  id="nsg-password"
                  type={showNsgPassword ? "text" : "password"}
                  placeholder="Enter your NSG password"
                  value={nsgCredentials.password}
                  onChange={(e) =>
                    setNsgCredentials({
                      ...nsgCredentials,
                      password: e.target.value,
                    })
                  }
                  disabled={hasNsgCredentials}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowNsgPassword(!showNsgPassword)}
                  disabled={hasNsgCredentials}
                >
                  {showNsgPassword ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="nsg-appkey">NSG Application Key</Label>
              <Input
                id="nsg-appkey"
                type="text"
                placeholder="Enter your NSG app key"
                value={nsgCredentials.appKey}
                onChange={(e) =>
                  setNsgCredentials({
                    ...nsgCredentials,
                    appKey: e.target.value,
                  })
                }
                disabled={hasNsgCredentials}
              />
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
              <Alert className="bg-green-50 border-green-200">
                <AlertDescription className="text-green-800">
                  {hasNsgCredentials
                    ? "Connection successful!"
                    : "Credentials saved successfully!"}
                </AlertDescription>
              </Alert>
            )}

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
