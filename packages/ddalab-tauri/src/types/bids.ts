/**
 * BIDS (Brain Imaging Data Structure) Type Definitions
 */

export interface DirectoryEntry {
  name: string;
  path: string;
  isBIDS?: boolean;
  /** True if this directory is inside a BIDS dataset (not the root) */
  isInsideBIDS?: boolean;
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
