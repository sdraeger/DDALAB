/**
 * File utility functions for the File Manager
 */

/**
 * Supported file extensions for neurophysiology data
 */
export const SUPPORTED_EXTENSIONS = [
  ".edf", // EDF/EDF+
  ".csv", // CSV data
  ".ascii", // ASCII data
  ".txt", // Text data
  ".fif", // FIF/FIFF (MEG)
  ".fiff", // FIF/FIFF alternate extension
  ".vhdr", // BrainVision header
  ".set", // EEGLAB
  ".xdf", // XDF (Lab Streaming Layer)
  ".nwb", // NWB (Neurodata Without Borders)
];

/**
 * Get file format label from filename
 */
export function getFileFormat(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".edf")) return "EDF";
  if (lowerName.endsWith(".fif") || lowerName.endsWith(".fiff")) return "FIF";
  if (lowerName.endsWith(".csv")) return "CSV";
  if (lowerName.endsWith(".ascii")) return "ASCII";
  if (lowerName.endsWith(".set")) return "SET";
  if (lowerName.endsWith(".vhdr")) return "VHDR";
  if (lowerName.endsWith(".xdf")) return "XDF";
  if (lowerName.endsWith(".nwb")) return "NWB";
  if (lowerName.endsWith(".nii.gz")) return "NII.GZ";
  if (lowerName.endsWith(".nii")) return "NII";
  return "TXT";
}

/**
 * Get BIDS modality badge CSS classes
 */
export function getModalityBadgeClass(modality: string): string {
  const modalityLower = modality.toLowerCase();
  if (modalityLower === "eeg") {
    return "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700";
  } else if (modalityLower === "meg") {
    return "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700";
  } else if (modalityLower === "ieeg") {
    return "bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700";
  } else if (modalityLower === "mri" || modalityLower === "anat") {
    return "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700";
  } else if (modalityLower === "fmri" || modalityLower === "func") {
    return "bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700";
  } else if (modalityLower === "dwi") {
    return "bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700";
  } else if (modalityLower === "pet") {
    return "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700";
  }
  return "bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700";
}

/**
 * Check if filename matches search query (case-insensitive)
 */
export function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * Check if a file extension is supported
 */
export function isSupportedExtension(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}
