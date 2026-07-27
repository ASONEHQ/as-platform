import {
  SettingValidationError,
  type SettingDefinition,
  type SettingValue,
  type SettingValueType,
} from './settings.types.js';

type ValueNormalizer = (key: string, value: unknown) => SettingValue;

function validationError(key: string, rule: string, message: string): never {
  throw new SettingValidationError(key, rule, message);
}

function stringValue(key: string, value: unknown): string {
  if (typeof value !== 'string')
    validationError(key, 'type', 'The setting value must be a string.');
  return value;
}

export function trimmedString(options: {
  readonly minimum?: number;
  readonly maximum: number;
}): ValueNormalizer {
  return (key, value) => {
    const normalized = stringValue(key, value).trim();
    if (options.minimum !== undefined && normalized.length < options.minimum)
      validationError(
        key,
        'minimum_length',
        `The setting value must contain at least ${String(options.minimum)} characters.`,
      );
    if (normalized.length > options.maximum)
      validationError(
        key,
        'maximum_length',
        `The setting value must contain at most ${String(options.maximum)} characters.`,
      );
    return normalized;
  };
}

export function boundedString(maximum: number): ValueNormalizer {
  return (key, value) => {
    const normalized = stringValue(key, value);
    if (normalized.length > maximum)
      validationError(
        key,
        'maximum_length',
        `The setting value must contain at most ${String(maximum)} characters.`,
      );
    return normalized;
  };
}

export function allowedString(
  allowed: readonly string[],
  transform: (value: string) => string = (value) => value.trim(),
): ValueNormalizer {
  return (key, value) => {
    const normalized = transform(stringValue(key, value));
    if (!allowed.includes(normalized))
      validationError(key, 'allowlist', 'The setting value is not in the approved allowlist.');
    return normalized;
  };
}

export const booleanValue: ValueNormalizer = (key, value) => {
  if (typeof value !== 'boolean')
    validationError(key, 'type', 'The setting value must be a boolean.');
  return value;
};

export function boundedInteger(minimum: number, maximum: number): ValueNormalizer {
  return (key, value) => {
    if (typeof value !== 'number' || !Number.isInteger(value))
      validationError(key, 'type', 'The setting value must be an integer.');
    if (value < minimum || value > maximum)
      validationError(
        key,
        'range',
        `The setting value must be between ${String(minimum)} and ${String(maximum)}.`,
      );
    return value;
  };
}

export const timeOfDay: ValueNormalizer = (key, value) => {
  const normalized = stringValue(key, value).trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(normalized))
    validationError(key, 'time_format', 'The setting value must use 24-hour HH:mm format.');
  return normalized;
};

export const ianaTimezone: ValueNormalizer = (key, value) => {
  const normalized = stringValue(key, value).trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    validationError(key, 'iana_timezone', 'The setting value must be a valid IANA timezone.');
  }
  return normalized;
};

export function validateSettingValue(
  definition: SettingDefinition,
  valueType: SettingValueType,
  value: unknown,
): SettingValue {
  if (valueType !== definition.type)
    validationError(
      definition.key,
      'value_type',
      'The declared value type does not match the catalog.',
    );
  return definition.normalize(value);
}
