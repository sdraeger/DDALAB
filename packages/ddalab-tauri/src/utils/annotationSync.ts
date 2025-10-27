import { PlotAnnotation } from '@/types/annotations';
import { DDAResult } from '@/types/api';

/**
 * Convert time-based position (seconds) to DDA window index
 * This matches the Rust implementation in annotations/mod.rs
 */
export function timeToWindowIndex(
  timeSeconds: number,
  windowStep: number,
  sampleRate: number
): number {
  const sampleIndex = timeSeconds * sampleRate;
  const windowIndex = Math.floor(sampleIndex / windowStep);
  return windowIndex;
}

/**
 * Convert DDA window index to time-based position (seconds)
 * This matches the Rust implementation in annotations/mod.rs
 */
export function windowIndexToTime(
  windowIndex: number,
  windowStep: number,
  sampleRate: number
): number {
  const sampleIndex = windowIndex * windowStep;
  const timeSeconds = sampleIndex / sampleRate;
  return timeSeconds;
}

/**
 * Convert a timeseries annotation to DDA coordinates
 * Returns the annotation with position as the SCALE VALUE (not window index)
 */
export function timeSeriesAnnotationToDDA(
  annotation: PlotAnnotation,
  ddaResult: DDAResult,
  sampleRate: number
): PlotAnnotation {
  const windowStep = ddaResult.parameters.window_step || 1;
  const windowIndex = timeToWindowIndex(annotation.position, windowStep, sampleRate);

  // Get the scale value at this window index
  const scales = ddaResult.results.scales || [];
  const scaleValue = scales[windowIndex];

  // If no valid scale value, return null position (will be filtered out)
  if (scaleValue === undefined) {
    return {
      ...annotation,
      position: -1, // Invalid position
      id: `${annotation.id}_dda`,
    };
  }

  return {
    ...annotation,
    position: scaleValue, // Use scale value, not window index
    id: `${annotation.id}_dda`, // Suffix to avoid ID collision
  };
}

/**
 * Convert a DDA annotation to timeseries coordinates
 * Expects annotation.position to be a SCALE VALUE, converts to seconds
 */
export function ddaAnnotationToTimeSeries(
  annotation: PlotAnnotation,
  ddaResult: DDAResult,
  sampleRate: number
): PlotAnnotation {
  const windowStep = ddaResult.parameters.window_step || 1;

  // Find the nearest window index for this scale value
  const scales = ddaResult.results.scales || [];

  if (scales.length === 0) {
    return {
      ...annotation,
      position: -1,
      id: annotation.id.replace('_dda', ''),
    };
  }

  // Find the index of the closest scale value
  let windowIndex = 0;
  let minDistance = Math.abs(scales[0] - annotation.position);

  for (let i = 1; i < scales.length; i++) {
    const distance = Math.abs(scales[i] - annotation.position);
    if (distance < minDistance) {
      minDistance = distance;
      windowIndex = i;
    }
  }

  const timeSeconds = windowIndexToTime(windowIndex, windowStep, sampleRate);

  return {
    ...annotation,
    position: timeSeconds,
    id: annotation.id.replace('_dda', ''), // Remove suffix if present
  };
}

/**
 * Check if a timeseries annotation falls within a DDA result's time range
 */
export function isAnnotationInDDARange(
  annotation: PlotAnnotation,
  ddaResult: DDAResult
): boolean {
  const startTime = ddaResult.parameters.start_time || 0;
  const endTime = ddaResult.parameters.end_time || Infinity;

  return annotation.position >= startTime && annotation.position <= endTime;
}

/**
 * Check if a DDA annotation (scale value) falls within valid range
 */
export function isDDAAnnotationValid(
  annotation: PlotAnnotation,
  ddaResult: DDAResult
): boolean {
  // Check if this scale value exists in the scales array
  const scales = ddaResult.results.scales || [];
  const scaleIndex = scales.findIndex(s => Math.abs(s - annotation.position) < 0.01);
  return scaleIndex !== -1;
}

/**
 * Get all DDA results that overlap with a given time position
 */
export function findOverlappingDDAResults(
  timePosition: number,
  allResults: DDAResult[]
): DDAResult[] {
  return allResults.filter((result) => {
    const startTime = result.parameters.start_time || 0;
    const endTime = result.parameters.end_time || Infinity;
    return timePosition >= startTime && timePosition <= endTime;
  });
}

/**
 * Sync annotation from timeseries to all applicable DDA results
 * Returns array of DDA annotation keys that should be updated
 */
export function syncTimeSeriesAnnotationToDDA(
  annotation: PlotAnnotation,
  allResults: DDAResult[],
  sampleRate: number
): Array<{ resultId: string; variantId: string; annotation: PlotAnnotation }> {
  const overlappingResults = findOverlappingDDAResults(annotation.position, allResults);
  const synced: Array<{ resultId: string; variantId: string; annotation: PlotAnnotation }> = [];

  for (const result of overlappingResults) {
    if (!isAnnotationInDDARange(annotation, result)) continue;

    const ddaAnnotation = timeSeriesAnnotationToDDA(annotation, result, sampleRate);

    if (!isDDAAnnotationValid(ddaAnnotation, result)) continue;

    // Add for each variant in the result
    for (const variant of result.results.variants) {
      synced.push({
        resultId: result.id,
        variantId: variant.variant_id,
        annotation: ddaAnnotation,
      });
    }
  }

  return synced;
}

/**
 * Sync annotation from DDA to timeseries
 * Returns the converted annotation if valid, null otherwise
 */
export function syncDDAAnnotationToTimeSeries(
  annotation: PlotAnnotation,
  ddaResult: DDAResult,
  sampleRate: number
): PlotAnnotation | null {
  if (!isDDAAnnotationValid(annotation, ddaResult)) {
    return null;
  }

  return ddaAnnotationToTimeSeries(annotation, ddaResult, sampleRate);
}
