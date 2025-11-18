/**
 * Time formatting utilities for converting between seconds, DHMS format, and data points
 */

export interface DHMSTime {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Convert seconds to DHMS (Days, Hours, Minutes, Seconds) format
 */
export function secondsToDHMS(totalSeconds: number): DHMSTime {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { days, hours, minutes, seconds };
}

/**
 * Convert DHMS format to total seconds
 */
export function dhmsToSeconds(dhms: DHMSTime): number {
  return (
    dhms.days * 86400 + dhms.hours * 3600 + dhms.minutes * 60 + dhms.seconds
  );
}

/**
 * Format seconds as a compact DHMS string
 * Examples:
 * - 45s → "45s"
 * - 125s → "2m 5s"
 * - 3725s → "1h 2m 5s"
 * - 90125s → "1d 1h 2m 5s"
 *
 * @param totalSeconds - Time value in seconds
 * @param options - Formatting options
 * @param options.compact - Use compact format with spaces (default: true)
 * @param options.showZeroValues - Show zero values for all units (default: false)
 * @param options.precision - Decimal places for seconds component (default: 0, recommended: 4)
 */
export function formatSecondsToDHMS(
  totalSeconds: number,
  options?: {
    compact?: boolean;
    showZeroValues?: boolean;
    precision?: number;
  },
): string {
  const {
    compact = true,
    showZeroValues = false,
    precision = 0,
  } = options || {};

  const dhms = secondsToDHMS(totalSeconds);
  const parts: string[] = [];

  if (dhms.days > 0 || showZeroValues) {
    parts.push(`${dhms.days}d`);
  }
  if (dhms.hours > 0 || (showZeroValues && parts.length > 0)) {
    parts.push(`${dhms.hours}h`);
  }
  if (dhms.minutes > 0 || (showZeroValues && parts.length > 0)) {
    parts.push(`${dhms.minutes}m`);
  }

  // Always show seconds (with optional decimal precision)
  const secondsStr =
    precision > 0
      ? dhms.seconds.toFixed(precision)
      : Math.floor(dhms.seconds).toString();
  parts.push(`${secondsStr}s`);

  return compact ? parts.join(" ") : parts.join(", ");
}

/**
 * Parse a DHMS string back to seconds
 * Supports formats like: "1d 2h 30m 45s", "2h 30m", "45s", etc.
 */
export function parseDHMSToSeconds(dhmsStr: string): number {
  const regex = /(\d+(?:\.\d+)?)\s*([dhms])/gi;
  let totalSeconds = 0;
  let match;

  while ((match = regex.exec(dhmsStr)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case "d":
        totalSeconds += value * 86400;
        break;
      case "h":
        totalSeconds += value * 3600;
        break;
      case "m":
        totalSeconds += value * 60;
        break;
      case "s":
        totalSeconds += value;
        break;
    }
  }

  return totalSeconds;
}

/**
 * Convert data points to seconds
 */
export function dataPointsToSeconds(
  dataPoints: number,
  sampleRate: number,
): number {
  return dataPoints / sampleRate;
}

/**
 * Convert seconds to data points
 */
export function secondsToDataPoints(
  seconds: number,
  sampleRate: number,
): number {
  return Math.floor(seconds * sampleRate);
}

/**
 * Format data points as a human-readable string with sample rate context
 */
export function formatDataPoints(
  dataPoints: number,
  sampleRate: number,
): string {
  const seconds = dataPointsToSeconds(dataPoints, sampleRate);
  return `${dataPoints.toLocaleString()} pts (${formatSecondsToDHMS(seconds)})`;
}
