const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

function clampMaxLength(maxLength: number): number {
  if (!Number.isFinite(maxLength)) {
    return 0;
  }
  return Math.max(0, Math.floor(maxLength));
}

function normalizeRuntimeText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof String) {
    return value.valueOf();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  try {
    const valueOf = (value as { valueOf?: () => unknown }).valueOf;
    if (typeof valueOf === 'function') {
      const unboxed = valueOf.call(value);
      if (typeof unboxed === 'string') {
        return unboxed;
      }
      if (unboxed instanceof String) {
        return unboxed.valueOf();
      }
    }
  } catch {
    return '';
  }
  return '';
}

export function collapseWhitespace(value: string): string {
  return value.replace(INVISIBLE_CHARACTERS, '').trim().replace(/\s+/g, ' ');
}

export function normalizeBoundedText(value: unknown, maxLength: number): string {
  const normalizedValue = normalizeRuntimeText(value);
  if (normalizedValue.length === 0) {
    return '';
  }
  return collapseWhitespace(normalizedValue).slice(0, clampMaxLength(maxLength));
}

export function normalizeOptionalBoundedText(value: unknown, maxLength: number): string | undefined {
  const normalized = normalizeBoundedText(value, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}
