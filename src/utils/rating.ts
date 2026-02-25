export const RATING_INTEGER_TOLERANCE = 1e-4;

function unwrapStringOrNumberLike(value: unknown): string | number | null {
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (value instanceof Number) {
    return value.valueOf();
  }
  if (value instanceof String) {
    return value.valueOf();
  }
  return null;
}

function unboxRatingInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }
  const directPrimitive = unwrapStringOrNumberLike(input);
  if (directPrimitive !== null) {
    return directPrimitive;
  }
  if (typeof input === 'object') {
    const objectInput = input as { valueOf?: () => unknown; toString?: () => unknown };
    try {
      const valueOf = objectInput.valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(input);
        const normalizedUnboxed = unwrapStringOrNumberLike(unboxed);
        if (normalizedUnboxed !== null) {
          return normalizedUnboxed;
        }
      }
    } catch {
      // Fall through to toString for bridged runtime objects with broken valueOf.
    }
    try {
      const toString = objectInput.toString;
      if (typeof toString === 'function') {
        const stringified = toString.call(input);
        const normalizedStringified = unwrapStringOrNumberLike(stringified);
        if (normalizedStringified !== null) {
          return normalizedStringified;
        }
      }
    } catch {
      return Number.NaN;
    }
  }
  return input;
}

export function parseRuntimeRatingValue(input: unknown): number {
  const normalized = unboxRatingInput(input);
  if (typeof normalized === 'number') {
    return Number.isFinite(normalized) ? normalized : Number.NaN;
  }
  if (typeof normalized !== 'string') {
    return Number.NaN;
  }

  const trimmed = normalized.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
