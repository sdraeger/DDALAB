import {
  FileText,
  FileSpreadsheet,
  Brain,
  Activity,
  FileCode,
  Database,
  File,
  type LucideIcon,
} from "lucide-react";

export interface FileTypeInfo {
  icon: LucideIcon;
  color: string;
  label: string;
}

const FILE_TYPE_MAP: Record<string, FileTypeInfo> = {
  // EDF/EDF+ - European Data Format (clinical EEG)
  edf: {
    icon: Activity,
    color: "text-emerald-500",
    label: "EDF",
  },

  // BrainVision formats
  vhdr: {
    icon: Brain,
    color: "text-purple-500",
    label: "BrainVision",
  },
  vmrk: {
    icon: Brain,
    color: "text-purple-500",
    label: "BrainVision",
  },
  eeg: {
    icon: Brain,
    color: "text-purple-500",
    label: "BrainVision",
  },

  // EEGLAB format
  set: {
    icon: Brain,
    color: "text-blue-500",
    label: "EEGLAB",
  },

  // FIF/FIFF - Neuromag/Elekta MEG
  fif: {
    icon: Activity,
    color: "text-orange-500",
    label: "FIF",
  },

  // NIfTI neuroimaging
  nii: {
    icon: Brain,
    color: "text-pink-500",
    label: "NIfTI",
  },
  "nii.gz": {
    icon: Brain,
    color: "text-pink-500",
    label: "NIfTI",
  },

  // XDF - Lab Streaming Layer
  xdf: {
    icon: Database,
    color: "text-cyan-500",
    label: "XDF",
  },

  // NWB - Neurodata Without Borders
  nwb: {
    icon: Database,
    color: "text-indigo-500",
    label: "NWB",
  },

  // CSV/ASCII
  csv: {
    icon: FileSpreadsheet,
    color: "text-green-500",
    label: "CSV",
  },
  txt: {
    icon: FileText,
    color: "text-slate-500",
    label: "Text",
  },
  tsv: {
    icon: FileSpreadsheet,
    color: "text-green-500",
    label: "TSV",
  },

  // JSON
  json: {
    icon: FileCode,
    color: "text-yellow-500",
    label: "JSON",
  },
};

const DEFAULT_FILE_TYPE: FileTypeInfo = {
  icon: File,
  color: "text-muted-foreground",
  label: "File",
};

export function getFileTypeInfo(fileName: string): FileTypeInfo {
  const lowerName = fileName.toLowerCase();

  // Check for double extensions first (e.g., .nii.gz)
  if (lowerName.endsWith(".nii.gz")) {
    return FILE_TYPE_MAP["nii.gz"];
  }

  // Extract extension
  const lastDot = lowerName.lastIndexOf(".");
  if (lastDot === -1) {
    return DEFAULT_FILE_TYPE;
  }

  const extension = lowerName.slice(lastDot + 1);
  return FILE_TYPE_MAP[extension] ?? DEFAULT_FILE_TYPE;
}

export function getFileExtension(fileName: string): string {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".nii.gz")) {
    return "nii.gz";
  }

  const lastDot = lowerName.lastIndexOf(".");
  if (lastDot === -1) {
    return "";
  }

  return lowerName.slice(lastDot + 1);
}
