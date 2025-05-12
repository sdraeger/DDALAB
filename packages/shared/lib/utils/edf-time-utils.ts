/**
 * Converts a time value (in seconds) to a sample index based on the sample rate.
 * @param timeInSeconds The time in seconds.
 * @param sampleRate The sample rate in Hz.
 * @returns The corresponding sample index (integer).
 */
export function convertTimeToSamples(
  timeInSeconds: number,
  sampleRate: number
): number {
  if (sampleRate <= 0) {
    console.warn("convertTimeToSamples: Sample rate must be positive.");
    return Math.floor(timeInSeconds);
  }
  return Math.floor(timeInSeconds * sampleRate);
}

/**
 * Formats an EDF date object (or parts) into a string.
 * EDF typically stores date and time separately.
 * This is a placeholder and might need more specific EDF date object structure.
 * @param edfDate Parts of an EDF date (e.g., { year, month, day, hour, minute, second }).
 * @returns A formatted date-time string.
 */
export function formatEDFDate(edfDate: {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}): string {
  const year =
    edfDate.year !== undefined ? String(edfDate.year).padStart(2, "0") : "YY"; // EDF years are often 2 digits
  const month =
    edfDate.month !== undefined ? String(edfDate.month).padStart(2, "0") : "MM";
  const day =
    edfDate.day !== undefined ? String(edfDate.day).padStart(2, "0") : "DD";
  const hour =
    edfDate.hour !== undefined ? String(edfDate.hour).padStart(2, "0") : "hh";
  const minute =
    edfDate.minute !== undefined
      ? String(edfDate.minute).padStart(2, "0")
      : "mm";
  const second =
    edfDate.second !== undefined
      ? String(edfDate.second).padStart(2, "0")
      : "ss";

  // Example format: DD.MM.YY hh:mm:ss
  // Adjust format as per actual EDF library or requirements
  return `${day}.${month}.${year} ${hour}:${minute}:${second}`;
}

// Example of a more specific EDF start time formatting if you have year, and time as a decimal
/*
export function formatEDFStartTime(startDate: string, startTime: string): string {
  // EDF startDate is 'DD.MM.YY' and startTime is 'HH.MM.SS'
  // This function would reformat them or combine them as needed.
  // For example, to create a JavaScript Date object or a standardized string.
  try {
    const [day, month, yearSuffix] = startDate.split('.').map(Number);
    const [hour, minute, second] = startTime.split('.').map(Number);

    // Assuming yearSuffix < 70 means 20xx, otherwise 19xx (common for 2-digit years)
    const year = yearSuffix < 70 ? 2000 + yearSuffix : 1900 + yearSuffix;

    // JavaScript Date months are 0-indexed
    const dateObj = new Date(year, month - 1, day, hour, minute, second);
    return dateObj.toLocaleString(); // Or any other desired format
  } catch (e) {
    console.error('Error formatting EDF start time:', e);
    return `${startDate} ${startTime}`;
  }
}
*/
