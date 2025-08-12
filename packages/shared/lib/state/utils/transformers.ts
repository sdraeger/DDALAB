import type { StateTransformer, StateValue } from "../core/interfaces";

/**
 * Common state transformers for serialization/deserialization
 */

/**
 * Identity transformer (no transformation)
 */
export const identityTransformer: StateTransformer = {
  serialize: (value: any) => value,
  deserialize: (value: any) => value,
};

/**
 * Date transformer for Date objects
 */
export const dateTransformer: StateTransformer<Date, string> = {
  serialize: (date: Date) => date.toISOString(),
  deserialize: (isoString: string) => new Date(isoString),
};

/**
 * Set transformer for Set objects
 */
export const setTransformer: StateTransformer<Set<any>, any[]> = {
  serialize: (set: Set<any>) => Array.from(set),
  deserialize: (array: any[]) => new Set(array),
};

/**
 * Map transformer for Map objects
 */
export const mapTransformer: StateTransformer<
  Map<any, any>,
  Array<[any, any]>
> = {
  serialize: (map: Map<any, any>) => Array.from(map.entries()),
  deserialize: (entries: Array<[any, any]>) => new Map(entries),
};

/**
 * BigInt transformer for BigInt values
 */
export const bigIntTransformer: StateTransformer<bigint, string> = {
  serialize: (value: bigint) => value.toString(),
  deserialize: (str: string) => BigInt(str),
};

/**
 * RegExp transformer for regular expressions
 */
export const regExpTransformer: StateTransformer<
  RegExp,
  { source: string; flags: string }
> = {
  serialize: (regex: RegExp) => ({
    source: regex.source,
    flags: regex.flags,
  }),
  deserialize: (obj: { source: string; flags: string }) =>
    new RegExp(obj.source, obj.flags),
};

/**
 * Create a transformer for custom classes
 */
export function classTransformer<T>(
  className: string,
  constructor: new (...args: any[]) => T,
  serializer: (instance: T) => any,
  deserializer: (data: any) => T
): StateTransformer<T, { __className: string; data: any }> {
  return {
    serialize: (instance: T) => ({
      __className: className,
      data: serializer(instance),
    }),
    deserialize: (obj: { __className: string; data: any }) => {
      if (obj.__className !== className) {
        throw new Error(`Expected class ${className}, got ${obj.__className}`);
      }
      return deserializer(obj.data);
    },
  };
}

/**
 * Create a compression transformer using JSON
 */
export function compressionTransformer<T>(): StateTransformer<T, string> {
  return {
    serialize: (value: T) => {
      try {
        return JSON.stringify(value);
      } catch (error) {
        console.error("Compression serialization failed:", error);
        throw error;
      }
    },
    deserialize: (json: string) => {
      try {
        return JSON.parse(json) as T;
      } catch (error) {
        console.error("Compression deserialization failed:", error);
        throw error;
      }
    },
  };
}

/**
 * Create an encryption transformer (simple example)
 * Note: This is a basic example. Use proper encryption libraries for production.
 */
export function encryptionTransformer<T>(
  encryptFn: (data: string) => string,
  decryptFn: (encrypted: string) => string
): StateTransformer<T, string> {
  return {
    serialize: (value: T) => {
      try {
        const json = JSON.stringify(value);
        return encryptFn(json);
      } catch (error) {
        console.error("Encryption serialization failed:", error);
        throw error;
      }
    },
    deserialize: (encrypted: string) => {
      try {
        const json = decryptFn(encrypted);
        return JSON.parse(json) as T;
      } catch (error) {
        console.error("Encryption deserialization failed:", error);
        throw error;
      }
    },
  };
}

/**
 * Create a versioned transformer for schema migration
 */
export function versionedTransformer<T>(
  currentVersion: number,
  migrations: Record<number, (data: any) => any>
): StateTransformer<T, { version: number; data: any }> {
  return {
    serialize: (value: T) => ({
      version: currentVersion,
      data: value,
    }),
    deserialize: (obj: { version: number; data: any }) => {
      let { version, data } = obj;

      // Apply migrations if needed
      while (version < currentVersion) {
        const migration = migrations[version];
        if (!migration) {
          throw new Error(`No migration found for version ${version}`);
        }
        data = migration(data);
        version++;
      }

      if (version > currentVersion) {
        throw new Error(
          `Data version ${version} is newer than current version ${currentVersion}`
        );
      }

      return data as T;
    },
  };
}

/**
 * Create a deep clone transformer to prevent reference sharing
 */
export function deepCloneTransformer<T>(): StateTransformer<T, T> {
  return {
    serialize: (value: T) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (error) {
        console.warn(
          "Deep clone serialization failed, using original value:",
          error
        );
        return value;
      }
    },
    deserialize: (value: T) => {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (error) {
        console.warn(
          "Deep clone deserialization failed, using original value:",
          error
        );
        return value;
      }
    },
  };
}

/**
 * Compose multiple transformers into one
 */
export function composeTransformers<TInput, TIntermediate, TOutput>(
  first: StateTransformer<TInput, TIntermediate>,
  second: StateTransformer<TIntermediate, TOutput>
): StateTransformer<TInput, TOutput> {
  return {
    serialize: (value: TInput) => second.serialize(first.serialize(value)),
    deserialize: (value: TOutput) =>
      first.deserialize(second.deserialize(value)),
  };
}

/**
 * Create a conditional transformer that applies transformation based on a predicate
 */
export function conditionalTransformer<T extends StateValue>(
  predicate: (value: T) => boolean,
  transformer: StateTransformer<T>,
  fallback?: StateTransformer<T>
): StateTransformer<T> {
  const defaultFallback: StateTransformer<T> = {
    serialize: (value: T) => value as T,
    deserialize: (value: T) => value,
  };

  const activeFallback = fallback || defaultFallback;

  return {
    serialize: (value: T) => {
      const activeTransformer = predicate(value) ? transformer : activeFallback;
      return activeTransformer.serialize(value);
    },
    deserialize: (value: any) => {
      // For deserialization, we might need to store which transformer was used
      // This is a simplified version - a full implementation would need metadata
      try {
        return transformer.deserialize(value);
      } catch {
        return activeFallback.deserialize(value);
      }
    },
  };
}
