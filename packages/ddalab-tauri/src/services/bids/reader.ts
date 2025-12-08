/**
 * BIDS Dataset Reader
 *
 * Reads BIDS-formatted EEG/iEEG/MEG datasets and converts them to DDALAB internal format.
 * Recognizes: EDF, FIFF, BrainVision, EEGLAB, and MEG formats (.fif, .ds, .sqd, .meg4, .con, .kit)
 * Analysis support: EDF, FIFF (.fif), BrainVision, EEGLAB (Other MEG formats detected but not yet supported)
 */

export interface BIDSSubject {
  id: string; // e.g., "sub-01"
  label: string; // e.g., "01"
  sessions: BIDSSession[];
}

export interface BIDSSession {
  id: string; // e.g., "ses-01" or empty string if no sessions
  label: string; // e.g., "01" or empty string
  runs: BIDSRun[];
}

export interface BIDSRun {
  id: string; // Full path to data file
  task: string; // Task label (from filename)
  run: string; // Run number (from filename)
  modality: "eeg" | "ieeg" | "meg";
  dataFile: string; // Path to .edf, .vhdr, .set file
  jsonFile?: string; // Path to sidecar JSON
  channelsFile?: string; // Path to _channels.tsv
  eventsFile?: string; // Path to _events.tsv
  metadata?: BIDSMetadata;
}

export interface BIDSMetadata {
  TaskName?: string;
  InstitutionName?: string;
  SamplingFrequency?: number;
  PowerLineFrequency?: number;
  SoftwareFilters?: any;
  EEGReference?: string;
  EEGGround?: string;
  EEGPlacementScheme?: string;
  Manufacturer?: string;
  ManufacturersModelName?: string;
  [key: string]: any;
}

export interface BIDSChannel {
  name: string;
  type: string; // EEG, EOG, ECG, EMG, MISC, etc.
  units: string;
  sampling_frequency?: number;
  low_cutoff?: number;
  high_cutoff?: number;
  notch?: number;
  status?: string; // good or bad
  status_description?: string;
}

export interface BIDSEvent {
  onset: number; // in seconds
  duration: number; // in seconds
  trial_type?: string;
  value?: string | number;
  sample?: number;
  [key: string]: any;
}

/**
 * Discover all subjects in a BIDS dataset (optimized with parallel operations)
 */
export async function discoverSubjects(
  rootPath: string,
): Promise<BIDSSubject[]> {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");

    const entries = await readDir(rootPath);
    const subjectDirs = entries.filter(
      (entry) => entry.isDirectory && entry.name.startsWith("sub-"),
    );

    // Process all subjects in parallel for better performance
    const subjectPromises = subjectDirs.map(async (subDir) => {
      const match = subDir.name.match(/^sub-([a-zA-Z0-9]+)$/);
      if (!match) return null;

      const label = match[1];
      const subjectPath = `${rootPath}/${subDir.name}`;

      const sessions = await discoverSessions(subjectPath);

      return {
        id: subDir.name,
        label,
        sessions,
      };
    });

    const subjects = await Promise.all(subjectPromises);
    return subjects.filter((s): s is BIDSSubject => s !== null);
  } catch (error) {
    console.error("Failed to discover subjects:", error);
    return [];
  }
}

/**
 * Discover all sessions for a subject (optimized with parallel operations)
 */
async function discoverSessions(subjectPath: string): Promise<BIDSSession[]> {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");

    const entries = await readDir(subjectPath);

    const sessionDirs = entries.filter(
      (entry) => entry.isDirectory && entry.name.startsWith("ses-"),
    );

    // If no session directories, check for modality directories directly
    if (sessionDirs.length === 0) {
      const runs = await discoverRuns(subjectPath, "");
      if (runs.length > 0) {
        return [
          {
            id: "",
            label: "",
            runs,
          },
        ];
      }
      return [];
    }

    // Process all sessions in parallel
    const sessionPromises = sessionDirs.map(async (sesDir) => {
      const match = sesDir.name.match(/^ses-([a-zA-Z0-9]+)$/);
      if (!match) return null;

      const label = match[1];
      const sessionPath = `${subjectPath}/${sesDir.name}`;
      const runs = await discoverRuns(sessionPath, sesDir.name);

      return {
        id: sesDir.name,
        label,
        runs,
      };
    });

    const sessions = await Promise.all(sessionPromises);
    return sessions.filter((s): s is BIDSSession => s !== null);
  } catch (error) {
    console.error(
      `[BIDS] Failed to discover sessions in ${subjectPath}:`,
      error,
    );
    return [];
  }
}

/**
 * Discover all runs in a session or subject directory (optimized with parallel operations)
 */
