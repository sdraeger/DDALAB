/**
 * BIDS (Brain Imaging Data Structure) Type Definitions
 */

export interface DirectoryEntry {
  name: string;
  path: string;
  isBIDS?: boolean;
  bidsInfo?: BIDSInfo;
}

export interface BIDSInfo {
  datasetName?: string;
  bidsVersion?: string;
  subjectCount?: number;
  sessionCount?: number;
  runCount?: number;
  modalities?: string[];
  tasks?: string[];
}
