/**
 * Fuzzy search utilities for typo-tolerant, partial matching
 * Combines multiple algorithms for comprehensive search:
 * - Levenshtein distance for typo tolerance (WASM-accelerated)
 * - Trigram similarity for partial matches (WASM-accelerated)
 * - Token-based matching for multi-word queries
 * - Prefix matching for quick finds
 */

import {
  levenshteinDistance as wasmLevenshtein,
  trigramSimilarity as wasmTrigramSimilarity,
} from "./wasmService";

/**
 * Calculate Levenshtein distance between two strings
 * Measures minimum number of single-character edits needed
 * Uses WASM for ~5-10x performance improvement
 */
function levenshteinDistance(a: string, b: string): number {
  return wasmLevenshtein(a, b);
}

/**
 * Generate trigrams from a string
 * "hello" -> ["hel", "ell", "llo"]
 */
export function generateTrigrams(str: string): Set<string> {
  const trigrams = new Set<string>();
  const normalized = str.toLowerCase();

  // Add padding for better edge matching
  const padded = `  ${normalized}  `;

  for (let i = 0; i < padded.length - 2; i++) {
    trigrams.add(padded.slice(i, i + 3));
  }

  return trigrams;
}

/**
 * Calculate similarity using trigram overlap
 * Returns 0-1, where 1 is identical
 * Uses WASM for ~4-8x performance improvement
 */
function trigramSimilarity(a: string, b: string): number {
  return wasmTrigramSimilarity(a, b);
}

/**
 * Normalize text for comparison
 * - Lowercase
 * - Remove special characters
 * - Trim whitespace
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

/**
 * Split into tokens for multi-word matching
 */
function tokenize(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export interface FuzzyMatchOptions {
  /** Maximum Levenshtein distance to consider a match (default: 2) */
  maxEditDistance?: number;
  /** Minimum trigram similarity to consider a match (default: 0.4) */
  minTrigramSimilarity?: number;
  /** Boost for prefix matches (default: true) */
  prefixBoost?: boolean;
  /** Boost for exact matches (default: true) */
  exactMatchBoost?: boolean;
  /** Minimum token match ratio for multi-word queries (default: 0.5) */
  minTokenMatchRatio?: number;
}

export interface FuzzyMatchResult {
  /** Whether the query matches the target */
  matches: boolean;
  /** Match score (0-100, higher is better) */
  score: number;
  /** Match type for debugging/optimization */
  matchType:
    | "exact"
    | "prefix"
    | "substring"
    | "fuzzy-typo"
    | "fuzzy-partial"
    | "token-match"
    | "none";
  /** Edit distance if applicable */
  editDistance?: number;
  /** Trigram similarity if applicable */
  trigramScore?: number;
}

/**
 * Comprehensive fuzzy matching algorithm
 * Combines multiple techniques for best results
 */
export function fuzzyMatch(
  query: string,
  target: string,
  options: FuzzyMatchOptions = {},
): FuzzyMatchResult {
  const {
    maxEditDistance = 2,
    minTrigramSimilarity = 0.4,
    prefixBoost = true,
    exactMatchBoost = true,
    minTokenMatchRatio = 0.5,
  } = options;

  const normalizedQuery = normalize(query);
  const normalizedTarget = normalize(target);

  // Empty query or target
  if (!normalizedQuery || !normalizedTarget) {
    return { matches: false, score: 0, matchType: "none" };
  }

  // 1. Exact match (highest priority)
  if (exactMatchBoost && normalizedQuery === normalizedTarget) {
    return { matches: true, score: 100, matchType: "exact" };
  }

  // 2. Prefix match (very common in search)
  if (prefixBoost && normalizedTarget.startsWith(normalizedQuery)) {
    const score = 90 - (normalizedTarget.length - normalizedQuery.length) * 2;
    return { matches: true, score: Math.max(score, 70), matchType: "prefix" };
  }

  // 3. Substring match
  if (normalizedTarget.includes(normalizedQuery)) {
    const position = normalizedTarget.indexOf(normalizedQuery);
    // Earlier positions score higher
    const score = 80 - position * 2;
    return {
      matches: true,
      score: Math.max(score, 50),
      matchType: "substring",
    };
  }

  // 4. Multi-word token matching
  const queryTokens = tokenize(query);
  const targetTokens = tokenize(target);

  if (queryTokens.length > 1 || targetTokens.length > 1) {
    let matchedTokens = 0;
    let totalScore = 0;

    for (const queryToken of queryTokens) {
      for (const targetToken of targetTokens) {
        // Check for substring match
        if (targetToken.includes(queryToken)) {
          matchedTokens++;
          totalScore += 60;
          break;
        }

        // Check for prefix match
        if (targetToken.startsWith(queryToken)) {
          matchedTokens++;
          totalScore += 50;
          break;
        }

        // Check for fuzzy match on individual tokens
        const editDist = levenshteinDistance(queryToken, targetToken);
        if (editDist <= maxEditDistance) {
          matchedTokens++;
          totalScore += 40 - editDist * 10;
          break;
        }
      }
    }

    const matchRatio = matchedTokens / queryTokens.length;
    if (matchRatio >= minTokenMatchRatio) {
      const avgScore = totalScore / queryTokens.length;
      return {
        matches: true,
        score: Math.min(avgScore, 70),
        matchType: "token-match",
      };
    }
  }

  // 5. Typo tolerance via Levenshtein distance
  const editDistance = levenshteinDistance(normalizedQuery, normalizedTarget);
  if (editDistance <= maxEditDistance) {
    const score = 60 - editDistance * 15;
    return {
      matches: true,
      score: Math.max(score, 30),
      matchType: "fuzzy-typo",
      editDistance,
    };
  }

  // 6. Partial similarity via trigrams (for very different strings)
  const trigramScore = trigramSimilarity(normalizedQuery, normalizedTarget);
  if (trigramScore >= minTrigramSimilarity) {
    const score = trigramScore * 50;
    return {
      matches: true,
      score: Math.max(score, 20),
      matchType: "fuzzy-partial",
      trigramScore,
    };
  }

  // No match
  return { matches: false, score: 0, matchType: "none" };
}

/**
 * Search multiple fields with fuzzy matching
 * Returns best match result
 */
export function fuzzyMatchMultiField(
  query: string,
  fields: { text: string; weight?: number }[],
  options: FuzzyMatchOptions = {},
): FuzzyMatchResult {
  let bestResult: FuzzyMatchResult = {
    matches: false,
    score: 0,
    matchType: "none",
  };

  for (const field of fields) {
    const result = fuzzyMatch(query, field.text, options);
    const weight = field.weight || 1.0;
    const weightedScore = result.score * weight;

    if (weightedScore > bestResult.score) {
      bestResult = {
        ...result,
        score: weightedScore,
      };
    }
  }

  return bestResult;
}

/**
 * Filter and rank items using fuzzy search
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  extractText: (item: T) => string | string[],
  options: FuzzyMatchOptions = {},
): Array<T & { _fuzzyScore: number; _matchType: string }> {
  const results: Array<T & { _fuzzyScore: number; _matchType: string }> = [];

  for (const item of items) {
    const texts = extractText(item);
    const textArray = Array.isArray(texts) ? texts : [texts];

    const fields = textArray.map((text) => ({ text, weight: 1.0 }));
    const match = fuzzyMatchMultiField(query, fields, options);

    if (match.matches) {
      results.push({
        ...item,
        _fuzzyScore: match.score,
        _matchType: match.matchType,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b._fuzzyScore - a._fuzzyScore);

  return results;
}
