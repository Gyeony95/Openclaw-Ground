const INVISIBLE_CHARACTERS = /[\u200B-\u200D\uFEFF]/g;

function clampMaxLength(maxLength: number): number {
  if (!Number.isFinite(maxLength)) {
    return 0;
  }
  return Math.max(0, Math.floor(maxLength));
}

export function collapseWhitespace(value: string): string {
  return value.replace(INVISIBLE_CHARACTERS, '').trim().replace(/\s+/g, ' ');
}

export function normalizeBoundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return collapseWhitespace(value).slice(0, clampMaxLength(maxLength));
}

export function normalizeOptionalBoundedText(value: unknown, maxLength: number): string | undefined {
  const normalized = normalizeBoundedText(value, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}
