"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { useSync } from "@/hooks/useSync";
import { useHealthCheck } from "@/hooks/useHealthCheck";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Wifi,
  WifiOff,
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw,
  Server,
  Cloud,
  CloudOff,
  Brain,
  Loader2,
  X,
  FlaskConical,
  ChevronDown,
  Lock,
  Unlock,
  Building2,
  Search,
  Unplug,
  History,
  Trash2,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { DiscoveredBroker } from "@/types/sync";
import {
  useRecentServersStore,
  getRelativeTime,
} from "@/store/recentServersStore";
import type { RecentServer } from "@/store/recentServersStore";

interface HealthStatusBarProps {
  apiService: ApiService;
}

export function HealthStatusBar({ apiService }: HealthStatusBarProps) {
  const { ui, updateHealthStatus } = useAppStore();
  const {
    isConnected: syncConnected,
    isLoading: syncLoading,
    discoverBrokers,
    connect,
    disconnect,
  } = useSync();
  const ddaRunning = useAppStore((state) => state.dda.isRunning);
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  const expertMode = useAppStore((state) => state.ui.expertMode);
  const setExpertMode = useAppStore((state) => state.setExpertMode);

  // Recent servers store
  const { recentServers, addRecentServer, removeRecentServer } =
    useRecentServersStore();

  // Server quick-connect state
  const [serverPopoverOpen, setServerPopoverOpen] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<
    DiscoveredBroker[]
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingServer, setConnectingServer] =
    useState<DiscoveredBroker | null>(null);
  const [connectingRecentServer, setConnectingRecentServer] =
    useState<RecentServer | null>(null);
  const [serverPassword, setServerPassword] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [showManualConnect, setShowManualConnect] = useState(false);
  const [manualServerUrl, setManualServerUrl] = useState("");

  // Discover servers when popover opens
  const handleDiscoverServers = useCallback(async () => {
    setIsDiscovering(true);
    setPasswordError(null);
    try {
      const brokers = await discoverBrokers(3); // 3 second timeout
      setDiscoveredServers(brokers);
    } catch (error) {
      console.error("[HealthStatusBar] Discovery failed:", error);
      setDiscoveredServers([]);
    } finally {
      setIsDiscovering(false);
    }
  }, [discoverBrokers]);

  // Handle server selection - always show login form since user auth is required
  const handleServerSelect = useCallback(
    async (server: DiscoveredBroker) => {
      setConnectingServer(server);
      setConnectingRecentServer(null);
      setPasswordError(null);
      setShowPasswordInput(true); // Always show login form
      // Check if we have stored email for this server
      const recent = recentServers.find((s) => s.url === server.url);
      if (recent?.userEmail) {
        setUserEmail(recent.userEmail);
      }
    },
    [recentServers],
  );

  // Handle recent server selection - pre-fill stored email
  const handleRecentServerSelect = useCallback((server: RecentServer) => {
    setConnectingRecentServer(server);
    setConnectingServer(null);
    setPasswordError(null);
    setShowPasswordInput(true);
    // Pre-fill stored email
    if (server.userEmail) {
      setUserEmail(server.userEmail);
    }
  }, []);

  // Handle login submission (email + password)
  const handlePasswordSubmit = useCallback(async () => {
    const serverUrl = connectingServer?.url || connectingRecentServer?.url;
    if (!serverUrl) return;

    if (!userEmail.trim()) {
      setPasswordError("Email is required");
      return;
    }

    if (!serverPassword) {
      setPasswordError("Password is required");
      return;
    }

    setIsConnecting(true);
    setPasswordError(null);

    try {
      const localEndpoint = `http://localhost:${window.location.port || 3000}`;

      await connect({
        broker_url: serverUrl,
        user_id: userEmail.trim(),
        local_endpoint: localEndpoint,
        password: serverPassword,
      });

      // Save to recent servers on successful connection
      const serverName =
        connectingServer?.name || connectingRecentServer?.name || "Server";
      const serverInstitution =
        connectingServer?.institution ||
        connectingRecentServer?.institution ||
        "Unknown";
      const serverVersion =
        connectingServer?.version || connectingRecentServer?.version;
      addRecentServer({
        url: serverUrl,
        name: serverName,
        institution: serverInstitution,
        userEmail: userEmail.trim(),
        version: serverVersion,
      });

      setServerPopoverOpen(false);
      setConnectingServer(null);
      setConnectingRecentServer(null);
      setServerPassword("");
      setUserEmail("");
      setShowPasswordInput(false);
    } catch (error) {
      console.error("[HealthStatusBar] Connection failed:", error);
      setPasswordError(
        error instanceof Error ? error.message : "Connection failed",
      );
    } finally {
      setIsConnecting(false);
    }
  }, [
    connectingServer,
    connectingRecentServer,
    userEmail,
    serverPassword,
    connect,
    addRecentServer,
  ]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      setServerPopoverOpen(false);
    } catch (error) {
      console.error("[HealthStatusBar] Disconnect failed:", error);
    }
  }, [disconnect]);

  // Handle manual server connection
  const handleManualConnect = useCallback(async () => {
    if (!manualServerUrl.trim()) {
      setPasswordError("Server URL is required");
      return;
    }

    if (!userEmail.trim()) {
      setPasswordError("Email is required");
      return;
    }

    if (!serverPassword) {
      setPasswordError("Password is required");
      return;
    }

    setIsConnecting(true);
    setPasswordError(null);

    try {
      // Normalize URL - ensure it has a protocol and convert to WebSocket URL
      let url = manualServerUrl.trim();
      if (
        !url.startsWith("http://") &&
        !url.startsWith("https://") &&
        !url.startsWith("ws://") &&
        !url.startsWith("wss://")
      ) {
        url = `http://${url}`;
      }
      // Convert to WebSocket URL for the broker
      const wsUrl = url
        .replace("http://", "ws://")
        .replace("https://", "wss://");
      const brokerUrl = wsUrl.endsWith("/ws") ? wsUrl : `${wsUrl}/ws`;

      const localEndpoint = `http://localhost:${window.location.port || 3000}`;

      await connect({
        broker_url: brokerUrl,
        user_id: userEmail.trim(),
        local_endpoint: localEndpoint,
        password: serverPassword,
      });

      // Save to recent servers on successful connection
      // Extract hostname for display name
      const urlObj = new URL(url);
      addRecentServer({
        url: brokerUrl,
        name: urlObj.hostname,
        institution: urlObj.hostname,
        userEmail: userEmail.trim(),
      });

      setServerPopoverOpen(false);
      setShowManualConnect(false);
      setManualServerUrl("");
      setServerPassword("");
      setUserEmail("");
    } catch (error) {
      console.error("[HealthStatusBar] Manual connection failed:", error);
      setPasswordError(
        error instanceof Error ? error.message : "Connection failed",
      );
    } finally {
      setIsConnecting(false);
    }
  }, [manualServerUrl, userEmail, serverPassword, connect, addRecentServer]);

  // Reset state when closing popover
  useEffect(() => {
    if (!serverPopoverOpen) {
      setShowPasswordInput(false);
      setShowManualConnect(false);
      setServerPassword("");
      setUserEmail("");
      setManualServerUrl("");
      setPasswordError(null);
      setConnectingServer(null);
      setConnectingRecentServer(null);
    }
  }, [serverPopoverOpen]);

  // Cancel popover state
  const [showCancelPopover, setShowCancelPopover] = useState(false);
  const [isPopoverClosing, setIsPopoverClosing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const cancelPopoverRef = useRef<HTMLDivElement>(null);

  // Handle smooth close animation
  const closePopover = useCallback(() => {
    setIsPopoverClosing(true);
    // Wait for animation to complete before hiding
    setTimeout(() => {
      setShowCancelPopover(false);
      setIsPopoverClosing(false);
    }, 150); // Match animation duration
  }, []);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        cancelPopoverRef.current &&
        !cancelPopoverRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    }

    if (showCancelPopover && !isPopoverClosing) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showCancelPopover, isPopoverClosing, closePopover]);

  // Handle cancel DDA analysis
  const handleCancelDDA = useCallback(async () => {
    setIsCancelling(true);
    try {
      const result = await apiService.cancelDDAAnalysis();
      if (result.success) {
        console.log(
          "[HealthStatusBar] DDA analysis cancelled:",
          result.cancelled_analysis_id,
        );
        // Update the DDA running state
        setDDARunning(false);
      } else {
        console.warn("[HealthStatusBar] Failed to cancel DDA:", result.message);
      }
    } catch (error) {
      console.error("[HealthStatusBar] Error cancelling DDA:", error);
    } finally {
      setIsCancelling(false);
      closePopover();
    }
  }, [apiService, setDDARunning, closePopover]);

  // Use TanStack Query for health checks with automatic polling
  const {
    data: healthData,
    isLoading: isCheckingHealth,
    refetch: refetchHealth,
  } = useHealthCheck(apiService, {
    enabled: ui.isServerReady,
    refetchInterval: 120 * 1000, // Poll every 2 minutes
  });

  // Sync health check results to Zustand store for backward compatibility
  useEffect(() => {
    if (!healthData) return;

    if (healthData.isHealthy) {
      updateHealthStatus({
        apiStatus: "healthy",
        lastCheck: healthData.timestamp,
        responseTime: healthData.responseTime,
        errors: [],
      });
    } else {
      updateHealthStatus((currentHealth) => ({
        apiStatus: "unhealthy",
        lastCheck: healthData.timestamp,
        responseTime: healthData.responseTime,
        errors: healthData.error
          ? [healthData.error, ...currentHealth.errors.slice(0, 4)]
          : currentHealth.errors,
      }));
    }
  }, [healthData, updateHealthStatus]);

  // Get health status from store (synced from query)
  const { health } = useAppStore();

  const getStatusColor = () => {
    if (isCheckingHealth) return "text-yellow-600";
    switch (health.apiStatus) {
      case "healthy":
        return "text-green-600";
      case "unhealthy":
        return "text-red-600";
      case "checking":
        return "text-yellow-600";
      default:
        return "text-gray-600";
    }
  };

  const getStatusIcon = () => {
    if (isCheckingHealth) return <RefreshCw className="h-4 w-4 animate-spin" />;
    switch (health.apiStatus) {
      case "healthy":
        return <CheckCircle className="h-4 w-4" />;
      case "unhealthy":
        return <AlertCircle className="h-4 w-4" />;
      case "checking":
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      default:
        return <Server className="h-4 w-4" />;
    }
  };

  const formatResponseTime = (time: number) => {
    if (time < 1000) {
      return `${time}ms`;
    }
    return `${(time / 1000).toFixed(1)}s`;
  };

  return (
    <div className="border-t bg-background p-2" data-testid="health-status-bar">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center space-x-4">
          {/* API Status */}
          <div className="flex items-center space-x-2" data-testid="api-status">
            <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
              {getStatusIcon()}
              <span className="font-medium">API: {health.apiStatus}</span>
            </div>

            {health.responseTime > 0 && (
              <Badge variant="outline" className="text-xs">
                {formatResponseTime(health.responseTime)}
              </Badge>
            )}
          </div>

          {/* Sync Broker Status with Quick-Connect Popover */}
          <Popover
            open={serverPopoverOpen}
            onOpenChange={(open) => {
              setServerPopoverOpen(open);
              if (open) {
                handleDiscoverServers();
              }
            }}
          >
            <PopoverTrigger asChild>
              <button className="flex items-center space-x-1 hover:bg-accent/50 rounded px-1.5 py-0.5 transition-colors">
                {syncLoading ? (
                  <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />
                ) : syncConnected ? (
                  <Cloud className="h-4 w-4 text-green-600" />
                ) : (
                  <CloudOff className="h-4 w-4 text-gray-400" />
                )}
                <span
                  className={
                    syncConnected ? "text-green-600" : "text-muted-foreground"
                  }
                >
                  Sync:{" "}
                  {syncLoading
                    ? "connecting..."
                    : syncConnected
                      ? "connected"
                      : "offline"}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start" side="top">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">DDALAB Servers</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={handleDiscoverServers}
                    disabled={isDiscovering}
                  >
                    {isDiscovering ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                  </Button>
                </div>

                {/* Connected state - show disconnect option */}
                {syncConnected && (
                  <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/20 p-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Cloud className="h-4 w-4 text-green-600" />
                        <span className="text-sm text-green-700 dark:text-green-400">
                          Connected
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={handleDisconnect}
                      >
                        <Unplug className="h-3 w-3 mr-1" />
                        Disconnect
                      </Button>
                    </div>
                  </div>
                )}

                {/* Login form for discovered or recent servers */}
                {showPasswordInput &&
                  (connectingServer || connectingRecentServer) && (
                    <div className="space-y-2 p-2 rounded-md border bg-muted/30">
                      <div className="flex items-center space-x-2">
                        {connectingRecentServer ? (
                          <History className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium">
                          {connectingServer?.institution ||
                            connectingRecentServer?.institution}
                        </span>
                      </div>
                      <Input
                        type="email"
                        placeholder="Email"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        className="h-7 text-sm"
                        autoFocus
                      />
                      <Input
                        type="password"
                        placeholder="Password"
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            userEmail &&
                            serverPassword
                          ) {
                            handlePasswordSubmit();
                          }
                        }}
                        className="h-7 text-sm"
                      />
                      <Button
                        size="sm"
                        className="h-7 w-full"
                        onClick={handlePasswordSubmit}
                        disabled={isConnecting || !userEmail || !serverPassword}
                      >
                        {isConnecting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Sign In"
                        )}
                      </Button>
                      {passwordError && (
                        <p className="text-xs text-red-600">{passwordError}</p>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs text-muted-foreground"
                        onClick={() => {
                          setShowPasswordInput(false);
                          setConnectingServer(null);
                          setConnectingRecentServer(null);
                          setServerPassword("");
                          setUserEmail("");
                          setPasswordError(null);
                        }}
                      >
                        ← Back to servers
                      </Button>
                    </div>
                  )}

                {/* Manual connection form */}
                {showManualConnect && (
                  <div className="space-y-2 p-2 rounded-md border bg-muted/30">
                    <div className="flex items-center space-x-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Connect manually
                      </span>
                    </div>
                    <Input
                      type="text"
                      placeholder="Server URL (e.g., localhost:8080)"
                      value={manualServerUrl}
                      onChange={(e) => setManualServerUrl(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={userEmail}
                      onChange={(e) => setUserEmail(e.target.value)}
                      className="h-7 text-sm"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={serverPassword}
                      onChange={(e) => setServerPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          manualServerUrl.trim() &&
                          userEmail &&
                          serverPassword
                        ) {
                          handleManualConnect();
                        }
                      }}
                      className="h-7 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-7 w-full"
                      onClick={handleManualConnect}
                      disabled={
                        isConnecting ||
                        !manualServerUrl.trim() ||
                        !userEmail ||
                        !serverPassword
                      }
                    >
                      {isConnecting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Sign In"
                      )}
                    </Button>
                    {passwordError && (
                      <p className="text-xs text-red-600">{passwordError}</p>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={() => {
                        setShowManualConnect(false);
                        setManualServerUrl("");
                        setUserEmail("");
                        setServerPassword("");
                        setPasswordError(null);
                      }}
                    >
                      ← Back to servers
                    </Button>
                  </div>
                )}

                {/* Recent servers section */}
                {!showPasswordInput &&
                  !showManualConnect &&
                  recentServers.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <History className="h-3 w-3" />
                          Recent
                        </p>
                      </div>
                      {recentServers.slice(0, 3).map((server) => (
                        <div
                          key={server.url}
                          role="button"
                          tabIndex={isConnecting ? -1 : 0}
                          className={`w-full flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors text-left group cursor-pointer ${isConnecting ? "opacity-50 pointer-events-none" : ""}`}
                          onClick={() =>
                            !isConnecting && handleRecentServerSelect(server)
                          }
                          onKeyDown={(e) => {
                            if (
                              !isConnecting &&
                              (e.key === "Enter" || e.key === " ")
                            ) {
                              e.preventDefault();
                              handleRecentServerSelect(server);
                            }
                          }}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {server.institution}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {server.userEmail && (
                                  <span className="text-green-600">
                                    {server.userEmail}
                                  </span>
                                )}
                                {!server.userEmail && server.name}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                            <span className="text-[10px] text-muted-foreground">
                              {getRelativeTime(server.lastConnected)}
                            </span>
                            <button
                              className="p-1 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeRecentServer(server.url);
                              }}
                              title="Remove from recent"
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className="border-b my-2" />
                    </div>
                  )}

                {/* Server list */}
                {!showPasswordInput && !showManualConnect && (
                  <div className="space-y-1">
                    {isDiscovering ? (
                      <div className="flex items-center justify-center py-4 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        <span className="text-sm">Scanning network...</span>
                      </div>
                    ) : discoveredServers.length === 0 &&
                      recentServers.length === 0 ? (
                      <div className="py-3 text-center text-sm text-muted-foreground">
                        <CloudOff className="h-6 w-6 mx-auto mb-1 text-muted-foreground/50" />
                        <p className="text-xs">No servers discovered</p>
                      </div>
                    ) : discoveredServers.length === 0 ? null : (
                      discoveredServers.map((server, index) => (
                        <button
                          key={`${server.url}-${index}`}
                          className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors text-left"
                          onClick={() => handleServerSelect(server)}
                          disabled={isConnecting}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {server.institution}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {server.name}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1 flex-shrink-0 ml-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {server.auth_required ? (
                                    <Lock className="h-3 w-3 text-amber-500" />
                                  ) : (
                                    <Unlock className="h-3 w-3 text-green-500" />
                                  )}
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-xs">
                                  {server.auth_required
                                    ? "Password required"
                                    : "No password"}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {server.uses_tls && (
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 px-1"
                              >
                                TLS
                              </Badge>
                            )}
                          </div>
                        </button>
                      ))
                    )}

                    {/* Manual connect button */}
                    <div className="pt-1 border-t mt-1">
                      <button
                        className="w-full flex items-center space-x-2 p-2 rounded-md hover:bg-accent transition-colors text-left text-muted-foreground hover:text-foreground"
                        onClick={() => setShowManualConnect(true)}
                      >
                        <Server className="h-4 w-4" />
                        <span className="text-sm">Connect manually...</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* DDA Analysis Status with Cancel Popover */}
          {ddaRunning && (
            <div className="relative" ref={cancelPopoverRef}>
              <button
                onClick={() => {
                  if (showCancelPopover) {
                    closePopover();
                  } else {
                    setShowCancelPopover(true);
                  }
                }}
                className="flex items-center space-x-1 text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
                title="Click to cancel"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>DDA: running</span>
              </button>

              {/* Cancel Popover */}
              {showCancelPopover && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
                  <div
                    className={`bg-popover border rounded-md shadow-lg px-3 py-2 text-sm transition-all duration-150 ${
                      isPopoverClosing
                        ? "animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-2"
                        : "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {isCancelling ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          <span className="text-muted-foreground">
                            Cancelling...
                          </span>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleCancelDDA}
                            className="text-red-600 hover:text-red-700 hover:underline font-medium transition-colors"
                          >
                            Cancel?
                          </button>
                          <button
                            onClick={closePopover}
                            className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                    {/* Small arrow pointing down */}
                    <div className="absolute left-4 -bottom-1 w-2 h-2 bg-popover border-r border-b rotate-45 transform" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Last Check Time */}
          <div className="flex items-center space-x-1 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Last: {formatDateTime(new Date(health.lastCheck).toISOString())}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Expert Mode Toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center space-x-1.5 px-2 py-1 rounded-md hover:bg-accent/50 transition-colors">
                  <FlaskConical
                    className={`h-3.5 w-3.5 ${expertMode ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span
                    className={`text-xs font-medium ${expertMode ? "text-primary" : "text-muted-foreground"}`}
                  >
                    Expert
                  </span>
                  <Switch
                    checked={expertMode}
                    onCheckedChange={setExpertMode}
                    className="h-4 w-7 data-[state=checked]:bg-primary"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="font-medium">
                  {expertMode ? "Expert Mode Enabled" : "Expert Mode Disabled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {expertMode
                    ? "Advanced DDA options visible"
                    : "Using EEG defaults (delays: [7, 10], MODEL: 1 2 10)"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="w-px h-4 bg-border" />

          {/* Error Count */}
          {health.errors.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {health.errors.length} error{health.errors.length > 1 ? "s" : ""}
            </Badge>
          )}

          {/* Manual Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetchHealth()}
            disabled={isCheckingHealth}
            className="h-6 px-2"
          >
            <RefreshCw
              className={`h-3 w-3 ${isCheckingHealth ? "animate-spin" : ""}`}
            />
          </Button>

          {/* Activity Indicator */}
          <div className="flex items-center space-x-1">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div className="flex space-x-1">
              {/* API Status Dot */}
              <div
                className={`w-2 h-2 rounded-full ${
                  health.apiStatus === "healthy"
                    ? "bg-green-500 animate-pulse"
                    : health.apiStatus === "checking"
                      ? "bg-yellow-500 animate-pulse"
                      : "bg-red-500"
                }`}
              />
              {/* Sync Broker Status Dot */}
              <div
                className={`w-2 h-2 rounded-full ${
                  syncConnected ? "bg-blue-500 animate-pulse" : "bg-gray-300"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error Messages */}
      {health.errors.length > 0 && (
        <div className="mt-2 text-xs text-red-600">
          <div className="flex items-center space-x-1">
            <AlertCircle className="h-3 w-3" />
            <span>Latest error: {health.errors[0]}</span>
          </div>
        </div>
      )}
    </div>
  );
}