async function discoverRuns(
  path: string,
  sessionId: string,
): Promise<BIDSRun[]> {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");

    const entries = await readDir(path);

    // Look for modality directories
    const modalityDirs = entries.filter(
      (entry) =>
        entry.isDirectory && ["eeg", "ieeg", "meg"].includes(entry.name),
    );

    // Process all modality directories in parallel
    const modalityPromises = modalityDirs.map(async (modalityDir) => {
      const modality = modalityDir.name as "eeg" | "ieeg" | "meg";
      const modalityPath = `${path}/${modalityDir.name}`;

      const modalityEntries = await readDir(modalityPath);

      // Find data files - EDF, BrainVision, EEGLAB, and MEG formats
      // MEG formats: .fif (Neuromag/Elekta), .ds (CTF), .sqd/.meg4/.con (KIT/Yokogawa)
      const dataFiles = modalityEntries.filter(
        (entry) =>
          !entry.isDirectory &&
          (entry.name.endsWith(".edf") ||
            entry.name.endsWith(".vhdr") ||
            entry.name.endsWith(".set") ||
            entry.name.endsWith(".fif") ||
            entry.name.endsWith(".ds") ||
            entry.name.endsWith(".sqd") ||
            entry.name.endsWith(".meg4") ||
            entry.name.endsWith(".con") ||
            entry.name.endsWith(".kit")),
      );

      const runs: BIDSRun[] = [];

      for (const dataFile of dataFiles) {
        const baseName = dataFile.name.replace(
          /\.(edf|vhdr|set|fif|ds|sqd|meg4|con|kit)$/,
          "",
        );

        // Parse BIDS filename: sub-<label>[_ses-<label>]_task-<label>[_run-<label>]_<modality>
        const filenameMatch = baseName.match(
          /sub-[a-zA-Z0-9]+(?:_ses-[a-zA-Z0-9]+)?_task-([a-zA-Z0-9]+)(?:_run-([a-zA-Z0-9]+))?_(?:eeg|ieeg|meg)/,
        );

        if (!filenameMatch) {
          continue;
        }

        const task = filenameMatch[1] || "unknown";
        const run = filenameMatch[2] || "01";

        const dataFilePath = `${modalityPath}/${dataFile.name}`;
        const jsonFilePath = `${modalityPath}/${baseName}.json`;
        const channelsFilePath = `${modalityPath}/${baseName}_channels.tsv`;
        const eventsFilePath = `${modalityPath}/${baseName}_events.tsv`;

        runs.push({
          id: dataFilePath,
          task,
          run,
          modality,
          dataFile: dataFilePath,
          jsonFile: jsonFilePath,
          channelsFile: channelsFilePath,
          eventsFile: eventsFilePath,
        });
      }

      return runs;
    });

    const modalityRuns = await Promise.all(modalityPromises);
    return modalityRuns.flat();
  } catch (error) {
    console.error("Failed to discover runs:", error);
    return [];
  }
}

/**
 * Read sidecar JSON metadata for a run
 */
export async function readMetadata(jsonPath: string): Promise<BIDSMetadata> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    if (!(await exists(jsonPath))) {
      return {};
    }

    const content = await readTextFile(jsonPath);
    return JSON.parse(content) as BIDSMetadata;
  } catch (error) {
    console.error(`Failed to read metadata from ${jsonPath}:`, error);
    return {};
  }
}

/**
 * Read channels TSV file
 */
export async function readChannels(
  channelsPath: string,
): Promise<BIDSChannel[]> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    if (!(await exists(channelsPath))) {
      return [];
    }

    const content = await readTextFile(channelsPath);
    const lines = content.trim().split("\n");

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split("\t");
    const channels: BIDSChannel[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split("\t");
      const channel: any = {};

      headers.forEach((header, index) => {
        const value = values[index];
        // Try to parse numbers
        if (value && !isNaN(Number(value))) {
          channel[header] = Number(value);
        } else {
          channel[header] = value;
        }
      });

      channels.push(channel as BIDSChannel);
    }

    return channels;
  } catch (error) {
    console.error(`Failed to read channels from ${channelsPath}:`, error);
    return [];
  }
}

/**
 * Read events TSV file
 */
export async function readEvents(eventsPath: string): Promise<BIDSEvent[]> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    if (!(await exists(eventsPath))) {
      return [];
    }

    const content = await readTextFile(eventsPath);
    const lines = content.trim().split("\n");

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split("\t");
    const events: BIDSEvent[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split("\t");
      const event: any = {};

      headers.forEach((header, index) => {
        const value = values[index];
        // Try to parse numbers
        if (value && !isNaN(Number(value))) {
          event[header] = Number(value);
        } else {
          event[header] = value;
        }
      });

      // Ensure required fields
      if (event.onset === undefined) {
        continue;
      }
      if (event.duration === undefined) {
        event.duration = 0;
      }

      events.push(event as BIDSEvent);
    }

    return events;
  } catch (error) {
    console.error(`Failed to read events from ${eventsPath}:`, error);
    return [];
  }
}

/**
 * Load a complete BIDS run with all metadata
 */
