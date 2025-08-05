import type { StateValidator } from '../core/interfaces';

/**
 * Common state validators
 */

export const stringValidator: StateValidator<string> = {
  validate: (value: any): value is string => typeof value === 'string',
  getErrorMessage: (value: any) => `Expected string, got ${typeof value}`
};

export const numberValidator: StateValidator<number> = {
  validate: (value: any): value is number => typeof value === 'number' && !isNaN(value),
  getErrorMessage: (value: any) => `Expected number, got ${typeof value}`
};

export const booleanValidator: StateValidator<boolean> = {
  validate: (value: any): value is boolean => typeof value === 'boolean',
  getErrorMessage: (value: any) => `Expected boolean, got ${typeof value}`
};

export const arrayValidator: StateValidator<any[]> = {
  validate: (value: any): value is any[] => Array.isArray(value),
  getErrorMessage: (value: any) => `Expected array, got ${typeof value}`
};

export const objectValidator: StateValidator<Record<string, any>> = {
  validate: (value: any): value is Record<string, any> => 
    typeof value === 'object' && value !== null && !Array.isArray(value),
  getErrorMessage: (value: any) => `Expected object, got ${typeof value}`
};

/**
 * Create a validator for required values (non-null, non-undefined)
 */
export function requiredValidator<T>(): StateValidator<T> {
  return {
    validate: (value: any): value is T => value !== null && value !== undefined,
    getErrorMessage: (value: any) => `Value is required but got ${value}`
  };
}

/**
 * Create a validator for minimum/maximum numbers
 */
export function rangeValidator(min?: number, max?: number): StateValidator<number> {
  return {
    validate: (value: any): value is number => {
      if (typeof value !== 'number' || isNaN(value)) return false;
      if (min !== undefined && value < min) return false;
      if (max !== undefined && value > max) return false;
      return true;
    },
    getErrorMessage: (value: any) => {
      if (typeof value !== 'number') return `Expected number, got ${typeof value}`;
      if (min !== undefined && max !== undefined) {
        return `Number must be between ${min} and ${max}, got ${value}`;
      }
      if (min !== undefined) return `Number must be at least ${min}, got ${value}`;
      if (max !== undefined) return `Number must be at most ${max}, got ${value}`;
      return `Invalid number: ${value}`;
    }
  };
}

/**
 * Create a validator for string length
 */
export function lengthValidator(minLength?: number, maxLength?: number): StateValidator<string> {
  return {
    validate: (value: any): value is string => {
      if (typeof value !== 'string') return false;
      if (minLength !== undefined && value.length < minLength) return false;
      if (maxLength !== undefined && value.length > maxLength) return false;
      return true;
    },
    getErrorMessage: (value: any) => {
      if (typeof value !== 'string') return `Expected string, got ${typeof value}`;
      if (minLength !== undefined && maxLength !== undefined) {
        return `String length must be between ${minLength} and ${maxLength}, got ${value.length}`;
      }
      if (minLength !== undefined) return `String must be at least ${minLength} characters, got ${value.length}`;
      if (maxLength !== undefined) return `String must be at most ${maxLength} characters, got ${value.length}`;
      return `Invalid string length: ${value.length}`;
    }
  };
}

/**
 * Create a validator for enum values
 */
export function enumValidator<T extends string | number>(allowedValues: T[]): StateValidator<T> {
  const valueSet = new Set(allowedValues);
  
  return {
    validate: (value: any): value is T => valueSet.has(value),
    getErrorMessage: (value: any) => 
      `Value must be one of [${allowedValues.join(', ')}], got ${value}`
  };
}

/**
 * Create a validator for array items
 */
export function arrayItemValidator<T>(itemValidator: StateValidator<T>): StateValidator<T[]> {
  return {
    validate: (value: any): value is T[] => {
      if (!Array.isArray(value)) return false;
      return value.every(item => itemValidator.validate(item));
    },
    getErrorMessage: (value: any) => {
      if (!Array.isArray(value)) return `Expected array, got ${typeof value}`;
      const invalidIndex = value.findIndex(item => !itemValidator.validate(item));
      if (invalidIndex >= 0) {
        return `Invalid array item at index ${invalidIndex}: ${itemValidator.getErrorMessage(value[invalidIndex])}`;
      }
      return 'Array validation failed';
    }
  };
}

/**
 * Create a validator for object shape
 */
export function shapeValidator<T extends Record<string, any>>(
  shape: { [K in keyof T]: StateValidator<T[K]> }
): StateValidator<T> {
  return {
    validate: (value: any): value is T => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
      }

      for (const [key, validator] of Object.entries(shape)) {
        if (!validator.validate(value[key])) {
          return false;
        }
      }

      return true;
    },
    getErrorMessage: (value: any) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return `Expected object, got ${typeof value}`;
      }

      for (const [key, validator] of Object.entries(shape)) {
        if (!validator.validate(value[key])) {
          return `Invalid property "${key}": ${validator.getErrorMessage(value[key])}`;
        }
      }

      return 'Object validation failed';
    }
  };
}

/**
 * Combine multiple validators with AND logic
 */
export function allOf<T>(...validators: StateValidator<T>[]): StateValidator<T> {
  return {
    validate: (value: any): value is T => 
      validators.every(validator => validator.validate(value)),
    getErrorMessage: (value: any) => {
      const failedValidator = validators.find(validator => !validator.validate(value));
      return failedValidator ? failedValidator.getErrorMessage(value) : 'Validation failed';
    }
  };
}

/**
 * Combine multiple validators with OR logic
 */
export function oneOf<T>(...validators: StateValidator<T>[]): StateValidator<T> {
  return {
    validate: (value: any): value is T => 
      validators.some(validator => validator.validate(value)),
    getErrorMessage: (value: any) => {
      const messages = validators.map(validator => validator.getErrorMessage(value));
      return `Value must satisfy one of: ${messages.join(' OR ')}`;
    }
  };
}

/**
 * Create an optional validator (allows null/undefined)
 */
export function optional<T>(validator: StateValidator<T>): StateValidator<T | null | undefined> {
  return {
    validate: (value: any): value is T | null | undefined => 
      value === null || value === undefined || validator.validate(value),
    getErrorMessage: (value: any) => 
      value === null || value === undefined ? 'Valid optional value' : validator.getErrorMessage(value)
  };
}