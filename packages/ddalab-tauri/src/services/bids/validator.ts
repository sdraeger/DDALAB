/**
 * BIDS Format Validator
 *
 * Validates BIDS (Brain Imaging Data Structure) directory structure and files.
 * Specification: https://bids-specification.readthedocs.io/
 */

export interface BIDSValidationError {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface BIDSValidationResult {
  valid: boolean;
  errors: BIDSValidationError[];
  warnings: BIDSValidationError[];
}

export interface BIDSDatasetDescription {
  Name: string;
  BIDSVersion: string;
  DatasetType?: "raw" | "derivative";
  License?: string;
  Authors?: string[];
  Acknowledgements?: string;
  HowToAcknowledge?: string;
  Funding?: string[];
  EthicsApprovals?: string[];
  ReferencesAndLinks?: string[];
  DatasetDOI?: string;
}

export interface BIDSParticipant {
  participant_id: string;
  age?: number;
  sex?: "M" | "F" | "O";
  [key: string]: any; // Allow additional columns
}

/**
 * Validates if a directory is a valid BIDS dataset
 */
export async function validateBIDSDataset(
  rootPath: string,
): Promise<BIDSValidationResult> {
  const errors: BIDSValidationError[] = [];
  const warnings: BIDSValidationError[] = [];

  try {
    // Check for required files
    await validateRequiredFiles(rootPath, errors);

    // Validate dataset_description.json
    await validateDatasetDescription(rootPath, errors, warnings);

    // Validate participants.tsv (if exists)
    await validateParticipantsTSV(rootPath, errors, warnings);

    // Validate subject directories
    await validateSubjectDirectories(rootPath, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push({
      code: "VALIDATION_ERROR",
      message: `Failed to validate BIDS dataset: ${error}`,
      severity: "error",
    });
    return {
      valid: false,
      errors,
      warnings,
    };
  }
}

/**
 * Check if directory appears to be a BIDS dataset (quick check)
 */
export async function isBIDSDataset(rootPath: string): Promise<boolean> {
  try {
    const { readDir, exists } = await import("@tauri-apps/plugin-fs");

    // Quick check: does dataset_description.json exist?
    const datasetDescPath = `${rootPath}/dataset_description.json`;
    const hasDatasetDesc = await exists(datasetDescPath);

    if (!hasDatasetDesc) {
      return false;
    }

    // Quick check: are there any sub-* directories?
    const entries = await readDir(rootPath);
    const hasSubjects = entries.some(
      (entry) => entry.isDirectory && entry.name.startsWith("sub-"),
    );

    return hasSubjects;
  } catch (error) {
    console.error("Error checking BIDS dataset:", error);
    return false;
  }
}

/**
 * Validate required files exist
 */
async function validateRequiredFiles(
  rootPath: string,
  errors: BIDSValidationError[],
): Promise<void> {
  const { exists } = await import("@tauri-apps/plugin-fs");

  // dataset_description.json is required
  const datasetDescPath = `${rootPath}/dataset_description.json`;
  if (!(await exists(datasetDescPath))) {
    errors.push({
      code: "MISSING_DATASET_DESCRIPTION",
      message: "Required file dataset_description.json is missing",
      path: datasetDescPath,
      severity: "error",
    });
  }

  // README is recommended but not required
  const readmePath = `${rootPath}/README`;
  if (!(await exists(readmePath))) {
    errors.push({
      code: "MISSING_README",
      message: "README file is recommended but missing",
      path: readmePath,
      severity: "warning",
    });
  }
}

/**
 * Validate dataset_description.json
 */
async function validateDatasetDescription(
  rootPath: string,
  errors: BIDSValidationError[],
  warnings: BIDSValidationError[],
): Promise<void> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    const datasetDescPath = `${rootPath}/dataset_description.json`;
    if (!(await exists(datasetDescPath))) {
      return; // Already caught in validateRequiredFiles
    }

    const content = await readTextFile(datasetDescPath);
    const desc: BIDSDatasetDescription = JSON.parse(content);

    // Required fields
    if (!desc.Name) {
      errors.push({
        code: "MISSING_NAME",
        message: 'dataset_description.json must include "Name" field',
        path: datasetDescPath,
        severity: "error",
      });
    }

    if (!desc.BIDSVersion) {
      errors.push({
        code: "MISSING_BIDS_VERSION",
        message: 'dataset_description.json must include "BIDSVersion" field',
        path: datasetDescPath,
        severity: "error",
      });
    }

    // Recommended fields
    if (!desc.License) {
      warnings.push({
        code: "MISSING_LICENSE",
        message: 'dataset_description.json should include "License" field',
        path: datasetDescPath,
        severity: "warning",
      });
    }

    if (!desc.Authors || desc.Authors.length === 0) {
      warnings.push({
        code: "MISSING_AUTHORS",
        message: 'dataset_description.json should include "Authors" field',
        path: datasetDescPath,
        severity: "warning",
      });
    }
  } catch (error) {
    errors.push({
      code: "INVALID_DATASET_DESCRIPTION",
      message: `Failed to parse dataset_description.json: ${error}`,
      path: `${rootPath}/dataset_description.json`,
      severity: "error",
    });
  }
}

/**
 * Validate participants.tsv
 */
