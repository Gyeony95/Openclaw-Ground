import { isIsoDateTime } from './time';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NOW_THRESHOLD_MS = 60 * 1000;

function safeIsoFromMs(ms: number): string | undefined {
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

function parseIso(iso: unknown): number | null {
  const fromObjectValue = (value: unknown): string | undefined => {
    const normalizeCandidate = (candidate: unknown): string | undefined => {
      if (typeof candidate === 'string') {
        return candidate;
      }
      if (candidate instanceof String) {
        return candidate.valueOf();
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return safeIsoFromMs(candidate);
      }
      if (candidate instanceof Number) {
        const numeric = candidate.valueOf();
        return Number.isFinite(numeric) ? safeIsoFromMs(numeric) : undefined;
      }
      if (candidate instanceof Date) {
        const ms = candidate.getTime();
        return safeIsoFromMs(ms);
      }
      return undefined;
    };
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const valueObject = value as { valueOf?: () => unknown; toString?: () => unknown };
    try {
      const valueOf = valueObject.valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(value);
        const normalized = normalizeCandidate(unboxed);
        if (normalized !== undefined) {
          return normalized;
        }
      }
    } catch {
      // Fall through to toString for bridged runtime objects with broken valueOf.
    }
    try {
      const toString = valueObject.toString;
      if (typeof toString === 'function') {
        const stringified = toString.call(value);
        const normalized = normalizeCandidate(stringified);
        if (normalized !== undefined) {
          return normalized;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  const normalizedInput = (() => {
    if (iso instanceof Date) {
      const ms = iso.getTime();
      return safeIsoFromMs(ms);
    }
    if (typeof iso === 'string') {
      return iso;
    }
    if (iso instanceof String) {
      return iso.valueOf();
    }
    if (iso instanceof Number) {
      const value = iso.valueOf();
      return safeIsoFromMs(value);
    }
    if (typeof iso === 'number') {
      return safeIsoFromMs(iso);
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
