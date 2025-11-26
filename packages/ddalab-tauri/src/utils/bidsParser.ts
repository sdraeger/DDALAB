/**
 * BIDS Path Parser Utility
 *
 * Parses BIDS-formatted file paths to extract dataset, subject, session,
 * task, and run information for display in the UI.
 */

export interface BIDSPathInfo {
  /** Dataset name (from directory name or dataset_description.json) */
  datasetName: string;
  /** Subject ID (e.g., "01", "sub-01") */
  subjectId: string;
  /** Session ID if present (e.g., "01", "ses-01") */
  sessionId?: string;
  /** Task name from filename (e.g., "rest", "mmnhcs") */
  taskName?: string;
  /** Run number if present (e.g., "1", "01") */
  runNumber?: string;
  /** Modality (eeg, meg, ieeg) */
  modality?: string;
  /** Whether this appears to be a BIDS-formatted path */
  isBIDS: boolean;
  /** Full display string for the breadcrumb */
  displayString: string;
  /** Short display string for compact views */
  shortDisplay: string;
}

/**
 * Parse a file path to extract BIDS information
 *
 * Expected BIDS path format:
 * /path/to/dataset/sub-XX/[ses-XX/]modality/sub-XX_[ses-XX_]task-XXX_[run-X_]modality.ext
 *
 * @param filePath - The full path to the file
 * @returns BIDSPathInfo object with extracted information
 */
export function parseBIDSPath(filePath: string): BIDSPathInfo {
  const result: BIDSPathInfo = {
    datasetName: "",
    subjectId: "",
    isBIDS: false,
    displayString: "",
    shortDisplay: "",
  };

  if (!filePath) {
    result.displayString = "No file selected";
    result.shortDisplay = "No file";
    return result;
  }

  const pathParts = filePath.split("/").filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] || "";

  // Try to find subject directory (sub-XX)
  const subjectDirIndex = pathParts.findIndex((part) =>
    part.match(/^sub-[a-zA-Z0-9]+$/),
  );

  if (subjectDirIndex === -1) {
    // Not a BIDS path, just show filename
    result.displayString = fileName;
    result.shortDisplay = fileName;
    return result;
  }

  result.isBIDS = true;

  // Extract dataset name (directory before sub-XX)
  if (subjectDirIndex > 0) {
    result.datasetName = pathParts[subjectDirIndex - 1];
  }

  // Extract subject ID
  const subjectMatch = pathParts[subjectDirIndex].match(/^sub-([a-zA-Z0-9]+)$/);
  if (subjectMatch) {
    result.subjectId = subjectMatch[1];
  }

  // Check for session directory (ses-XX)
  const sessionDirIndex = pathParts.findIndex(
    (part, idx) => idx > subjectDirIndex && part.match(/^ses-[a-zA-Z0-9]+$/),
  );
  if (sessionDirIndex !== -1) {
    const sessionMatch =
      pathParts[sessionDirIndex].match(/^ses-([a-zA-Z0-9]+)$/);
    if (sessionMatch) {
      result.sessionId = sessionMatch[1];
    }
  }

  // Extract modality from directory structure
  const modalityDir = pathParts.find((part) =>
    ["eeg", "meg", "ieeg", "anat", "func"].includes(part.toLowerCase()),
  );
  if (modalityDir) {
    result.modality = modalityDir.toLowerCase();
  }

  // Parse filename for task and run
  // Format: sub-XX_[ses-XX_]task-XXX_[run-X_]modality.ext
  const taskMatch = fileName.match(/task-([a-zA-Z0-9]+)/i);
  if (taskMatch) {
    result.taskName = taskMatch[1];
  }

  const runMatch = fileName.match(/run-([0-9]+)/i);
  if (runMatch) {
    result.runNumber = runMatch[1];
  }

  // Build display strings
  result.displayString = buildDisplayString(result);
  result.shortDisplay = buildShortDisplay(result);

  return result;
}

/**
 * Build a full display string for breadcrumb display
 */
function buildDisplayString(info: BIDSPathInfo): string {
  const parts: string[] = [];

  if (info.datasetName) {
    parts.push(info.datasetName);
  }

  if (info.subjectId) {
    parts.push(`Subject ${info.subjectId}`);
  }

  if (info.sessionId) {
    parts.push(`Session ${info.sessionId}`);
  }

  if (info.taskName) {
    // Format task name nicely (capitalize, expand common abbreviations)
    const formattedTask = formatTaskName(info.taskName);
    parts.push(formattedTask);
  }

  if (info.runNumber) {
    parts.push(`Run ${info.runNumber}`);
  }

  return parts.join(" → ");
}

/**
 * Build a short display string for compact views
 */
function buildShortDisplay(info: BIDSPathInfo): string {
  const parts: string[] = [];

  if (info.subjectId) {
    parts.push(`S${info.subjectId}`);
  }

  if (info.taskName) {
    parts.push(info.taskName.toUpperCase());
  }

  if (info.runNumber) {
    parts.push(`R${info.runNumber}`);
  }

  return parts.join(" / ") || info.datasetName || "Unknown";
}

/**
 * Format task name for display
 * - Capitalizes first letter
 * - Expands common abbreviations
 */
function formatTaskName(taskName: string): string {
  // Common task name expansions
  const expansions: Record<string, string> = {
    rest: "Resting State",
    eyesclosed: "Eyes Closed",
    eyesopen: "Eyes Open",
    mmi: "Motor-Motor Imagery",
    mmnhcs: "MMN HCS",
    noise: "Noise Recording",
    emptyroom: "Empty Room",
    ern: "Error-Related Negativity",
    ssep: "SSEP",
    aep: "AEP",
    vep: "VEP",
  };

  const lower = taskName.toLowerCase();
  if (expansions[lower]) {
    return expansions[lower];
  }

  // Default: capitalize first letter
  return taskName.charAt(0).toUpperCase() + taskName.slice(1);
}

/**
 * Get a color class based on modality
 */
export function getModalityColor(modality?: string): string {
  switch (modality?.toLowerCase()) {
    case "eeg":
      return "text-blue-500";
    case "meg":
      return "text-purple-500";
    case "ieeg":
      return "text-orange-500";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Get a badge variant based on modality
 */
export function getModalityBadgeVariant(
  modality?: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (modality?.toLowerCase()) {
    case "eeg":
    case "meg":
    case "ieeg":
      return "default";
    default:
      return "outline";
  }
}
