export interface EEGChannel {
  id: string;
  label: string;
  position?: {
    x: number;
    y: number;
    z?: number;
  };
  group?: ChannelGroup;
  active: boolean;
  color?: string;
}

export type ChannelGroup = 
  | 'frontal' 
  | 'central' 
  | 'parietal' 
  | 'occipital' 
  | 'temporal' 
  | 'other';

export interface ChannelPreset {
  id: string;
  name: string;
  description: string;
  channels: string[];
  group?: ChannelGroup;
}

export interface EEGData {
  channels: string[];
  data: number[][];
  sampleRate: number;
  startTime: Date;
  duration: number;
  chunkStart: number;
  chunkSize: number;
  totalSamples: number;
  annotations: Annotation[];
}

export interface Annotation {
  id: string;
  startTime: number;
  endTime?: number;
  channel?: string;
  type: 'artifact' | 'seizure' | 'marker' | 'custom';
  label: string;
  color?: string;
}

export interface FilterConfig {
  id: string;
  type: 'highpass' | 'lowpass' | 'bandpass' | 'notch' | 'custom';
  enabled: boolean;
  parameters: Record<string, number>;
  order: number;
}

export interface DDAParameters {
  windowLength: number;
  windowStep: number;
  detrending: 'linear' | 'polynomial' | 'none';
  fluctuation: 'dfa' | 'mfdfa';
  qOrder: number[];
  scaleMin: number;
  scaleMax: number;
  scaleNum: number;
}

export interface DDAResult {
  id: string;
  parameters: DDAParameters;
  channels: string[];
  timeRange: [number, number];
  data: {
    scales: number[];
    fluctuations: Array<{
      channelId: string;
      values: number[];
    }>;
    scaling: Array<{
      channelId: string;
      exponent: number;
      rSquared: number;
    }>;
  };
  timestamp: Date;
  quality: number;
}

export interface TimeWindow {
  start: number;
  end: number;
  duration: number;
}