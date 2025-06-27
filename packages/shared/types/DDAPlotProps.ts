import type { EEGData } from "./EEGData";
import type { ArtifactInfo } from "../components/ui/ArtifactIdentifier";

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
  artifactInfo?: ArtifactInfo;
  noBorder?: boolean;
}
