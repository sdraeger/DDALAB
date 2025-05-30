import type { EEGData } from "./EEGData";

export interface DDAPlotProps {
  filePath: string;
  taskId?: string;
  Q?: any;
  onChunkLoaded?: (data: EEGData) => void;
  preprocessingOptions?: any;
  selectedChannels: string[];
  setSelectedChannels: (channels: string[]) => void;
  onChannelSelectionChange: (channels: string[]) => void;
  onAvailableChannelsChange?: (channels: string[]) => void;
}
