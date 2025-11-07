"use client";

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/store/appStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Play, Settings2, FolderOpen } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  StreamSourceType,
  StreamSourceConfig,
  StreamingDDAConfig,
} from "@/types/streaming";

export function StreamConfigDialog() {
  const isOpen = useAppStore((state) => state.streaming.ui.isConfigDialogOpen);
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);
  const createStreamSession = useAppStore((state) => state.createStreamSession);

  const [sourceType, setSourceType] = useState<StreamSourceType>("file");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Source configuration state
  const [fileConfig, setFileConfig] = useState({
    path: "",
    chunk_size: 1000,
    rate_limit_ms: 100,
    loop_playback: true,
  });

  const [websocketConfig, setWebsocketConfig] = useState({
    url: "ws://localhost:8080",
    reconnect: true,
  });

  const [tcpConfig, setTcpConfig] = useState({
    host: "localhost",
    port: 5000,
  });

  const [udpConfig, setUdpConfig] = useState({
    bind_address: "0.0.0.0",
    port: 5000,
  });

  const [serialConfig, setSerialConfig] = useState({
    port: "/dev/ttyUSB0",
    baud_rate: 115200,
  });

  // DDA configuration state
  const [ddaConfig, setDdaConfig] = useState<StreamingDDAConfig>({
    window_size: 1000,
    window_overlap: 0.5,
    window_parameters: {
      window_length: 100,
      window_step: 10,
    },
    scale_parameters: {
      scale_min: 1.0,
      scale_max: 100.0,
      scale_num: 50,
      delay_list: [7, 10],
    },
    algorithm_selection: {
      enabled_variants: ["ST"],
      select_mask: "1 0 0 0",
    },
    include_q_matrices: false,
  });

  const handleClose = () => {
    updateStreamUI({ isConfigDialogOpen: false });
    setError(null);
  };

  const handleBrowseFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "EDF Files",
            extensions: ["edf", "bdf"],
          },
          {
            name: "All Files",
            extensions: ["*"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        setFileConfig({ ...fileConfig, path: selected });
      }
    } catch (err) {
      console.error("Failed to open file dialog:", err);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setIsCreating(true);

    try {
      // Build source config based on type
      let sourceConfig: StreamSourceConfig;

      switch (sourceType) {
        case "file":
          sourceConfig = {
            type: "file",
            ...fileConfig,
          };
          break;
        case "websocket":
          sourceConfig = {
            type: "websocket",
            ...websocketConfig,
          };
          break;
        case "tcp":
          sourceConfig = {
            type: "tcp",
            ...tcpConfig,
          };
          break;
        case "udp":
          sourceConfig = {
            type: "udp",
            ...udpConfig,
          };
          break;
        case "serial":
          sourceConfig = {
            type: "serial",
            ...serialConfig,
          };
          break;
        default:
          throw new Error(`Unsupported source type: ${sourceType}`);
      }

      // Create stream session
      const streamId = await createStreamSession(sourceConfig, ddaConfig);
      console.log(`Stream created: ${streamId}`);

      // Close dialog
      handleClose();
    } catch (err) {
      console.error("Failed to create stream:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Streaming Session</DialogTitle>
          <DialogDescription>
            Set up a real-time data stream source and DDA analysis parameters
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="source" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="source">Data Source</TabsTrigger>
            <TabsTrigger value="dda">DDA Parameters</TabsTrigger>
          </TabsList>

          {/* Source Configuration */}
          <TabsContent value="source" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="source-type">Source Type</Label>
              <Select
                value={sourceType}
                onValueChange={(value) =>
                  setSourceType(value as StreamSourceType)
                }
              >
                <SelectTrigger id="source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="file">
                    File Playback <Badge variant="secondary">Testing</Badge>
                  </SelectItem>
                  <SelectItem value="websocket">WebSocket</SelectItem>
                  <SelectItem value="tcp">TCP Socket</SelectItem>
                  <SelectItem value="udp">UDP Socket</SelectItem>
                  <SelectItem value="serial">Serial Port (Unix)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* File Source Config */}
            {sourceType === "file" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    File Playback Settings
                  </CardTitle>
                  <CardDescription>
                    Stream data from an EDF file at a controlled rate
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="file-path">File Path</Label>
                    <div className="flex gap-2">
                      <Input
                        id="file-path"
                        placeholder="/path/to/data.edf"
                        value={fileConfig.path}
                        onChange={(e) =>
                          setFileConfig({ ...fileConfig, path: e.target.value })
                        }
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleBrowseFile}
                      >
                        <FolderOpen className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="chunk-size">
                      Chunk Size (samples): {fileConfig.chunk_size}
                    </Label>
                    <Slider
                      id="chunk-size"
                      min={100}
                      max={5000}
                      step={100}
                      value={[fileConfig.chunk_size]}
                      onValueChange={([value]) =>
                        setFileConfig({ ...fileConfig, chunk_size: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate-limit">
                      Rate Limit (ms): {fileConfig.rate_limit_ms}
                    </Label>
                    <Slider
                      id="rate-limit"
                      min={10}
                      max={1000}
                      step={10}
                      value={[fileConfig.rate_limit_ms]}
                      onValueChange={([value]) =>
                        setFileConfig({ ...fileConfig, rate_limit_ms: value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Delay between chunks to simulate real-time streaming
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="loop-playback"
                      checked={fileConfig.loop_playback}
                      onCheckedChange={(checked) =>
                        setFileConfig({
                          ...fileConfig,
                          loop_playback: checked as boolean,
                        })
                      }
                    />
                    <Label htmlFor="loop-playback" className="cursor-pointer">
                      Loop playback when file ends
                    </Label>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* WebSocket Source Config */}
            {sourceType === "websocket" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    WebSocket Settings
                  </CardTitle>
                  <CardDescription>
                    Connect to a WebSocket server streaming JSON data
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ws-url">WebSocket URL</Label>
                    <Input
                      id="ws-url"
                      placeholder="ws://localhost:8080"
                      value={websocketConfig.url}
                      onChange={(e) =>
                        setWebsocketConfig({
                          ...websocketConfig,
                          url: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="ws-reconnect"
                      checked={websocketConfig.reconnect}
                      onCheckedChange={(checked) =>
                        setWebsocketConfig({
                          ...websocketConfig,
                          reconnect: checked as boolean,
                        })
                      }
                    />
                    <Label htmlFor="ws-reconnect" className="cursor-pointer">
                      Auto-reconnect on disconnect
                    </Label>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* TCP Source Config */}
            {sourceType === "tcp" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    TCP Socket Settings
                  </CardTitle>
                  <CardDescription>
                    Connect to a TCP server with newline-delimited JSON
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="tcp-host">Host</Label>
                      <Input
                        id="tcp-host"
                        placeholder="localhost"
                        value={tcpConfig.host}
                        onChange={(e) =>
                          setTcpConfig({ ...tcpConfig, host: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tcp-port">Port</Label>
                      <Input
                        id="tcp-port"
                        type="number"
                        value={tcpConfig.port}
                        onChange={(e) =>
                          setTcpConfig({
                            ...tcpConfig,
                            port: parseInt(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* UDP Source Config */}
            {sourceType === "udp" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    UDP Socket Settings
                  </CardTitle>
                  <CardDescription>
                    Receive UDP datagrams with JSON data
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="udp-bind">Bind Address</Label>
                      <Input
                        id="udp-bind"
                        placeholder="0.0.0.0"
                        value={udpConfig.bind_address}
                        onChange={(e) =>
                          setUdpConfig({
                            ...udpConfig,
                            bind_address: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="udp-port">Port</Label>
                      <Input
                        id="udp-port"
                        type="number"
                        value={udpConfig.port}
                        onChange={(e) =>
                          setUdpConfig({
                            ...udpConfig,
                            port: parseInt(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Serial Source Config */}
            {sourceType === "serial" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Serial Port Settings
                  </CardTitle>
                  <CardDescription>
                    Read from a serial port (Unix systems only)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="serial-port">Port</Label>
                    <Input
                      id="serial-port"
                      placeholder="/dev/ttyUSB0"
                      value={serialConfig.port}
                      onChange={(e) =>
                        setSerialConfig({
                          ...serialConfig,
                          port: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="baud-rate">Baud Rate</Label>
                    <Select
                      value={serialConfig.baud_rate.toString()}
                      onValueChange={(value) =>
                        setSerialConfig({
                          ...serialConfig,
                          baud_rate: parseInt(value),
                        })
                      }
                    >
                      <SelectTrigger id="baud-rate">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="9600">9600</SelectItem>
                        <SelectItem value="19200">19200</SelectItem>
                        <SelectItem value="38400">38400</SelectItem>
                        <SelectItem value="57600">57600</SelectItem>
                        <SelectItem value="115200">115200</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* DDA Configuration */}
          <TabsContent value="dda" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Window Configuration
                </CardTitle>
                <CardDescription>
                  Configure sliding window for continuous DDA analysis
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="window-size">
                    Window Size (samples): {ddaConfig.window_size}
                  </Label>
                  <Slider
                    id="window-size"
                    min={100}
                    max={5000}
                    step={100}
                    value={[ddaConfig.window_size]}
                    onValueChange={([value]) =>
                      setDdaConfig({ ...ddaConfig, window_size: value })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="window-overlap">
                    Window Overlap:{" "}
                    {(ddaConfig.window_overlap * 100).toFixed(0)}%
                  </Label>
                  <Slider
                    id="window-overlap"
                    min={0}
                    max={0.9}
                    step={0.1}
                    value={[ddaConfig.window_overlap]}
                    onValueChange={([value]) =>
                      setDdaConfig({ ...ddaConfig, window_overlap: value })
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    Higher overlap = more windows, higher CPU usage
                  </p>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dda-window-length">Window Length</Label>
                    <Input
                      id="dda-window-length"
                      type="number"
                      value={ddaConfig.window_parameters.window_length}
                      onChange={(e) =>
                        setDdaConfig({
                          ...ddaConfig,
                          window_parameters: {
                            ...ddaConfig.window_parameters,
                            window_length: parseInt(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dda-window-step">Window Step</Label>
                    <Input
                      id="dda-window-step"
                      type="number"
                      value={ddaConfig.window_parameters.window_step}
                      onChange={(e) =>
                        setDdaConfig({
                          ...ddaConfig,
                          window_parameters: {
                            ...ddaConfig.window_parameters,
                            window_step: parseInt(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scale Parameters</CardTitle>
                <CardDescription>
                  Configure scale range for DDA computation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scale-min">Min Scale</Label>
                    <Input
                      id="scale-min"
                      type="number"
                      step="0.1"
                      value={ddaConfig.scale_parameters.scale_min}
                      onChange={(e) =>
                        setDdaConfig({
                          ...ddaConfig,
                          scale_parameters: {
                            ...ddaConfig.scale_parameters,
                            scale_min: parseFloat(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scale-max">Max Scale</Label>
                    <Input
                      id="scale-max"
                      type="number"
                      step="0.1"
                      value={ddaConfig.scale_parameters.scale_max}
                      onChange={(e) =>
                        setDdaConfig({
                          ...ddaConfig,
                          scale_parameters: {
                            ...ddaConfig.scale_parameters,
                            scale_max: parseFloat(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scale-num">Number of Scales</Label>
                    <Input
                      id="scale-num"
                      type="number"
                      value={ddaConfig.scale_parameters.scale_num}
                      onChange={(e) =>
                        setDdaConfig({
                          ...ddaConfig,
                          scale_parameters: {
                            ...ddaConfig.scale_parameters,
                            scale_num: parseInt(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-q-matrices"
                checked={ddaConfig.include_q_matrices}
                onCheckedChange={(checked) =>
                  setDdaConfig({
                    ...ddaConfig,
                    include_q_matrices: checked as boolean,
                  })
                }
              />
              <Label htmlFor="include-q-matrices" className="cursor-pointer">
                Include full Q matrices (increases memory usage)
              </Label>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            <Play className="h-4 w-4 mr-2" />
            {isCreating ? "Creating..." : "Start Streaming"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