async function validateParticipantsTSV(
  rootPath: string,
  errors: BIDSValidationError[],
  warnings: BIDSValidationError[],
): Promise<void> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    const participantsPath = `${rootPath}/participants.tsv`;
    if (!(await exists(participantsPath))) {
      warnings.push({
        code: "MISSING_PARTICIPANTS",
        message: "participants.tsv is recommended but missing",
        path: participantsPath,
        severity: "warning",
      });
      return;
    }

    const content = await readTextFile(participantsPath);
    const lines = content.trim().split("\n");

    if (lines.length < 2) {
      errors.push({
        code: "EMPTY_PARTICIPANTS",
        message:
          "participants.tsv must have at least a header and one participant",
        path: participantsPath,
        severity: "error",
      });
      return;
    }

    // Check header
    const header = lines[0].split("\t");
    if (!header.includes("participant_id")) {
      errors.push({
        code: "MISSING_PARTICIPANT_ID_COLUMN",
        message: 'participants.tsv must have a "participant_id" column',
        path: participantsPath,
        severity: "error",
      });
    }

    // Validate each participant ID
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split("\t");
      const participantId = columns[header.indexOf("participant_id")];

      if (!participantId || !participantId.startsWith("sub-")) {
        errors.push({
          code: "INVALID_PARTICIPANT_ID",
          message: `Line ${i + 1}: participant_id must start with "sub-"`,
          path: participantsPath,
          severity: "error",
        });
      }
    }
  } catch (error) {
    errors.push({
      code: "INVALID_PARTICIPANTS",
      message: `Failed to parse participants.tsv: ${error}`,
      path: `${rootPath}/participants.tsv`,
      severity: "error",
    });
  }
}

/**
 * Validate subject directories
 */
async function validateSubjectDirectories(
  rootPath: string,
  errors: BIDSValidationError[],
  warnings: BIDSValidationError[],
): Promise<void> {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");

    const entries = await readDir(rootPath);
    const subjectDirs = entries.filter(
      (entry) => entry.isDirectory && entry.name.startsWith("sub-"),
    );

    if (subjectDirs.length === 0) {
      errors.push({
        code: "NO_SUBJECTS",
        message: "No subject directories (sub-*) found",
        path: rootPath,
        severity: "error",
      });
      return;
    }

    // Validate subject naming
    for (const subDir of subjectDirs) {
      const match = subDir.name.match(/^sub-([a-zA-Z0-9]+)$/);
      if (!match) {
        errors.push({
          code: "INVALID_SUBJECT_NAME",
          message: `Subject directory "${subDir.name}" has invalid format. Should be sub-<label>`,
          path: `${rootPath}/${subDir.name}`,
          severity: "error",
        });
      }

      // Check for data directories within subject
      const subPath = `${rootPath}/${subDir.name}`;
      await validateSubjectDataDir(subPath, errors, warnings);
    }
  } catch (error) {
    errors.push({
      code: "SUBJECT_VALIDATION_ERROR",
      message: `Failed to validate subject directories: ${error}`,
      path: rootPath,
      severity: "error",
    });
  }
}

/**
 * Validate subject data directories (ses-* or eeg/ieeg/meg)
 */
async function validateSubjectDataDir(
  subjectPath: string,
  errors: BIDSValidationError[],
  warnings: BIDSValidationError[],
): Promise<void> {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");

    const entries = await readDir(subjectPath);

    // Check for session directories
    const sessionDirs = entries.filter(
      (entry) => entry.isDirectory && entry.name.startsWith("ses-"),
    );

    // Check for modality directories (eeg, ieeg, meg, etc.)
    const modalityDirs = entries.filter(
      (entry) =>
        entry.isDirectory &&
        ["eeg", "ieeg", "meg", "func", "anat"].includes(entry.name),
    );

    if (sessionDirs.length === 0 && modalityDirs.length === 0) {
      warnings.push({
        code: "NO_DATA_DIRECTORIES",
        message: `Subject has no session or modality directories`,
        path: subjectPath,
        severity: "warning",
      });
    }

    // Validate session naming
    for (const sesDir of sessionDirs) {
      const match = sesDir.name.match(/^ses-([a-zA-Z0-9]+)$/);
      if (!match) {
        errors.push({
          code: "INVALID_SESSION_NAME",
          message: `Session directory "${sesDir.name}" has invalid format. Should be ses-<label>`,
          path: `${subjectPath}/${sesDir.name}`,
          severity: "error",
        });
      }
    }
  } catch (error) {
    // Silently skip if we can't read the directory
  }
}

/**
 * Parse dataset_description.json
 */
export async function readDatasetDescription(
  rootPath: string,
): Promise<BIDSDatasetDescription | null> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    const datasetDescPath = `${rootPath}/dataset_description.json`;
    if (!(await exists(datasetDescPath))) {
      return null;
    }

    const content = await readTextFile(datasetDescPath);
    return JSON.parse(content) as BIDSDatasetDescription;
  } catch (error) {
    console.error("Failed to read dataset_description.json:", error);
    return null;
  }
}

/**
 * Parse participants.tsv
 */
export async function readParticipants(
  rootPath: string,
): Promise<BIDSParticipant[]> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");

    const participantsPath = `${rootPath}/participants.tsv`;
    if (!(await exists(participantsPath))) {
      return [];
    }

    const content = await readTextFile(participantsPath);
    const lines = content.trim().split("\n");

    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split("\t");
    const participants: BIDSParticipant[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split("\t");
      const participant: any = {};

      headers.forEach((header, index) => {
        const value = values[index];
        // Try to parse numbers
        if (value && !isNaN(Number(value))) {
          participant[header] = Number(value);
        } else {
          participant[header] = value;
        }
      });

      participants.push(participant as BIDSParticipant);
    }

    return participants;
  } catch (error) {
    console.error("Failed to read participants.tsv:", error);
    return [];
  }
}
