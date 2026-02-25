import { colors } from '../theme';
import { isIsoDateTime } from './time';
import { formatDueLabel } from './due';

export interface QueueToneInput {
  dueAt?: string;
  clockIso: string;
  loading: boolean;
  hasDueCard: boolean;
  needsRepair: boolean;
  hasPendingRepairs?: boolean;
}

export interface DueUrgencyInput {
  dueAt?: string;
  clockIso: string;
  needsRepair: boolean;
}

function parseIsoOrNaN(value?: unknown): number {
  const fromObjectValue = (input: unknown): string | undefined => {
    if (!input || typeof input !== 'object') {
      return undefined;
    }
    try {
      const valueOf = (input as { valueOf?: () => unknown }).valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(input);
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
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof String) {
      return value.valueOf();
    }
    if (value instanceof Number) {
      const unboxed = value.valueOf();
      if (!Number.isFinite(unboxed)) {
        return undefined;
      }
      try {
        return new Date(unboxed).toISOString();
      } catch {
        return undefined;
      }
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return undefined;
      }
      try {
        return new Date(value).toISOString();
      } catch {
        return undefined;
      }
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      if (!Number.isFinite(ms)) {
        return undefined;
      }
      try {
        return new Date(ms).toISOString();
      } catch {
        return undefined;
      }
    }
    return fromObjectValue(value);
  })();
  if (typeof normalizedInput !== 'string') {
    return Number.NaN;
  }
  const normalized = normalizedInput.trim();
  if (!isIsoDateTime(normalized)) {
    return Number.NaN;
  }
  return Date.parse(normalized);
}

export function queueTone({
  dueAt,
  clockIso,
  loading,
  hasDueCard,
  needsRepair,
  hasPendingRepairs = false,
}: QueueToneInput): string {
  if (loading) {
    return colors.subInk;
  }
  if (!hasDueCard) {
    return hasPendingRepairs ? colors.warn : colors.success;
  }
  if (needsRepair) {
    return colors.warn;
  }
  const dueMs = parseIsoOrNaN(dueAt);
  const nowMs = parseIsoOrNaN(clockIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return colors.warn;
  }
  const deltaMs = dueMs - nowMs;
  if (deltaMs < -60 * 1000) {
    return colors.danger;
  }
  if (deltaMs <= 60 * 1000) {
    return colors.primary;
  }
  if (deltaMs <= 60 * 60 * 1000) {
    return colors.warn;
  }
  return colors.success;
}

export function dueUrgency({ dueAt, clockIso, needsRepair }: DueUrgencyInput): { label: string; tone: string } {
  if (needsRepair) {
    return { label: 'Needs repair', tone: colors.warn };
  }
  if (!dueAt) {
    return { label: 'Needs repair', tone: colors.warn };
  }
  const dueMs = parseIsoOrNaN(dueAt);
  const nowMs = parseIsoOrNaN(clockIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return { label: 'Needs repair', tone: colors.warn };
  }
  const label = formatDueLabel(dueAt, clockIso);
  const deltaMs = dueMs - nowMs;
  if (deltaMs <= 60 * 1000 && deltaMs >= -60 * 1000) {
    return { label, tone: colors.primary };
  }
  if (deltaMs < -60 * 1000) {
    return { label, tone: colors.danger };
  }
  if (deltaMs <= 60 * 60 * 1000) {
    return { label, tone: colors.warn };
  }
  return { label, tone: colors.success };
}
