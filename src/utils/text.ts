export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeBoundedText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return collapseWhitespace(value).slice(0, maxLength);
}

export function normalizeOptionalBoundedText(value: unknown, maxLength: number): string | undefined {
  const normalized = normalizeBoundedText(value, maxLength);
  return normalized.length > 0 ? normalized : undefined;
}
