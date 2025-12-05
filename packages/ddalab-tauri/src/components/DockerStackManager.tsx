import React, { useState, useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  DockerStackService,
  DockerStackStatus,
  DockerRequirements,
  ServiceStatus,
  HealthStatus,
} from "@/services/dockerStackService";

interface DockerStackManagerProps {
  onApiReady?: (apiUrl: string) => void;
}

export const DockerStackManager: React.FC<DockerStackManagerProps> = ({
  onApiReady,
}) => {
  const [stackStatus, setStackStatus] = useState<DockerStackStatus | null>(
    null,
  );
  const [requirements, setRequirements] = useState<DockerRequirements | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load initial status
  useEffect(() => {
    checkRequirementsAndStatus();
  }, []);

  // Subscribe to Docker stack status changes (event-based, no polling)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<DockerStackStatus>(
        "docker-stack-changed",
        (event) => {
          setStackStatus(event.payload);
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Notify parent when API becomes ready
  useEffect(() => {
    if (stackStatus?.is_running && onApiReady) {
      const apiService = stackStatus.services.find(
        (s) => s.name === "ddalab-api-tauri",
      );
      if (apiService && apiService.status === ServiceStatus.Running) {
        onApiReady("http://localhost:8000");
      }
    }
  }, [stackStatus, onApiReady]);

  const checkRequirementsAndStatus = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check Docker requirements
      const reqs = await DockerStackService.checkDockerRequirements();
      setRequirements(reqs);

      // Get current status
      const status = await DockerStackService.getDockerStackStatus();
      setStackStatus(status);
      setIsInitialized(status.setup_directory !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  const refreshStatus = async () => {
    try {
      const status = await DockerStackService.getDockerStackStatus();
      setStackStatus(status);
    } catch {
      // Ignore errors - user can click Refresh again if needed
    }
  };

  const setupStack = async () => {
    try {
      setLoading(true);
      setError(null);

      const status = await DockerStackService.setupDockerStack();
      setStackStatus(status);
      setIsInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  const startStack = async () => {
    try {
      setLoading(true);
      setError(null);

      const status = await DockerStackService.startDockerStack();
      setStackStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start failed");
    } finally {
      setLoading(false);
    }
  };

  const stopStack = async () => {
    try {
      setLoading(true);
      setError(null);

      const status = await DockerStackService.stopDockerStack();
      setStackStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setLoading(false);
    }
  };

  const getOverallStatus = () => {
    if (!stackStatus) return "Unknown";
    if (stackStatus.is_running) return "Running";
    if (stackStatus.services.length > 0) return "Stopped";
    return "Not Setup";
  };

  const getOverallStatusColor = () => {
    const status = getOverallStatus();
    switch (status) {
      case "Running":
        return "bg-green-100 text-green-800";
      case "Stopped":
        return "bg-yellow-100 text-yellow-800";
      case "Not Setup":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const canStart =
    requirements?.docker &&
    requirements?.docker_compose &&
    isInitialized &&
    !stackStatus?.is_running;
  const canStop = stackStatus?.is_running;
  const needsSetup =
    !isInitialized && requirements?.docker && requirements?.docker_compose;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Docker Backend Services
              <Badge className={getOverallStatusColor()}>
                {getOverallStatus()}
              </Badge>
            </CardTitle>
            <CardDescription>
              Manage the DDALAB API backend services
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={checkRequirementsAndStatus}
              variant="outline"
              size="sm"
              disabled={loading}
            >
              Refresh
            </Button>
            {needsSetup && (
              <Button onClick={setupStack} variant="default" disabled={loading}>
                Setup
              </Button>
            )}
            {canStart && (
              <Button onClick={startStack} variant="default" disabled={loading}>
                Start
              </Button>
            )}
            {canStop && (
              <Button
                onClick={stopStack}
                variant="destructive"
                disabled={loading}
              >
                Stop
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Requirements Check */}
        {requirements && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Requirements</h4>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={requirements.docker ? "default" : "destructive"}
                >
                  Docker {requirements.docker ? "✓" : "✗"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    requirements.docker_compose ? "default" : "destructive"
                  }
                >
                  Docker Compose {requirements.docker_compose ? "✓" : "✗"}
                </Badge>
              </div>
            </div>

            {(!requirements.docker || !requirements.docker_compose) && (
              <Alert>
                <AlertDescription>
                  Please install Docker and Docker Compose to use the DDALAB
                  backend services. Visit{" "}
                  <a
                    href="https://docs.docker.com/get-docker/"
                    className="underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Docker's website
                  </a>{" "}
                  for installation instructions.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Services Status */}
        {stackStatus && stackStatus.services.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Services</h4>
              <div className="space-y-2">
                {stackStatus.services.map((service, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <h5 className="font-medium">{service.name}</h5>
                        {service.ports.length > 0 && (
                          <p className="text-sm text-gray-500">
                            Ports: {service.ports.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={DockerStackService.getStatusColor(
                          service.status,
                        )}
                      >
                        {DockerStackService.getServiceStatusText(
                          service.status,
                        )}
                      </Badge>
                      {service.health !== HealthStatus.Unknown && (
                        <Badge
                          variant="outline"
                          className={DockerStackService.getHealthColor(
                            service.health,
                          )}
                        >
                          {DockerStackService.getHealthStatusText(
                            service.health,
                          )}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Setup Information */}
        {needsSetup && requirements?.docker && requirements?.docker_compose && (
          <div className="space-y-2">
            <Separator />
            <Alert>
              <AlertDescription>
                Click "Setup" to clone the DDALAB setup repository and configure
                the backend services. This will create a local Docker
                environment for the DDALAB API.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Status Information */}
        {stackStatus && (
          <div className="text-xs text-gray-500 space-y-1">
            {stackStatus.setup_directory && (
              <p>Setup Directory: {stackStatus.setup_directory}</p>
            )}
            <p>
              Last Checked:{" "}
              {new Date(stackStatus.last_checked).toLocaleString()}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
