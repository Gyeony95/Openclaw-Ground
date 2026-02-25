import { isIsoDateTime } from './time';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW_THRESHOLD_MS = 60 * 1000;

function parseIso(iso: unknown): number | null {
  const fromObjectValue = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    try {
      const valueOf = (value as { valueOf?: () => unknown }).valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(value);
        if (typeof unboxed === 'string') {
          return unboxed;
        }
        if (typeof unboxed === 'number' && Number.isFinite(unboxed)) {
          return new Date(unboxed).toISOString();
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  const normalizedInput = (() => {
    if (typeof iso === 'string') {
      return iso;
    }
    if (iso instanceof String) {
      return iso.valueOf();
    }
    if (iso instanceof Number) {
      const value = iso.valueOf();
      if (!Number.isFinite(value)) {
        return undefined;
      }
      try {
        return new Date(value).toISOString();
      } catch {
        return undefined;
      }
    }
    if (typeof iso === 'number') {
      if (!Number.isFinite(iso)) {
        return undefined;
      }
      try {
        return new Date(iso).toISOString();
      } catch {
        return undefined;
      }
    }
    if (iso instanceof Date) {
      const ms = iso.getTime();
      if (!Number.isFinite(ms)) {
        return undefined;
      }
      try {
        return new Date(ms).toISOString();
      } catch {
        return undefined;
      }
    }
    return fromObjectValue(iso);
  })();
  if (typeof normalizedInput !== 'string') {
    return null;
  }
  const normalized = normalizedInput.trim();
  if (!isIsoDateTime(normalized)) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatDueLabel(dueAt: string, clockIso: string): string {
  const dueMs = parseIso(dueAt);
  const nowMs = parseIso(clockIso);
  if (dueMs === null || nowMs === null) {
    return 'Needs schedule repair';
  }

  const deltaMs = dueMs - nowMs;
  const overdueMs = Math.abs(deltaMs);
  if (overdueMs <= NOW_THRESHOLD_MS) {
    return 'Due now';
  }
  if (deltaMs < 0 && overdueMs < HOUR_MS) {
    return `Overdue ${Math.max(1, Math.floor(overdueMs / MINUTE_MS))}m`;
  }
  if (deltaMs < 0 && overdueMs < DAY_MS) {
    return `Overdue ${Math.max(1, Math.floor(overdueMs / HOUR_MS))}h`;
  }
  if (deltaMs <= -DAY_MS) {
    return `Overdue ${Math.max(1, Math.floor(overdueMs / DAY_MS))}d`;
  }
  if (deltaMs < HOUR_MS) {
    return `Due in ${Math.max(1, Math.floor(deltaMs / MINUTE_MS))}m`;
  }
  if (deltaMs < DAY_MS) {
    return `Due in ${Math.max(1, Math.floor(deltaMs / HOUR_MS))}h`;
  }
  return `Due in ${Math.max(1, Math.floor(deltaMs / DAY_MS))}d`;
}
