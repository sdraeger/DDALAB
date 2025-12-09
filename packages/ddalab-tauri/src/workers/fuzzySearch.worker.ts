/**
 * Web Worker for fuzzy search operations
 * Provides parallelized string matching when WASM is unavailable
 */

export interface FuzzySearchRequest {
  type: "levenshteinBatch" | "trigramBatch";
  id: string;
  query: string;
  targets: string[];
  startIdx?: number; // For chunked processing
}

export interface FuzzySearchResponse {
  type: "result" | "error" | "ready";
  id?: string;
  results?: number[];
  error?: string;
}

// Levenshtein distance with early exit optimization
function levenshteinDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) {
    return 999;
  }

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  let prevRow: number[] = Array.from(
    { length: aLower.length + 1 },
    (_, i) => i,
  );
  let currRow: number[] = new Array(aLower.length + 1).fill(0);

  for (let i = 0; i < bLower.length; i++) {
    currRow[0] = i + 1;

    for (let j = 0; j < aLower.length; j++) {
      const cost = aLower[j] === bLower[i] ? 0 : 1;
      currRow[j + 1] = Math.min(
        prevRow[j + 1] + 1,
        currRow[j] + 1,
        prevRow[j] + cost,
      );
    }

    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[aLower.length];
}

// Trigram similarity (Sørensen-Dice coefficient)
function trigramSimilarity(a: string, b: string): number {
  const generateTrigrams = (str: string): Set<string> => {
    const trigrams = new Set<string>();
    const normalized = str.toLowerCase();
    const padded = `  ${normalized}  `;

    for (let i = 0; i < padded.length - 2; i++) {
      trigrams.add(padded.slice(i, i + 3));
    }

    return trigrams;
  };

  const trigramsA = generateTrigrams(a);
  const trigramsB = generateTrigrams(b);

  if (trigramsA.size === 0 || trigramsB.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) intersectionCount++;
  }

  return (2 * intersectionCount) / (trigramsA.size + trigramsB.size);
}

// Handle incoming messages
self.onmessage = (event: MessageEvent<FuzzySearchRequest>) => {
  const request = event.data;

  try {
    let results: number[];

    switch (request.type) {
      case "levenshteinBatch":
        results = request.targets.map((target) =>
          levenshteinDistance(request.query, target),
        );
        break;

      case "trigramBatch":
        results = request.targets.map((target) =>
          trigramSimilarity(request.query, target),
        );
        break;

      default:
        throw new Error(`Unknown request type: ${(request as any).type}`);
    }

    self.postMessage({
      type: "result",
      id: request.id,
      results,
    } as FuzzySearchResponse);
  } catch (error) {
    self.postMessage({
      type: "error",
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    } as FuzzySearchResponse);
  }
};

// Signal ready
self.postMessage({ type: "ready" } as FuzzySearchResponse);
