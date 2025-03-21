/**
 * Utility function to get environment variables with validation
 * @param {string} key - Environment variable key
 * @param {string} [defaultValue] - Optional default value
 * @returns {string} - Environment variable value
 * @throws {Error} - If environment variable is not set and no default provided
 */
export function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`Environment variable ${key} is not set in .env.local`);
  }
  return (value ?? defaultValue)!;
}

/**
 * Get a numeric environment variable with validation
 * @param {string} key - Environment variable key
 * @param {number} [defaultValue] - Optional default value
 * @returns {number} - Environment variable value as number
 * @throws {Error} - If environment variable is not set and no default provided or if value is not a valid number
 */
export function getNumericEnvVar(key: string, defaultValue?: number): number {
  const value = getEnvVar(key, defaultValue?.toString());
  const numValue = Number(value);

  if (isNaN(numValue)) {
    throw new Error(
      `Environment variable ${key} must be a valid number, got: ${value}`
    );
  }

  return numValue;
}

/**
 * Get a boolean environment variable with validation
 * @param {string} key - Environment variable key
 * @param {boolean} [defaultValue] - Optional default value
 * @returns {boolean} - Environment variable value as boolean
 */
export function getBooleanEnvVar(key: string, defaultValue?: boolean): boolean {
  const value = getEnvVar(key, defaultValue?.toString());
  return value.toLowerCase() === "true";
}
