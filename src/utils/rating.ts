export function parseRuntimeRatingValue(input: unknown): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : Number.NaN;
  }
  if (typeof input !== 'string') {
    return Number.NaN;
  }

  const trimmed = input.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return Number.NaN;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
