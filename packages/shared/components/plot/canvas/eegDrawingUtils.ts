import { EEGData } from "../../../types/EEGData";
import { Annotation } from "../../../types/annotation";

export const CHANNEL_COLORS = [
  "#f43f5e",
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
  "#f97316",
];

export interface DrawingConfig {
  width: number;
  height: number;
  timeWindow: [number, number];
  absoluteTimeWindow?: [number, number];
  theme: string | undefined;
  annotations?: Annotation[];
  hoveredAnnotation?: number | null;
}

export const getGridInterval = (timeRange: number): number => {
  if (timeRange <= 1) return 0.1;
  if (timeRange <= 5) return 0.5;
  if (timeRange <= 10) return 1;
  if (timeRange <= 30) return 5;
  if (timeRange <= 60) return 10;
  return 30;
};

export const drawTimeGrid = (
  ctx: CanvasRenderingContext2D,
  config: DrawingConfig
): void => {
  const { width, height, timeWindow, absoluteTimeWindow, theme } = config;
  const gridColor =
    theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;

  const timeRange = timeWindow[1] - timeWindow[0];
  const gridInterval = getGridInterval(timeRange);
  const startGrid = Math.ceil(timeWindow[0] / gridInterval) * gridInterval;

  for (let t = startGrid; t <= timeWindow[1]; t += gridInterval) {
    const x = ((t - timeWindow[0]) / timeRange) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();

    const displayTime = absoluteTimeWindow
      ? (absoluteTimeWindow[0] + t - timeWindow[0]).toFixed(1)
      : t.toFixed(1);

    ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${displayTime}s`, x, height - 5);
  }
};

export const drawYAxisLabel = (
  ctx: CanvasRenderingContext2D,
  height: number,
  theme: string | undefined
): void => {
  ctx.save();
  ctx.fillStyle = theme === "dark" ? "#a0a0b0" : "#666666";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.translate(20, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Amplitude (μV)", 0, 0);
  ctx.restore();
};

export const drawChannels = (
  ctx: CanvasRenderingContext2D,
  config: DrawingConfig,
  eegData: EEGData,
  selectedChannels: string[]
): void => {
  const { width, height, timeWindow } = config;

  // Ensure minimum spacing between channels
  const channelHeight = Math.max(40, height / selectedChannels.length);
  const channelSpacing = channelHeight * 0.9;

  selectedChannels.forEach((channelName, channelIndex) => {
    const channelIdx = eegData.channels.indexOf(channelName);
    if (channelIdx === -1) return;

    const yOffset = channelHeight * channelIndex + channelHeight / 2;
    const color = CHANNEL_COLORS[channelIndex % CHANNEL_COLORS.length];

    drawChannelData(ctx, {
      data: eegData.data[channelIdx],
      timestamps: undefined, // EEGData doesn't have timestamps property
      color,
      yOffset,
      channelSpacing,
      width,
      timeWindow,
      channelName,
    });
  });
};

interface ChannelDrawConfig {
  data: number[];
  timestamps?: number[];
  color: string;
  yOffset: number;
  channelSpacing: number;
  width: number;
  timeWindow: [number, number];
  channelName: string;
}

const drawChannelData = (
  ctx: CanvasRenderingContext2D,
  config: ChannelDrawConfig
): void => {
  const {
    data,
    timestamps,
    color,
    yOffset,
    channelSpacing,
    width,
    timeWindow,
    channelName,
  } = config;

  if (!data || data.length === 0) return;

  // Filter data points within the time window
  const timeRange = timeWindow[1] - timeWindow[0];
  const filteredData: Array<{ x: number; y: number }> = [];

  // Generate timestamps if not provided (assuming uniform sampling)
  const actualTimestamps =
    timestamps ||
    data.map((_, i) => (i / data.length) * timeRange + timeWindow[0]);

  for (let i = 0; i < actualTimestamps.length; i++) {
    const t = actualTimestamps[i];
    if (t >= timeWindow[0] && t <= timeWindow[1]) {
      const x = ((t - timeWindow[0]) / timeRange) * width;
      const normalizedValue = Math.max(-1, Math.min(1, data[i] / 100));
      const y = yOffset - (normalizedValue * channelSpacing) / 4;
      filteredData.push({ x, y });
    }
  }

  if (filteredData.length === 0) return;

  // Draw the channel line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(filteredData[0].x, filteredData[0].y);

  for (let i = 1; i < filteredData.length; i++) {
    ctx.lineTo(filteredData[i].x, filteredData[i].y);
  }
  ctx.stroke();

  // Draw channel label
  ctx.fillStyle = color;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(channelName, 5, yOffset - 10);
};

export const drawAnnotations = (
  ctx: CanvasRenderingContext2D,
  config: DrawingConfig
): void => {
  const { width, height, timeWindow, annotations, hoveredAnnotation, theme } =
    config;

  if (!annotations || annotations.length === 0) return;

  const timeRange = timeWindow[1] - timeWindow[0];

  annotations.forEach((annotation) => {
    if (
      annotation.startTime >= timeWindow[0] &&
      annotation.startTime <= timeWindow[1]
    ) {
      const x = ((annotation.startTime - timeWindow[0]) / timeRange) * width;
      const isHovered = hoveredAnnotation === annotation.id;

      // Draw annotation line
      ctx.strokeStyle = isHovered ? "#ff6b6b" : "#ffd93d";
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw annotation label
      ctx.fillStyle = theme === "dark" ? "#ffffff" : "#000000";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(annotation.text || `Annotation ${annotation.id}`, x + 3, 15);
    }
  });
};

export const clearCanvas = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: string | undefined
): void => {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme === "dark" ? "#1e1e2f" : "#ffffff";
  ctx.fillRect(0, 0, width, height);
};
