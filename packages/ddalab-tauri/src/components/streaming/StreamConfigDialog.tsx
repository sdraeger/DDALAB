"use client";

import { useState, useMemo } from "react";
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
  BridgeState,
} from "@/types/streaming";
import { LslStreamDiscovery, type LslStreamInfo } from "./LslStreamDiscovery";

export function StreamConfigDialog() {
  const isOpen = useAppStore((state) => state.streaming.ui.isConfigDialogOpen);
  const updateStreamUI = useAppStore((state) => state.updateStreamUI);
  const createStreamSession = useAppStore((state) => state.createStreamSession);
  const bridgeState = useAppStore((state) => state.streaming.ui.bridgeState);
  const startLslBridge = useAppStore((state) => state.startLslBridge);

  const [sourceType, setSourceType] = useState<StreamSourceType>("file");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Source configuration state
  const [fileConfig, setFileConfig] = useState({
    path: "",
    chunk_size: 200, // Smaller chunks for smoother updates
    rate_limit_ms: 0, // 0 = auto-calculate based on sample rate
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

  const [lslConfig, setLslConfig] = useState({
    stream_name: "",
    stream_type: "any",
    source_id: "",
    resolve_timeout: 5.0,
    chunk_size: 1000,
    use_lsl_timestamps: true,
  });

  const [zmqConfig, setZmqConfig] = useState({
    endpoint: "tcp://127.0.0.1:5555",
    pattern: "sub" as "sub" | "pull",
    topic: "",
    expected_channels: 8,
    expected_sample_rate: 250,
    hwm: 1000,
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
      delay_list: [7, 10], // Default delays
    },
    algorithm_selection: {
      enabled_variants: ["ST"],
      select_mask: "1 0 0 0",
    },
    include_q_matrices: true,
    selected_channels: undefined, // Process all channels
  });

  // Validation helper for port numbers (1-65535)
  const isValidPort = (port: number): boolean =>
    Number.isInteger(port) && port >= 1 && port <= 65535;

  // Validation state
  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (sourceType === "tcp" && !isValidPort(tcpConfig.port)) {
      errors.push("TCP port must be between 1 and 65535");
    }
    if (sourceType === "udp" && !isValidPort(udpConfig.port)) {
      errors.push("UDP port must be between 1 and 65535");
    }
    if (sourceType === "file" && !fileConfig.path) {
      errors.push("File path is required");
    }
    if (sourceType === "websocket" && !websocketConfig.url) {
      errors.push("WebSocket URL is required");
    }

    return errors;
  }, [
    sourceType,
    tcpConfig.port,
    udpConfig.port,
    fileConfig.path,
    websocketConfig.url,
  ]);

  const canCreate = validationErrors.length === 0;

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
            // Convert 0 to undefined for auto-calculation
            rate_limit_ms:
              fileConfig.rate_limit_ms === 0
                ? undefined
                : fileConfig.rate_limit_ms,
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
        case "lsl": {
          // Ensure bridge is running before starting LSL stream
          if (bridgeState.type !== "Running") {
            await startLslBridge();
            // Wait briefly for state update
            await new Promise((r) => setTimeout(r, 200));
          }

          // Translate LSL config to WebSocket URL via the bridge
          const name = lslConfig.stream_name || "";
          const type =
            lslConfig.stream_type === "any" ? "" : lslConfig.stream_type;
          const sid = lslConfig.source_id || "";

          const params = new URLSearchParams();
          if (name) params.set("name", name);
          if (type) params.set("type", type);
          if (sid) params.set("source_id", sid);

          sourceConfig = {
            type: "websocket",
            url: `ws://127.0.0.1:17424/stream?${params.toString()}`,
            reconnect: true,
          };
          break;
        }
        case "zmq":
          sourceConfig = {
            type: "zmq",
            endpoint: zmqConfig.endpoint,
            pattern: zmqConfig.pattern,
            topic: zmqConfig.topic || undefined,
            expected_channels: zmqConfig.expected_channels,
            expected_sample_rate: zmqConfig.expected_sample_rate,
            hwm: zmqConfig.hwm,
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
                  <SelectItem value="lsl">
                    Lab Streaming Layer <Badge variant="secondary">LSL</Badge>
                  </SelectItem>
                  <SelectItem value="zmq">
                    ZeroMQ <Badge variant="secondary">Pure Rust</Badge>
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
                      Rate Limit (ms):{" "}
                      {fileConfig.rate_limit_ms === 0
                        ? "Auto"
                        : fileConfig.rate_limit_ms}
                    </Label>
                    <Slider
                      id="rate-limit"
                      min={0}
                      max={1000}
                      step={10}
                      value={[fileConfig.rate_limit_ms]}
                      onValueChange={([value]) =>
                        setFileConfig({ ...fileConfig, rate_limit_ms: value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      {fileConfig.rate_limit_ms === 0
                        ? "Auto-calculated based on chunk size and sample rate for realistic streaming"
                        : "Fixed delay between chunks (overrides real-time calculation)"}
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

            {/* LSL Source Config */}
            {sourceType === "lsl" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Lab Streaming Layer Settings
                  </CardTitle>
                  <CardDescription>
                    Connect to LSL streams on the network with sub-millisecond
                    synchronization
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stream Discovery */}
                  <LslStreamDiscovery
                    onSelectStream={(stream: LslStreamInfo) => {
                      setLslConfig({
                        ...lslConfig,
                        stream_name: stream.name,
                        stream_type:
                          stream.stream_type === "any"
                            ? ""
                            : stream.stream_type,
                        source_id: stream.source_id,
                      });
                    }}
                    selectedStreamId={lslConfig.source_id}
                    autoRefresh={true}
                    refreshInterval={2000}
                  />

                  <Separator />

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Select a stream above or manually configure below. Leave
                      fields empty to match any stream.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label htmlFor="lsl-stream-name">
                      Stream Name (optional)
                    </Label>
                    <Input
                      id="lsl-stream-name"
                      placeholder="Leave empty to match any name"
                      value={lslConfig.stream_name}
                      onChange={(e) =>
                        setLslConfig({
                          ...lslConfig,
                          stream_name: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lsl-stream-type">Stream Type</Label>
                    <Select
                      value={lslConfig.stream_type}
                      onValueChange={(value) =>
                        setLslConfig({ ...lslConfig, stream_type: value })
                      }
                    >
                      <SelectTrigger id="lsl-stream-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any Type</SelectItem>
                        <SelectItem value="EEG">EEG</SelectItem>
                        <SelectItem value="MEG">MEG</SelectItem>
                        <SelectItem value="ECG">ECG</SelectItem>
                        <SelectItem value="EMG">EMG</SelectItem>
                        <SelectItem value="EOG">EOG</SelectItem>
                        <SelectItem value="Gaze">Gaze</SelectItem>
                        <SelectItem value="Markers">Markers</SelectItem>
                        <SelectItem value="Audio">Audio</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Common stream types in neuroscience research
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lsl-source-id">Source ID (optional)</Label>
                    <Input
                      id="lsl-source-id"
                      placeholder="Unique identifier"
                      value={lslConfig.source_id}
                      onChange={(e) =>
                        setLslConfig({
                          ...lslConfig,
                          source_id: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lsl-timeout">
                      Resolution Timeout: {lslConfig.resolve_timeout}s
                    </Label>
                    <Slider
                      id="lsl-timeout"
                      min={1}
                      max={30}
                      step={0.5}
                      value={[lslConfig.resolve_timeout]}
                      onValueChange={([value]) =>
                        setLslConfig({ ...lslConfig, resolve_timeout: value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Maximum time to wait for stream discovery
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lsl-chunk-size">
                      Chunk Size: {lslConfig.chunk_size} samples
                    </Label>
                    <Slider
                      id="lsl-chunk-size"
                      min={100}
                      max={5000}
                      step={100}
                      value={[lslConfig.chunk_size]}
                      onValueChange={([value]) =>
                        setLslConfig({ ...lslConfig, chunk_size: value })
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="lsl-timestamps"
                      checked={lslConfig.use_lsl_timestamps}
                      onCheckedChange={(checked) =>
                        setLslConfig({
                          ...lslConfig,
                          use_lsl_timestamps: checked as boolean,
                        })
                      }
                    />
                    <Label htmlFor="lsl-timestamps" className="cursor-pointer">
                      Use LSL synchronized timestamps
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Recommended for accurate multi-device synchronization
                  </p>
                </CardContent>
              </Card>
            )}

            {/* ZeroMQ Source Config */}
            {sourceType === "zmq" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">ZeroMQ Settings</CardTitle>
                  <CardDescription>
                    Connect to ZeroMQ publishers or pushers with high-throughput
                    messaging (pure Rust, no dependencies)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="zmq-endpoint">Endpoint</Label>
                    <Input
                      id="zmq-endpoint"
                      placeholder="tcp://127.0.0.1:5555"
                      value={zmqConfig.endpoint}
                      onChange={(e) =>
                        setZmqConfig({ ...zmqConfig, endpoint: e.target.value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Examples: tcp://localhost:5555, ipc:///tmp/data.ipc
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zmq-pattern">Socket Pattern</Label>
                    <Select
                      value={zmqConfig.pattern}
                      onValueChange={(value) =>
                        setZmqConfig({
                          ...zmqConfig,
                          pattern: value as "sub" | "pull",
                        })
                      }
                    >
                      <SelectTrigger id="zmq-pattern">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sub">
                          SUB (Subscribe){" "}
                          <Badge variant="secondary">Pub/Sub</Badge>
                        </SelectItem>
                        <SelectItem value="pull">
                          PULL (Receive){" "}
                          <Badge variant="secondary">Pipeline</Badge>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      SUB: Subscribe to published messages with topic filtering
                      <br />
                      PULL: Receive pushed messages in round-robin
                    </p>
                  </div>

                  {zmqConfig.pattern === "sub" && (
                    <div className="space-y-2">
                      <Label htmlFor="zmq-topic">Topic Filter (optional)</Label>
                      <Input
                        id="zmq-topic"
                        placeholder="Leave empty to subscribe to all topics"
                        value={zmqConfig.topic}
                        onChange={(e) =>
                          setZmqConfig({ ...zmqConfig, topic: e.target.value })
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        Subscribe only to messages with this prefix. Empty = all
                        messages.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="zmq-channels">
                      Expected Channels: {zmqConfig.expected_channels}
                    </Label>
                    <Slider
                      id="zmq-channels"
                      min={1}
                      max={64}
                      step={1}
                      value={[zmqConfig.expected_channels]}
                      onValueChange={([value]) =>
                        setZmqConfig({ ...zmqConfig, expected_channels: value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zmq-srate">
                      Expected Sample Rate: {zmqConfig.expected_sample_rate} Hz
                    </Label>
                    <Slider
                      id="zmq-srate"
                      min={1}
                      max={2000}
                      step={1}
                      value={[zmqConfig.expected_sample_rate]}
                      onValueChange={([value]) =>
                        setZmqConfig({
                          ...zmqConfig,
                          expected_sample_rate: value,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zmq-hwm">
                      High Water Mark: {zmqConfig.hwm} messages
                    </Label>
                    <Slider
                      id="zmq-hwm"
                      min={0}
                      max={10000}
                      step={100}
                      value={[zmqConfig.hwm]}
                      onValueChange={([value]) =>
                        setZmqConfig({ ...zmqConfig, hwm: value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Max queued messages before blocking. 0 = unlimited.
                    </p>
                  </div>

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Messages must be JSON with format:{" "}
                      {`{"samples": [[...], [...]], "timestamp": 123.45, "sample_rate": 250, "channel_names": [...]}`}
                    </AlertDescription>
                  </Alert>
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
                        min={1}
                        max={65535}
                        value={tcpConfig.port}
                        onChange={(e) =>
                          setTcpConfig({
                            ...tcpConfig,
                            port: parseInt(e.target.value) || 0,
                          })
                        }
                        className={
                          !isValidPort(tcpConfig.port)
                            ? "border-destructive"
                            : ""
                        }
                      />
                      {!isValidPort(tcpConfig.port) && (
                        <p className="text-xs text-destructive">
                          Port must be 1-65535
                        </p>
                      )}
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
                        min={1}
                        max={65535}
                        value={udpConfig.port}
                        onChange={(e) =>
                          setUdpConfig({
                            ...udpConfig,
                            port: parseInt(e.target.value) || 0,
                          })
                        }
                        className={
                          !isValidPort(udpConfig.port)
                            ? "border-destructive"
                            : ""
                        }
                      />
                      {!isValidPort(udpConfig.port) && (
                        <p className="text-xs text-destructive">
                          Port must be 1-65535
                        </p>
                      )}
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
                <CardTitle className="text-base">Delay Configuration</CardTitle>
                <CardDescription>
                  Configure delay values for DDA computation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="delay-list">
                    Delay List (comma-separated integers)
                  </Label>
                  <Input
                    id="delay-list"
                    placeholder="7, 10"
                    value={(
                      ddaConfig.scale_parameters.delay_list || [7, 10]
                    ).join(", ")}
                    onChange={(e) => {
                      const delays = e.target.value
                        .split(",")
                        .map((s) => parseInt(s.trim()))
                        .filter((n) => !isNaN(n));
                      setDdaConfig({
                        ...ddaConfig,
                        scale_parameters: {
                          ...ddaConfig.scale_parameters,
                          delay_list: delays.length > 0 ? delays : [7, 10],
                        },
                      });
                    }}
                  />
                  <p className="text-sm text-muted-foreground">
                    Example: 7, 10 or 5, 7, 10, 15
                  </p>
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

        {(error || validationErrors.length > 0) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || validationErrors.join(". ")}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !canCreate}>
            <Play className="h-4 w-4 mr-2" />
            {isCreating ? "Creating..." : "Start Streaming"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
