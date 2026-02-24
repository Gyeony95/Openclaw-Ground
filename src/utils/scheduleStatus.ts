import { colors } from '../theme';

export interface QueueToneInput {
  dueAt?: string;
  clockIso: string;
  loading: boolean;
  hasDueCard: boolean;
  needsRepair: boolean;
}

export interface DueUrgencyInput {
  dueAt?: string;
  clockIso: string;
  needsRepair: boolean;
}

export function queueTone({
  dueAt,
  clockIso,
  loading,
  hasDueCard,
  needsRepair,
}: QueueToneInput): string {
  if (loading) {
    return colors.subInk;
  }
  if (!hasDueCard) {
    return colors.success;
  }
  if (needsRepair) {
    return colors.warn;
  }
  const dueMs = dueAt ? Date.parse(dueAt) : Number.NaN;
  const nowMs = Date.parse(clockIso);
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
  return colors.primary;
}

export function dueUrgency({ dueAt, clockIso, needsRepair }: DueUrgencyInput): { label: string; tone: string } {
  if (needsRepair) {
    return { label: 'Needs repair', tone: colors.warn };
  }
  if (!dueAt) {
    return { label: 'Schedule pending', tone: colors.warn };
  }
  const dueMs = Date.parse(dueAt);
  const nowMs = Date.parse(clockIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return { label: 'Needs repair', tone: colors.warn };
  }
  const deltaMs = dueMs - nowMs;
  if (deltaMs <= 60 * 1000 && deltaMs >= -60 * 1000) {
    return { label: 'Due now', tone: colors.primary };
  }
  if (deltaMs < -60 * 1000) {
    return { label: 'Overdue', tone: colors.danger };
  }
  if (deltaMs <= 60 * 60 * 1000) {
    return { label: 'Due soon', tone: colors.warn };
  }
  return { label: 'On track', tone: colors.success };
}
