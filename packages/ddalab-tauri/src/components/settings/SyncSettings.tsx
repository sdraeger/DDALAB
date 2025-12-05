"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { TauriService } from "@/services/tauriService";
import { useSync } from "@/hooks/useSync";
import {
  Share2,
  Wifi,
  WifiOff,
  RefreshCw,
  Link2,
  Unlink,
  Search,
  Server,
  Lock,
  Shield,
  CheckCircle2,
  AlertCircle,
  Building2,
} from "lucide-react";
import type { DiscoveredBroker, SyncConnectionConfig } from "@/types/sync";

export function SyncSettings() {
  const {
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
    discoverBrokers,
  } = useSync();

  const [connectionConfig, setConnectionConfig] =
    useState<SyncConnectionConfig>({
      broker_url: "",
      user_id: "", // This is now the email address
      local_endpoint: "http://127.0.0.1:8765",
    });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [discoveredBrokers, setDiscoveredBrokers] = useState<
    DiscoveredBroker[]
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<DiscoveredBroker | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const handleDiscoverBrokers = useCallback(async () => {
    setIsDiscovering(true);
    setLocalError(null);
    try {
      const brokers = await discoverBrokers(5);
      setDiscoveredBrokers(brokers);
      if (brokers.length === 0) {
        setLocalError("No sync brokers found on the local network");
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  }, [discoverBrokers]);

  const handleSelectBroker = (broker: DiscoveredBroker) => {
    setSelectedBroker(broker);
    setConnectionConfig((prev) => ({
      ...prev,
      broker_url: broker.url,
    }));
    setPassword("");
  };

  const handleConnect = async () => {
    setLocalError(null);

    if (!connectionConfig.broker_url) {
      setLocalError("Broker URL is required");
      return;
    }

    if (!connectionConfig.user_id) {
      setLocalError("Email is required");
      return;
    }

    if (!password) {
      setLocalError("Password is required");
      return;
    }

    try {
      await connect({
        ...connectionConfig,
        password,
      });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleDisconnect = async () => {
    setLocalError(null);
    try {
      await disconnect();
      setSelectedBroker(null);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Disconnection failed",
      );
    }
  };

  if (!TauriService.isTauri()) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium">Sync & Sharing</h3>
          <p className="text-sm text-muted-foreground">
            Sync features are only available in the desktop application
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Sync & Sharing</h3>
        <p className="text-sm text-muted-foreground">
          Connect to an institutional sync broker to share analysis results
        </p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isConnected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-muted-foreground" />
            )}
            Connection Status
          </CardTitle>
          <CardDescription>
            Current sync broker connection status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "default" : "secondary"}>
                {isConnected ? (
                  <>
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Connected
                  </>
                ) : (
                  <>
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Disconnected
                  </>
                )}
              </Badge>
              {isConnected && selectedBroker && (
                <span className="text-sm text-muted-foreground">
                  to {selectedBroker.name}
                </span>
              )}
            </div>
            {isConnected && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isLoading}
              >
                <Unlink className="mr-2 h-4 w-4" />
                Disconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Broker Discovery */}
      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Discover Brokers
            </CardTitle>
            <CardDescription>
              Scan your local network for available sync brokers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleDiscoverBrokers}
              isLoading={isDiscovering}
              loadingText="Scanning network..."
              variant="outline"
              className="w-full"
            >
              <Search className="h-4 w-4" />
              Scan for Brokers
            </Button>

            {discoveredBrokers.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Available Brokers</Label>
                <div className="space-y-2">
                  {discoveredBrokers.map((broker, index) => (
                    <button
                      key={index}
                      className={`w-full p-3 rounded-lg border text-left transition-colors ${
                        selectedBroker?.url === broker.url
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }`}
                      onClick={() => handleSelectBroker(broker)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Server className="h-4 w-4" />
                            <span className="font-medium">{broker.name}</span>
                            {broker.auth_required && (
                              <Lock className="h-3 w-3 text-amber-500" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3" />
                            {broker.institution}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {broker.url}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          v{broker.version}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection Configuration */}
      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Connection Settings
            </CardTitle>
            <CardDescription>
              {selectedBroker
                ? `Configure connection to ${selectedBroker.name}`
                : "Manually configure broker connection"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="broker-url">Broker URL</Label>
              <Input
                id="broker-url"
                type="url"
                placeholder="wss://sync.institution.edu:9000"
                value={connectionConfig.broker_url}
                onChange={(e) =>
                  setConnectionConfig((prev) => ({
                    ...prev,
                    broker_url: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@institution.edu"
                value={connectionConfig.user_id}
                onChange={(e) =>
                  setConnectionConfig((prev) => ({
                    ...prev,
                    user_id: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Your account email address provided by your administrator.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Your account password provided by your administrator.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="local-endpoint">Local API Endpoint</Label>
              <Input
                id="local-endpoint"
                type="url"
                placeholder="http://127.0.0.1:8765"
                value={connectionConfig.local_endpoint}
                onChange={(e) =>
                  setConnectionConfig((prev) => ({
                    ...prev,
                    local_endpoint: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                The local endpoint where peers can download shared results.
              </p>
            </div>

            {(localError || error) && (
              <ErrorState
                message={localError || error || "An error occurred"}
                severity="error"
                variant="inline"
                onDismiss={() => setLocalError(null)}
              />
            )}

            <Button
              onClick={handleConnect}
              isLoading={isLoading}
              loadingText="Connecting..."
              disabled={
                !connectionConfig.broker_url ||
                !connectionConfig.user_id ||
                !password
              }
              className="w-full"
            >
              <Link2 className="h-4 w-4" />
              Connect to Broker
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Sharing Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            About Sync & Sharing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The sync feature allows you to share DDA analysis results with
            colleagues within your institution. Results are shared peer-to-peer,
            with the broker coordinating connections.
          </p>
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p>
              <strong>Privacy:</strong> Your data stays on your machine. The
              broker only stores share metadata and connection information.
            </p>
            <p>
              <strong>Security:</strong> All connections use TLS encryption.
              Results are only accessible while your instance is online.
            </p>
          </div>
          {isConnected && (
            <Alert className="bg-green-50 border-green-200">
              <AlertDescription className="text-green-800 text-sm">
                You can now share results from the DDA Results panel using the
                Share button.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
