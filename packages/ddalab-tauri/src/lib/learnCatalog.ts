import type {
  PaperRecipe,
  PaperRecipeIndex,
  SampleDataIndex,
  SampleDataset,
} from "@/types/learn";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number")
  );
}

function isSampleDataset(value: unknown): value is SampleDataset {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.format === "string" &&
    typeof value.sizeBytes === "number" &&
    typeof value.url === "string" &&
    typeof value.channels === "number" &&
    typeof value.duration === "string" &&
    typeof value.sampleRate === "number"
  );
}

function isPaperRecipe(value: unknown): value is PaperRecipe {
  if (!isRecord(value)) return false;
  if (
    !isRecord(value.citation) ||
    !isRecord(value.dataset) ||
    !isRecord(value.steps)
  ) {
    return false;
  }

  const parameters = value.steps.parameters;
  const referenceResults = value.steps.referenceResults;

  const hasValidParameters =
    parameters === undefined ||
    (isRecord(parameters) &&
      (parameters.tau === undefined || isNumberArray(parameters.tau)) &&
      (parameters.windowLength === undefined ||
        typeof parameters.windowLength === "number") &&
      (parameters.overlap === undefined ||
        typeof parameters.overlap === "number"));

  const hasValidReferenceResults =
    referenceResults === undefined ||
    (isRecord(referenceResults) &&
      typeof referenceResults.description === "string");

  return (
    typeof value.id === "string" &&
    typeof value.description === "string" &&
    typeof value.citation.authors === "string" &&
    typeof value.citation.title === "string" &&
    typeof value.citation.journal === "string" &&
    typeof value.citation.year === "number" &&
    (value.citation.doi === undefined ||
      typeof value.citation.doi === "string") &&
    (value.dataset.source === "sample-data" ||
      value.dataset.source === "openneuro") &&
    typeof value.dataset.id === "string" &&
    (value.steps.channels === undefined ||
      isStringArray(value.steps.channels)) &&
    (value.steps.variant === undefined ||
      typeof value.steps.variant === "string") &&
    hasValidParameters &&
    hasValidReferenceResults
  );
}

function parseJson(raw: string, invalidJsonMessage: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(invalidJsonMessage);
  }
}

export function parseSampleDataIndex(raw: string): SampleDataIndex["datasets"] {
  const parsed = parseJson(
    raw,
    "DDALAB received an unreadable sample data catalog response.",
  );

  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.datasets) ||
    !parsed.datasets.every(isSampleDataset)
  ) {
    throw new Error(
      "The sample data catalog is malformed. Please try again later.",
    );
  }

  return parsed.datasets;
}

export function parsePaperRecipesIndex(
  raw: string,
): PaperRecipeIndex["recipes"] {
  const parsed = parseJson(
    raw,
    "DDALAB received an unreadable paper recipe catalog response.",
  );

  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.recipes) ||
    !parsed.recipes.every(isPaperRecipe)
  ) {
    throw new Error(
      "The paper recipe catalog is malformed. Please try again later.",
    );
  }

  return parsed.recipes;
}

function getErrorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Unknown error";
}

function isNetworkError(message: string): boolean {
  return [
    "failed to fetch",
    "network",
    "connection",
    "timed out",
    "timeout",
    "tls",
    "dns",
    "socket",
    "http",
    "transport",
  ].some((token) => message.includes(token));
}

export function getCatalogErrorMessage(
  subject: "sample data catalog" | "paper recipe catalog",
  error: unknown,
): string {
  const message = getErrorText(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("not running in tauri")) {
    return `${subject[0].toUpperCase()}${subject.slice(1)} is only available in the desktop app.`;
  }

  if (isNetworkError(lowerMessage)) {
    return `Could not refresh the ${subject}. Check your connection and try again.`;
  }

  return message.startsWith("DDALAB ") || message.startsWith("The ")
    ? message
    : `Could not refresh the ${subject}: ${message}`;
}

export function getSampleDownloadErrorMessage(
  datasetName: string,
  error: unknown,
): string {
  const message = getErrorText(error);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("not running in tauri")) {
    return `Sample downloads are only available in the desktop app.`;
  }

  if (isNetworkError(lowerMessage)) {
    return `Could not download "${datasetName}". Check your connection and try again.`;
  }

  return `Could not download "${datasetName}": ${message}`;
}