export async function loadBIDSRun(run: BIDSRun): Promise<BIDSRun> {
  const { exists } = await import("@tauri-apps/plugin-fs");

  const enrichedRun = { ...run };

  // Load metadata from JSON
  if (enrichedRun.jsonFile && (await exists(enrichedRun.jsonFile))) {
    enrichedRun.metadata = await readMetadata(enrichedRun.jsonFile);
  }

  return enrichedRun;
}

/**
 * Get a summary of a BIDS dataset
 */
export interface BIDSDatasetSummary {
  subjectCount: number;
  sessionCount: number;
  runCount: number;
  modalities: Set<string>;
  tasks: Set<string>;
  hasFMRI: boolean;
  hasElectrophysiology: boolean;
}

/**
 * Batch check multiple directories for BIDS datasets
 * Optimized to minimize file system operations by doing quick checks first,
 * then only fetching full details for confirmed BIDS directories.
 */
export interface BatchBIDSResult {
  path: string;
  name: string;
  isBIDS: boolean;
  description?: {
    Name?: string;
    BIDSVersion?: string;
  } | null;
  summary?: BIDSDatasetSummary | null;
}

export async function batchCheckBIDS(
  directories: Array<{ name: string; path: string }>,
): Promise<BatchBIDSResult[]> {
  const { readDir, exists, readTextFile } = await import(
    "@tauri-apps/plugin-fs"
  );

  // Phase 1: Quick check all directories in parallel (just exists + readDir)
  const quickCheckResults = await Promise.all(
    directories.map(async (dir) => {
      try {
        const datasetDescPath = `${dir.path}/dataset_description.json`;
        const hasDatasetDesc = await exists(datasetDescPath);

        if (!hasDatasetDesc) {
          return { ...dir, isBIDS: false };
        }

        const entries = await readDir(dir.path);
        const hasSubjects = entries.some(
          (entry) => entry.isDirectory && entry.name.startsWith("sub-"),
        );

        return { ...dir, isBIDS: hasSubjects };
      } catch {
        return { ...dir, isBIDS: false };
      }
    }),
  );

  // Phase 2: For confirmed BIDS directories, fetch description and summary in parallel
  const results: BatchBIDSResult[] = [];

  for (const check of quickCheckResults) {
    if (!check.isBIDS) {
      results.push({
        path: check.path,
        name: check.name,
        isBIDS: false,
      });
      continue;
    }

    // Fetch description and summary in parallel for this BIDS directory
    const [description, summary] = await Promise.all([
      (async () => {
        try {
          const descPath = `${check.path}/dataset_description.json`;
          const content = await readTextFile(descPath);
          return JSON.parse(content);
        } catch {
          return null;
        }
      })(),
      getDatasetSummary(check.path).catch(() => null),
    ]);

    results.push({
      path: check.path,
      name: check.name,
      isBIDS: true,
      description,
      summary,
    });
  }

  return results;
}

export async function getDatasetSummary(
  rootPath: string,
): Promise<BIDSDatasetSummary> {
  const subjects = await discoverSubjects(rootPath);

  let sessionCount = 0;
  let runCount = 0;
  const modalities = new Set<string>();
  const tasks = new Set<string>();
  let hasFMRI = false;
  let hasElectrophysiology = false;

  // Check for fMRI modalities by scanning subject directories
  const { readDir } = await import("@tauri-apps/plugin-fs");

  for (const subject of subjects) {
    sessionCount += subject.sessions.length;

    // Check for fMRI directories (anat, func, dwi)
    try {
      const subjectPath = `${rootPath}/${subject.id}`;
      const entries = await readDir(subjectPath);
      const fmriDirs = entries.filter(
        (entry) =>
          entry.isDirectory && ["anat", "func", "dwi"].includes(entry.name),
      );

      if (fmriDirs.length > 0) {
        hasFMRI = true;
        fmriDirs.forEach((dir) => modalities.add(dir.name));
      }

      // Also check session directories for fMRI data
      const sessionDirs = entries.filter(
        (entry) => entry.isDirectory && entry.name.startsWith("ses-"),
      );

      for (const sessionDir of sessionDirs) {
        const sessionPath = `${subjectPath}/${sessionDir.name}`;
        const sessionEntries = await readDir(sessionPath);
        const sessionFmriDirs = sessionEntries.filter(
          (entry) =>
            entry.isDirectory && ["anat", "func", "dwi"].includes(entry.name),
        );

        if (sessionFmriDirs.length > 0) {
          hasFMRI = true;
          sessionFmriDirs.forEach((dir) => modalities.add(dir.name));
        }
      }
    } catch {
      // Silently skip if fMRI data check fails
    }

    for (const session of subject.sessions) {
      runCount += session.runs.length;

      for (const run of session.runs) {
        modalities.add(run.modality);
        tasks.add(run.task);
        hasElectrophysiology = true;
      }
    }
  }

  return {
    subjectCount: subjects.length,
    sessionCount,
    runCount,
    modalities,
    tasks,
    hasFMRI,
    hasElectrophysiology,
  };
}
