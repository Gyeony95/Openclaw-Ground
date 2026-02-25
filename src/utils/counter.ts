function parseCounterInput(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Number || value instanceof String) {
    return parseCounterInput(value.valueOf());
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const runtimeValue = value as { valueOf?: () => unknown; toString?: () => unknown };
  try {
    const valueOf = runtimeValue.valueOf;
    if (typeof valueOf === 'function') {
      const unboxed = valueOf.call(value);
      const parsed = parseCounterInput(unboxed);
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch {
    // Fall through to toString for bridged runtime objects with broken valueOf.
  }
  try {
    const toString = runtimeValue.toString;
    if (typeof toString === 'function') {
      return parseCounterInput(toString.call(value));
    }
  } catch {
    return null;
  }
  return null;
}

export function formatCounterDisplay(value: unknown): string {
  const parsed = parseCounterInput(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    return '--';
  }
  const normalized = Math.floor(parsed);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return '--';
  }
  return normalized.toLocaleString();
}
