import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import {
  MEANING_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  REVIEW_STABILITY_OUTLIER_MULTIPLIER,
  STABILITY_MAX,
  STABILITY_MIN,
  WORD_MAX_LENGTH,
} from './scheduler/constants';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, DeckStats, Rating } from './types';
import { isDue, isIsoDateTime, nowIso } from './utils/time';
import { normalizeBoundedText } from './utils/text';

const CLOCK_REFRESH_MS = 15000;
const MAX_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const MAX_UI_FUTURE_SKEW_MS = 60 * 1000;
const OVERDUE_GRACE_MS = 60 * 1000;
const TIMELINE_JITTER_TOLERANCE_MS = 1000;
const FALLBACK_NOW_MS = Date.parse('1970-01-01T00:00:00.000Z');
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_MIN_SCHEDULE_MS = 60 * 1000;
const RELEARNING_MIN_SCHEDULE_MS = 10 * 60 * 1000;
const REVIEW_MIN_SCHEDULE_MS = 0.5 * DAY_MS;
const LEARNING_MAX_SCHEDULE_MS = DAY_MS;
const RELEARNING_MAX_SCHEDULE_MS = 2 * DAY_MS;
const MAX_UPCOMING_HOURS = 24 * 365 * 20;
const COUNTER_INTEGER_TOLERANCE = 1e-6;

function safeReadUnknown(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safeReadString(read: () => unknown, fallback = ''): string {
  try {
    const value = read();
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof String) {
      return value.valueOf();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function parseTimeOrRepairPriority(iso: string): number {
  const parsed = parseTimeOrNaN(iso);
  // Invalid timeline anchors should be prioritized for immediate repair.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function parseDueTimeForSort(iso: string): number {
  const parsed = parseTimeOrNaN(iso);
  // Invalid schedules are actionable repair targets, so keep them at the front of due queues.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function normalizeCardIdForSort(id: unknown): string {
  if (typeof id !== 'string') {
    return '';
  }
  return id.trim();
}

function compareCardIdSortTokens(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareSortPriority(left: number, right: number): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isValidCardId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

function normalizeCardIdInput(id: unknown): string | null {
  if (!isValidCardId(id)) {
    return null;
  }
  return id.trim();
}

function normalizeCardIdForMatch(id: unknown): string | null {
  return normalizeCardIdInput(id);
}

function normalizeCardIdForMerge(id: unknown): string | null {
  return normalizeCardIdInput(id);
}

function isRuntimeCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Card>;
  const id = safeReadUnknown(() => candidate.id);
  const word = safeReadUnknown(() => candidate.word);
  const meaning = safeReadUnknown(() => candidate.meaning);
  const state = safeReadUnknown(() => candidate.state);
  const createdAt = safeReadUnknown(() => candidate.createdAt);
  const updatedAt = safeReadUnknown(() => candidate.updatedAt);
  const dueAt = safeReadUnknown(() => candidate.dueAt);
  return (
    isValidCardId(id) &&
    typeof word === 'string' &&
    typeof meaning === 'string' &&
    typeof state === 'string' &&
    typeof createdAt === 'string' &&
    typeof updatedAt === 'string' &&
    typeof dueAt === 'string'
  );
}

function isRuntimeCardTimelineCandidate(
  value: unknown,
): value is Pick<Card, 'id' | 'word' | 'meaning' | 'state' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Card, 'dueAt' | 'stability' | 'reps' | 'lapses'>> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Card>;
  const id = safeReadUnknown(() => candidate.id);
  const word = safeReadUnknown(() => candidate.word);
  const meaning = safeReadUnknown(() => candidate.meaning);
  const state = safeReadUnknown(() => candidate.state);
  const createdAt = safeReadUnknown(() => candidate.createdAt);
  const updatedAt = safeReadUnknown(() => candidate.updatedAt);
  return (
    isValidCardId(id) &&
    typeof word === 'string' &&
    typeof meaning === 'string' &&
    typeof state === 'string' &&
    typeof createdAt === 'string' &&
    typeof updatedAt === 'string'
  );
}

function parseTimeOrNaN(iso: string): number {
  const normalized = normalizeIsoInput(iso);
  if (!normalized || !isIsoDateTime(normalized)) {
    return Number.NaN;
  }
  return Date.parse(normalized);
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  return Number.isFinite(runtimeNow) ? runtimeNow : Number.NaN;
}

function toSafeIso(ms: number): string {
  const safeMs = Number.isFinite(ms)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, ms))
    : FALLBACK_NOW_MS;
  return new Date(safeMs).toISOString();
}

function isMaxIsoBound(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MAX_DATE_MS;
}

function parseDueAtOrNaN(dueAt: unknown): number {
  if (typeof dueAt !== 'string') {
    return Number.NaN;
  }
  return parseTimeOrNaN(dueAt);
}

function parseRuntimeFiniteNumber(value: unknown): number | null {
  const normalizedValue = (() => {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value !== 'object') {
      return value;
    }
    try {
      const valueOf = (value as { valueOf?: () => unknown }).valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(value);
        if (typeof unboxed === 'number' || typeof unboxed === 'string') {
          return unboxed;
        }
      }
    } catch {
      return null;
    }
    return value;
  })();

  if (typeof normalizedValue === 'number') {
    if (Number.isFinite(normalizedValue)) {
      return normalizedValue;
    }
    if (normalizedValue === Number.POSITIVE_INFINITY || normalizedValue === Number.NEGATIVE_INFINITY) {
      return normalizedValue;
    }
    return null;
  }
  if (typeof normalizedValue !== 'string') {
    return null;
  }
  const trimmed = normalizedValue.trim();
  const lowered = trimmed.toLowerCase();
  if (lowered === 'infinity' || lowered === '+infinity' || lowered === 'inf' || lowered === '+inf') {
    return Number.POSITIVE_INFINITY;
  }
  if (lowered === '-infinity' || lowered === '-inf') {
    return Number.NEGATIVE_INFINITY;
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  if (parsed === Number.POSITIVE_INFINITY || parsed === Number.NEGATIVE_INFINITY) {
    return parsed;
  }
  return null;
}

function normalizeNonNegativeCounter(value: unknown): number | null {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'infinity' || trimmed === '+infinity') {
      return Number.MAX_SAFE_INTEGER;
    }
    if (trimmed === '-infinity') {
      return null;
    }
  }
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === null) {
    return null;
  }
  if (parsed === Number.POSITIVE_INFINITY) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (parsed === Number.NEGATIVE_INFINITY) {
    return null;
  }
  if (parsed < 0) {
    return null;
  }
  const rounded = Math.round(parsed);
  return Math.abs(parsed - rounded) <= COUNTER_INTEGER_TOLERANCE ? rounded : Math.floor(parsed);
}

function isWholeNonNegativeCounter(value: unknown): boolean {
  if (value === Number.POSITIVE_INFINITY) {
    return false;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'infinity' || trimmed === '+infinity' || trimmed === '-infinity') {
      return false;
    }
  }
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === null || parsed < 0) {
    return false;
  }
  return Math.abs(parsed - Math.round(parsed)) <= COUNTER_INTEGER_TOLERANCE;
}

function normalizeReviewState(value: unknown): Card['state'] | null {
  if (value === 'review' || value === 'relearning' || value === 'learning') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'rev') {
    return 'review';
  }
  const folded = normalized.replace(/[\s_-]+/g, '');
  if (folded === 'review') {
    return 'review';
  }
  if (folded === 'rev') {
    return 'review';
  }
  if (folded === 'learning' || folded === 'learn') {
    return 'learning';
  }
  if (folded === 'relearning' || folded === 'relearn') {
    return 'relearning';
  }
  const alphaFolded = normalized.replace(/[^a-z]+/g, '');
  if (alphaFolded === 'review') {
    return 'review';
  }
  if (alphaFolded === 'rev') {
    return 'review';
  }
  if (alphaFolded === 'learning' || alphaFolded === 'learn') {
    return 'learning';
  }
  if (alphaFolded === 'relearning' || alphaFolded === 'relearn') {
    return 'relearning';
  }
  return null;
}

function minScheduleMsForState(state: Card['state']): number {
  if (state === 'review') {
    return REVIEW_MIN_SCHEDULE_MS;
  }
  if (state === 'relearning') {
    return RELEARNING_MIN_SCHEDULE_MS;
  }
  return LEARNING_MIN_SCHEDULE_MS;
}

function normalizedReviewStabilityDays(stability: unknown): number | null {
  const parsed = parseRuntimeFiniteNumber(stability);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return clamp(parsed, STABILITY_MIN, STABILITY_MAX);
}

function maxScheduleMsBeforeRepair(state: Card['state'], stability: unknown): number {
  if (state === 'learning') {
    return LEARNING_MAX_SCHEDULE_MS;
  }
  if (state === 'relearning') {
    return RELEARNING_MAX_SCHEDULE_MS;
  }

  const normalizedStabilityDays = normalizedReviewStabilityDays(stability);
  if (normalizedStabilityDays === null) {
    // Unknown review stability should be repaired conservatively instead of
    // allowing long hidden intervals that may never be reviewed.
    return REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS * DAY_MS;
  }
  const stabilityOutlierWindowDays = Math.max(
    REVIEW_MIN_SCHEDULE_MS / DAY_MS,
    normalizedStabilityDays * REVIEW_STABILITY_OUTLIER_MULTIPLIER,
    REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  );
  const maxReviewDays = Math.min(
    STABILITY_MAX,
    Math.max(REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS, stabilityOutlierWindowDays),
  );
  return maxReviewDays * DAY_MS;
}

export function hasScheduleRepairNeed(
  card: Pick<Card, 'dueAt' | 'updatedAt' | 'state'> & Partial<Pick<Card, 'stability' | 'reps' | 'lapses'>>,
): boolean {
  const dueAt = safeReadString(() => card.dueAt);
  const updatedAt = safeReadString(() => card.updatedAt);
  const stateValue = safeReadUnknown(() => card.state);
  const stabilityValue = safeReadUnknown(() => card.stability);
  const repsValue = safeReadUnknown(() => card.reps);
  const lapsesValue = safeReadUnknown(() => card.lapses);
  const dueMs = parseTimeOrNaN(dueAt);
  const updatedMs = parseTimeOrNaN(updatedAt);
  const wallClockMs = safeNowMs();
  const state = normalizeReviewState(stateValue);
  if (!Number.isFinite(dueMs) || !Number.isFinite(updatedMs)) {
    return true;
  }
  if (!state) {
    return true;
  }
  if (state === 'review' && isMaxIsoBound(dueMs) && isMaxIsoBound(updatedMs)) {
    // Saturated upper-bound review schedules cannot advance beyond the max date
    // and should remain valid instead of being treated as future-skew corruption.
    return false;
  }
  if (Number.isFinite(wallClockMs)) {
    // `dueAt` can legitimately be far in the future for mature review cards.
    // Only treat timeline anchors as corrupted when `updatedAt` itself is future-skewed.
    if (updatedMs - wallClockMs >= MAX_CLOCK_SKEW_MS) {
      return true;
    }
  }
  const dueDeltaFromUpdatedMs = dueMs - updatedMs;
  const dueWithinTimelineJitterTolerance = Math.abs(dueDeltaFromUpdatedMs) <= TIMELINE_JITTER_TOLERANCE_MS;
  const normalizedDueMs = dueWithinTimelineJitterTolerance ? updatedMs : dueMs;
  if (normalizedDueMs < updatedMs) {
    return true;
  }
  if (normalizedDueMs > updatedMs) {
    const scheduleMs = normalizedDueMs - updatedMs;
    const repsProvided = repsValue !== undefined && repsValue !== null;
    const lapsesProvided = lapsesValue !== undefined && lapsesValue !== null;
    const reps = normalizeNonNegativeCounter(repsValue);
    const lapsesMissing = !lapsesProvided;
    const lapses = lapsesMissing ? 0 : normalizeNonNegativeCounter(lapsesValue);
    const countersCorrupted = reps === null || lapses === null;
    const hasReviewHistory = reps !== null && lapses !== null && (reps > 0 || lapses > 0);
    const learningCountersMalformed =
      !isWholeNonNegativeCounter(repsValue) || (lapsesProvided && !isWholeNonNegativeCounter(lapsesValue));
    // Keep queue-side repair checks aligned with scheduler jitter tolerance so
    // valid near-boundary schedules are not repeatedly surfaced as corruption.
    if (scheduleMs + TIMELINE_JITTER_TOLERANCE_MS < minScheduleMsForState(state)) {
      if (state === 'learning') {
        if (countersCorrupted || learningCountersMalformed) {
          return true;
        }
        // Fresh learning cards can arrive with tiny positive drift from runtime/storage jitter.
        // Treat these as due-now equivalents unless counters indicate prior review history.
        return hasReviewHistory;
      }
      return true;
    }
    if (state === 'relearning' && scheduleMs + TIMELINE_JITTER_TOLERANCE_MS >= REVIEW_MIN_SCHEDULE_MS) {
      // Day-like relearning windows indicate phase drift; scheduler inference
      // treats these as review cadence and should be normalized via repair.
      return true;
    }
    if (scheduleMs - TIMELINE_JITTER_TOLERANCE_MS > maxScheduleMsBeforeRepair(state, stabilityValue)) {
      return true;
    }
    if (
      state !== 'learning' &&
      ((repsProvided && reps === null) || (lapsesProvided && lapses === null))
    ) {
      // Non-learning cards with explicitly malformed counters should be normalized
      // before scheduling so FSRS history fields remain trustworthy.
      return true;
    }
    if (state === 'learning' && countersCorrupted) {
      // Corrupted learning counters can mask review history and distort phase
      // inference; always repair before queueing regardless of schedule length.
      return true;
    }
    if (state === 'learning' && learningCountersMalformed) {
      // Learning counters should be whole numbers; fractional drift can hide
      // prior review history and keep phase-repair cards in the active queue.
      return true;
    }
    if (state === 'learning' && hasReviewHistory && scheduleMs >= REVIEW_MIN_SCHEDULE_MS) {
      // Learning steps with review history should remain short; day-like intervals indicate
      // persisted phase drift and should be repaired before queueing.
      return true;
    }
    return false;
  }
  // Brand-new learning cards are legitimately due at creation time; persisted learning cards should move forward.
  if (state !== 'learning') {
    return true;
  }
  const reps = normalizeNonNegativeCounter(repsValue);
  const lapsesRawMissing = lapsesValue === undefined || lapsesValue === null;
  const lapses = lapsesRawMissing ? 0 : normalizeNonNegativeCounter(lapsesValue);
  if (!isWholeNonNegativeCounter(repsValue)) {
    return true;
  }
  if (!lapsesRawMissing && !isWholeNonNegativeCounter(lapsesValue)) {
    return true;
  }
  if (reps === null || lapses === null) {
    return true;
  }
  return reps > 0 || lapses > 0;
}

function isReviewReadyCard(
  card: Pick<Card, 'dueAt' | 'updatedAt' | 'state'> & Partial<Pick<Card, 'stability' | 'reps' | 'lapses'>>,
  currentIso: string,
): boolean {
  if (hasScheduleRepairNeed(card)) {
    return true;
  }
  if (typeof card.dueAt !== 'string') {
    return true;
  }
  const dueMs = parseTimeOrNaN(card.dueAt);
  if (!Number.isFinite(dueMs)) {
    return true;
  }
  const currentMs = parseTimeOrNaN(currentIso);
  if (!Number.isFinite(currentMs)) {
    return isDue(card.dueAt, currentIso);
  }
  // Keep queue/review eligibility tolerant to sub-second clock jitter so
  // near-boundary cards don't flicker between due and not-due states.
  return dueMs - currentMs <= TIMELINE_JITTER_TOLERANCE_MS;
}

function parseTimeOrMin(iso?: string): number {
  const normalized = normalizeIsoInput(iso);
  if (!normalized || !isIsoDateTime(normalized)) {
    return Number.MIN_SAFE_INTEGER;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function normalizeMergeCounter(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.MIN_SAFE_INTEGER;
  }
  if (value < 0) {
    return Number.MIN_SAFE_INTEGER;
  }
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= COUNTER_INTEGER_TOLERANCE ? rounded : Math.floor(value);
}

function normalizeIsoInput(value: unknown): string | undefined {
  const normalizedValue = (() => {
    if (value instanceof Date) {
      const dateMs = value.getTime();
      return Number.isFinite(dateMs) ? toSafeIso(dateMs) : undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? toSafeIso(value) : undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof String) {
      return value.valueOf();
    }
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
          return toSafeIso(unboxed);
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  })();
  if (typeof normalizedValue !== 'string') {
    return undefined;
  }
  const trimmed = normalizedValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isValidIso(value?: string): value is string {
  const normalized = normalizeIsoInput(value);
  return Boolean(normalized && isIsoDateTime(normalized));
}

function toCanonicalIso(value: string): string {
  const normalized = normalizeIsoInput(value);
  if (!normalized) {
    return new Date(FALLBACK_NOW_MS).toISOString();
  }
  return new Date(Date.parse(normalized)).toISOString();
}

function resolveInteractionClock(currentIso: string, runtimeNowIso: string): string {
  if (!isValidIso(currentIso)) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  const currentMs = Date.parse(currentIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();
  const canonicalCurrentIso = toCanonicalIso(currentIso);
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? toCanonicalIso(runtimeNowIso) : undefined;
  if (Number.isFinite(runtimeMs)) {
    const currentTooFarFromRuntime = Math.abs(currentMs - runtimeMs) > MAX_CLOCK_SKEW_MS;
    if (currentTooFarFromRuntime) {
      return resolveReviewClock(currentIso, runtimeNowIso);
    }
    // Keep submission eligibility aligned with queue visibility to avoid showing cards
    // as due while rejecting the same review action in the same render frame.
    return canonicalRuntimeIso ?? canonicalCurrentIso;
  }

  const currentTooFarFromWall =
    Number.isFinite(wallClockMs) && Math.abs(currentMs - wallClockMs) > MAX_CLOCK_SKEW_MS;
  if (currentTooFarFromWall) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  return canonicalCurrentIso;
}

function resolveActionClock(currentIso: string, runtimeNowIso: string): string {
  return resolveInteractionClock(currentIso, runtimeNowIso);
}

function resolveQueueClock(currentIso: string, runtimeNowIso: string): string {
  return resolveInteractionClock(currentIso, runtimeNowIso);
}

function pickFreshestCard(existing: Card, loaded: Card): Card {
  const existingUpdated = parseTimeOrMin(existing.updatedAt);
  const loadedUpdated = parseTimeOrMin(loaded.updatedAt);
  if (loadedUpdated > existingUpdated) {
    return loaded;
  }
  if (loadedUpdated < existingUpdated) {
    return existing;
  }

  // When timestamps tie, prefer the card with more completed review activity.
  const existingReps = normalizeMergeCounter(existing.reps);
  const loadedReps = normalizeMergeCounter(loaded.reps);
  if (loadedReps > existingReps) {
    return loaded;
  }
  if (loadedReps < existingReps) {
    return existing;
  }

  const existingLapses = normalizeMergeCounter(existing.lapses);
  const loadedLapses = normalizeMergeCounter(loaded.lapses);
  if (loadedLapses > existingLapses) {
    return loaded;
  }
  if (loadedLapses < existingLapses) {
    return existing;
  }

  const existingDue = parseTimeOrMin(existing.dueAt);
  const loadedDue = parseTimeOrMin(loaded.dueAt);
  // On full ties, keep the earlier due card to avoid delaying a due review.
  if (loadedDue < existingDue) {
    return loaded;
  }
  if (loadedDue > existingDue) {
    return existing;
  }

  const existingCreated = parseTimeOrMin(existing.createdAt);
  const loadedCreated = parseTimeOrMin(loaded.createdAt);
  if (loadedCreated < existingCreated) {
    return loaded;
  }

  return existing;
}

export function countUpcomingDueCards(
  cards: Card[],
  currentIso: string,
  hours = 24,
  runtimeNowIso = nowIso(),
): number {
  const effectiveCurrentIso = resolveQueueClock(currentIso, runtimeNowIso);
  const nowMs = parseTimeOrNaN(effectiveCurrentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  const normalizedHours = parseRuntimeFiniteNumber(hours);
  if (normalizedHours === null) {
    return 0;
  }
  if (normalizedHours === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  const safeHours =
    normalizedHours === Number.POSITIVE_INFINITY
      ? MAX_UPCOMING_HOURS
      : Math.min(normalizedHours, MAX_UPCOMING_HOURS);
  if (!Number.isFinite(safeHours) || safeHours <= 0) {
    return 0;
  }
  const windowMs = safeHours * 60 * 60 * 1000;
  const cutoffMs = Number.isFinite(windowMs) ? nowMs + windowMs : Number.POSITIVE_INFINITY;

  return cards.filter((card) => {
    if (!isRuntimeCard(card)) {
      return false;
    }
    if (hasScheduleRepairNeed(card)) {
      return false;
    }
    const dueMs = parseDueAtOrNaN(safeReadString(() => card.dueAt));
    // "Upcoming" should represent future workload, excluding cards already due now.
    return Number.isFinite(dueMs) && dueMs > nowMs && dueMs <= cutoffMs;
  }).length;
}

export function findNextUpcomingCard(cards: Card[], currentIso: string, runtimeNowIso = nowIso()): Card | undefined {
  const effectiveCurrentIso = resolveQueueClock(currentIso, runtimeNowIso);
  const nowMs = parseTimeOrNaN(effectiveCurrentIso);
  if (!Number.isFinite(nowMs)) {
    return undefined;
  }

  const upcomingCards = cards
    .filter((card): card is Card => {
      if (!isRuntimeCard(card) || hasScheduleRepairNeed(card)) {
        return false;
      }
      const dueMs = parseDueAtOrNaN(card.dueAt);
      return Number.isFinite(dueMs) && dueMs > nowMs;
    });
  return stableSortCardsByDuePriority(upcomingCards)[0];
}

export function countOverdueCards(cards: Card[], currentIso: string, runtimeNowIso = nowIso()): number {
  const effectiveCurrentIso = isValidIso(currentIso)
    ? resolveQueueClock(currentIso, runtimeNowIso)
    : isValidIso(runtimeNowIso)
      ? resolveQueueClock(runtimeNowIso, runtimeNowIso)
      : currentIso;
  const nowMs = parseTimeOrNaN(effectiveCurrentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  const overdueCutoff = nowMs - OVERDUE_GRACE_MS;

  return cards.filter((card) => {
    if (!isRuntimeCardTimelineCandidate(card)) {
      return false;
    }
    if (hasScheduleRepairNeed(card)) {
      // Keep repair-critical cards visible in overdue metrics.
      return true;
    }
    const dueMs = parseDueAtOrNaN(card.dueAt);
    if (!Number.isFinite(dueMs)) {
      // Keep malformed schedules visible in overdue metrics so repair work stays prominent.
      return true;
    }
    return dueMs <= overdueCutoff;
  }).length;
}

export function countScheduleRepairCards(cards: Card[]): number {
  return cards.filter((card) => !isRuntimeCard(card) || hasScheduleRepairNeed(card)).length;
}

export function compareDueCards(a: Card, b: Card): number {
  const aDueAt = safeReadString(() => a?.dueAt);
  const bDueAt = safeReadString(() => b?.dueAt);
  const aUpdatedAt = safeReadString(() => a?.updatedAt);
  const bUpdatedAt = safeReadString(() => b?.updatedAt);
  const aCreatedAt = safeReadString(() => a?.createdAt);
  const bCreatedAt = safeReadString(() => b?.createdAt);
  const duePriority = compareSortPriority(parseDueTimeForSort(aDueAt), parseDueTimeForSort(bDueAt));
  if (duePriority !== 0) {
    return duePriority;
  }
  const updatedPriority = compareSortPriority(
    parseTimeOrRepairPriority(aUpdatedAt),
    parseTimeOrRepairPriority(bUpdatedAt),
  );
  if (updatedPriority !== 0) {
    return updatedPriority;
  }
  const createdPriority = compareSortPriority(
    parseTimeOrRepairPriority(aCreatedAt),
    parseTimeOrRepairPriority(bCreatedAt),
  );
  if (createdPriority !== 0) {
    return createdPriority;
  }
  const aId = safeReadUnknown(() => a?.id);
  const bId = safeReadUnknown(() => b?.id);
  return compareCardIdSortTokens(normalizeCardIdForSort(aId), normalizeCardIdForSort(bId));
}

function stableSortCardsByDuePriority(cards: Card[]): Card[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const duePriority = compareDueCards(left.card, right.card);
      if (duePriority !== 0) {
        return duePriority;
      }
      return left.index - right.index;
    })
    .map((item) => item.card);
}

export function collectDueCards(cards: Card[], currentIso: string, runtimeNowIso: string): Card[] {
  const effectiveCurrentIso = resolveQueueClock(currentIso, runtimeNowIso);
  const dueCards = cards.filter((card): card is Card => isRuntimeCard(card) && isReviewReadyCard(card, effectiveCurrentIso));
  return stableSortCardsByDuePriority(dueCards);
}

export function mergeDeckCards(existingCards: Card[], loadedCards: Card[]): Card[] {
  if (existingCards.length === 0 && loadedCards.length === 0) {
    return [];
  }

  const mergedById = new Map<string, Card>();
  const order: string[] = [];
  let fallbackMergeSequence = 0;
  const fallbackMergeKey = (source: 'existing' | 'loaded'): string => {
    fallbackMergeSequence += 1;
    return `__merge_${source}_${fallbackMergeSequence}`;
  };

  for (const existing of existingCards) {
    if (!isRuntimeCard(existing)) {
      continue;
    }
    const mergeKey = normalizeCardIdForMerge(existing.id) ?? fallbackMergeKey('existing');
    const current = mergedById.get(mergeKey);
    if (!current) {
      mergedById.set(mergeKey, existing);
      order.push(mergeKey);
      continue;
    }
    mergedById.set(mergeKey, pickFreshestCard(current, existing));
  }

  for (const loaded of loadedCards) {
    if (!isRuntimeCard(loaded)) {
      continue;
    }
    const mergeKey = normalizeCardIdForMerge(loaded.id) ?? fallbackMergeKey('loaded');
    const current = mergedById.get(mergeKey);
    if (!current) {
      mergedById.set(mergeKey, loaded);
      order.push(mergeKey);
      continue;
    }
    mergedById.set(mergeKey, pickFreshestCard(current, loaded));
  }

  return order.map((id) => mergedById.get(id)).filter((card): card is Card => card !== undefined);
}

export function selectLatestReviewedAt(current?: string, incoming?: string): string | undefined {
  const currentValid = isValidIso(current) ? toCanonicalIso(current) : undefined;
  const incomingValid = isValidIso(incoming) ? toCanonicalIso(incoming) : undefined;
  return parseTimeOrMin(incomingValid) > parseTimeOrMin(currentValid) ? incomingValid : currentValid;
}

export function applyDueReview(
  cards: Card[],
  cardId: string,
  rating: Rating,
  currentIso: string,
  runtimeNowIso = nowIso(),
): { cards: Card[]; reviewed: boolean; reviewedAt?: string } {
  const normalizedCardId = normalizeCardIdInput(cardId);
  if (!normalizedCardId) {
    return { cards, reviewed: false };
  }
  const effectiveCurrentIso = resolveActionClock(currentIso, runtimeNowIso);
  const candidateIndices: number[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const candidate = cards[index];
    if (!isRuntimeCard(candidate)) {
      continue;
    }
    const candidateId = normalizeCardIdForMatch(candidate.id);
    if (candidateId !== normalizedCardId || !isReviewReadyCard(candidate, effectiveCurrentIso)) {
      continue;
    }
    candidateIndices.push(index);
  }
  if (candidateIndices.length === 0) {
    return { cards, reviewed: false };
  }
  candidateIndices.sort((a, b) => {
    const priority = compareDueCards(cards[a], cards[b]);
    if (priority !== 0) {
      return priority;
    }
    // Keep duplicate selection deterministic across runtimes when all sort keys tie.
    return a - b;
  });

  for (const targetIndex of candidateIndices) {
    const targetCard = cards[targetIndex];
    if (!isRuntimeCard(targetCard)) {
      continue;
    }

    try {
      const reviewed = reviewCard(targetCard, rating, effectiveCurrentIso).card;
      const nextCards = [...cards];
      nextCards[targetIndex] = reviewed;
      return { cards: nextCards, reviewed: true, reviewedAt: reviewed.updatedAt };
    } catch {
      // Keep trying lower-priority due duplicates when one runtime-corrupted entry throws.
    }
  }

  // Keep the queue stable when all runtime-corrupted candidates throw during scheduling.
  return { cards, reviewed: false };
}

export function applyReviewToDeckState(
  deckState: { cards: Card[]; lastReviewedAt?: string },
  cardId: string,
  rating: Rating,
  currentIso: string,
  runtimeNowIso = nowIso(),
): { deckState: { cards: Card[]; lastReviewedAt?: string }; reviewed: boolean } {
  const next = applyDueReview(deckState.cards, cardId, rating, currentIso, runtimeNowIso);
  if (!next.reviewed) {
    return { deckState, reviewed: false };
  }
  return {
    reviewed: true,
    deckState: {
      cards: next.cards,
      lastReviewedAt: selectLatestReviewedAt(deckState.lastReviewedAt, next.reviewedAt ?? currentIso),
    },
  };
}

export function hasDueCard(cards: Card[], cardId: string, currentIso: string, runtimeNowIso = nowIso()): boolean {
  const normalizedCardId = normalizeCardIdInput(cardId);
  if (!normalizedCardId) {
    return false;
  }
  const effectiveCurrentIso = resolveActionClock(currentIso, runtimeNowIso);
  return cards.some(
    (card) =>
      isRuntimeCard(card) &&
      normalizeCardIdForMatch(card.id) === normalizedCardId &&
      isReviewReadyCard(card, effectiveCurrentIso),
  );
}

export function resolveReviewClock(renderedClockIso: string, runtimeNowIso: string): string {
  const renderedMs = parseTimeOrNaN(renderedClockIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();
  const wallClockIso = toSafeIso(wallClockMs);
  const hasFiniteWallClock = Number.isFinite(wallClockMs);
  const canonicalRenderedIso = Number.isFinite(renderedMs) ? new Date(renderedMs).toISOString() : undefined;
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? new Date(runtimeMs).toISOString() : undefined;
  const runtimeTooFarAheadOfWall =
    hasFiniteWallClock && Number.isFinite(runtimeMs) && runtimeMs - wallClockMs >= MAX_CLOCK_SKEW_MS;
  const runtimeTooFarBehindWall =
    hasFiniteWallClock && Number.isFinite(runtimeMs) && wallClockMs - runtimeMs >= MAX_CLOCK_SKEW_MS;
  const renderedTooFarAheadOfWall =
    hasFiniteWallClock && Number.isFinite(renderedMs) && renderedMs - wallClockMs >= MAX_CLOCK_SKEW_MS;
  const renderedTooFarBehindWall =
    hasFiniteWallClock && Number.isFinite(renderedMs) && wallClockMs - renderedMs >= MAX_CLOCK_SKEW_MS;

  if (Number.isFinite(renderedMs) && Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall || runtimeTooFarBehindWall) {
      if (renderedTooFarAheadOfWall || renderedTooFarBehindWall) {
        return wallClockIso;
      }
      return canonicalRenderedIso ?? wallClockIso;
    }
    if (renderedMs - runtimeMs >= MAX_UI_FUTURE_SKEW_MS) {
      // Keep due queues aligned to runtime time once rendered UI drift exceeds tolerance.
      return canonicalRuntimeIso ?? wallClockIso;
    }
    if (renderedMs - runtimeMs > MAX_CLOCK_SKEW_MS) {
      if (renderedTooFarBehindWall) {
        return wallClockIso;
      }
      if (!renderedTooFarAheadOfWall) {
        return canonicalRenderedIso ?? wallClockIso;
      }
      return canonicalRuntimeIso ?? wallClockIso;
    }
    // Prefer runtime for review actions whenever it is wall-safe so timestamps
    // stay anchored to actual interaction time instead of stale rendered frames.
    return canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall || runtimeTooFarBehindWall) {
      return wallClockIso;
    }
    return canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(renderedMs)) {
    if (renderedTooFarAheadOfWall || renderedTooFarBehindWall) {
      return wallClockIso;
    }
    return canonicalRenderedIso ?? wallClockIso;
  }
  return wallClockIso;
}

export function resolveNextUiClock(currentClockIso: string, reviewedAtIso?: string): string {
  const wallClockMs = safeNowMs();
  const wallClockIso = toSafeIso(wallClockMs);
  const hasFiniteWallClock = Number.isFinite(wallClockMs);
  const normalizeWallSafeIso = (candidate?: string): string | undefined => {
    if (!isValidIso(candidate)) {
      return undefined;
    }
    const candidateMs = Date.parse(candidate);
    if (hasFiniteWallClock) {
      if (candidateMs - wallClockMs >= MAX_UI_FUTURE_SKEW_MS) {
        return undefined;
      }
      if (wallClockMs - candidateMs > MAX_CLOCK_SKEW_MS) {
        return undefined;
      }
    }
    return toCanonicalIso(candidate);
  };

  const wallSafeCurrent = normalizeWallSafeIso(currentClockIso);
  const wallSafeReviewed = normalizeWallSafeIso(reviewedAtIso);
  const resolved = selectLatestReviewedAt(wallSafeCurrent, wallSafeReviewed);
  if (resolved) {
    return resolved;
  }
  return wallClockIso;
}

export function resolveAddCardClock(renderedClockIso: string, runtimeNowIso: string): string {
  const resolved = resolveNextUiClock(renderedClockIso, runtimeNowIso);
  const resolvedMs = parseTimeOrNaN(resolved);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();

  const runtimeSkewMs = Number.isFinite(resolvedMs) && Number.isFinite(runtimeMs) ? resolvedMs - runtimeMs : Number.NaN;
  const runtimeIsPlausiblyCurrent =
    Number.isFinite(runtimeSkewMs) &&
    runtimeSkewMs >= 0 &&
    runtimeSkewMs <= MAX_CLOCK_SKEW_MS;

  if (runtimeIsPlausiblyCurrent && resolvedMs > runtimeMs) {
    // Added cards should not be anchored in the future; keep creation immediately due.
    return toCanonicalIso(runtimeNowIso);
  }

  if (
    Number.isFinite(resolvedMs) &&
    Number.isFinite(wallClockMs) &&
    resolvedMs - wallClockMs > TIMELINE_JITTER_TOLERANCE_MS
  ) {
    // If runtime now is malformed, still avoid creating cards in the future.
    return toSafeIso(wallClockMs);
  }

  return resolved;
}

export function resolveDeckClockTick(previousClockIso: string, runtimeNowIso: string): string {
  return resolveNextUiClock(previousClockIso, runtimeNowIso);
}

export function alignDueNowStatWithQueue(stats: DeckStats, dueCards: Card[]): DeckStats {
  if (stats.dueNow === dueCards.length) {
    return stats;
  }
  return {
    ...stats,
    dueNow: dueCards.length,
  };
}

export function useDeck() {
  const [deckState, setDeckState] = useState<{ cards: Card[]; lastReviewedAt?: string }>({ cards: [] });
  const [loading, setLoading] = useState(true);
  const [canPersist, setCanPersist] = useState(false);
  const [clockIso, setClockIso] = useState(() => resolveDeckClockTick(nowIso(), nowIso()));
  const deckStateRef = useRef(deckState);
  const persistVersionRef = useRef(0);
  const persistInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    deckStateRef.current = deckState;
  }, [deckState]);

  useEffect(() => {
    let active = true;
    loadDeck()
      .then((deck) => {
        if (active) {
          setDeckState((prev) => {
            const next = {
              cards: mergeDeckCards(prev.cards, deck.cards),
              lastReviewedAt: selectLatestReviewedAt(prev.lastReviewedAt, deck.lastReviewedAt),
            };
            deckStateRef.current = next;
            return next;
          });
          setCanPersist(true);
        }
      })
      .catch(() => {
        // Keep in-memory defaults when storage is unavailable.
        // Enable best-effort writes for later user actions if storage recovers.
        setCanPersist(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !canPersist) {
      return;
    }
    persistVersionRef.current += 1;
    const writeVersion = persistVersionRef.current;
    const persist = async () => {
      await saveDeck(deckState);
      if (persistVersionRef.current !== writeVersion) {
        return;
      }
      persistInFlightRef.current = null;
    };

    const run = (persistInFlightRef.current ?? Promise.resolve())
      .catch(() => {
        // Continue queue processing even if a prior write failed.
      })
      .then(persist);

    persistInFlightRef.current = run.catch(() => {
      // Persist errors are non-fatal for in-session usage.
      if (persistVersionRef.current === writeVersion) {
        persistInFlightRef.current = null;
      }
    });
  }, [canPersist, deckState, loading]);

  useEffect(() => {
    const timer = setInterval(() => {
      const runtimeNow = nowIso();
      setClockIso((previousClockIso) => resolveDeckClockTick(previousClockIso, runtimeNow));
    }, CLOCK_REFRESH_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const effectiveClockIso = useMemo(() => resolveReviewClock(clockIso, nowIso()), [clockIso]);

  const dueCards = useMemo(() => {
    const runtimeNow = nowIso();
    // Use the rendered UI clock plus runtime clock so queue visibility never runs ahead of submit eligibility.
    return collectDueCards(deckState.cards, clockIso, runtimeNow);
  }, [clockIso, deckState.cards]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const normalizedWord = normalizeBoundedText(word, WORD_MAX_LENGTH);
    const normalizedMeaning = normalizeBoundedText(meaning, MEANING_MAX_LENGTH);
    const normalizedNotes = normalizeBoundedText(notes, NOTES_MAX_LENGTH);
    if (!normalizedWord || !normalizedMeaning) {
      return;
    }
    const current = resolveAddCardClock(clockIso, nowIso());
    const created = createNewCard(normalizedWord, normalizedMeaning, current, normalizedNotes || undefined);
    setClockIso(current);
    setCanPersist(true);
    setDeckState((prev) => {
      const next = { ...prev, cards: [created, ...prev.cards] };
      deckStateRef.current = next;
      return next;
    });
  }, [clockIso]);

  const reviewDueCard = useCallback((cardId: string, rating: Rating): boolean => {
    const runtimeNow = nowIso();
    const current = resolveReviewClock(clockIso, runtimeNow);
    const next = applyReviewToDeckState(deckStateRef.current, cardId, rating, current, runtimeNow);
    if (!next.reviewed) {
      return false;
    }

    setDeckState(next.deckState);
    deckStateRef.current = next.deckState;
    setClockIso(resolveNextUiClock(current, next.deckState.lastReviewedAt));
    setCanPersist(true);
    return true;
  }, [clockIso]);

  const stats = useMemo(
    () => alignDueNowStatWithQueue(computeDeckStats(deckState.cards, effectiveClockIso), dueCards),
    [deckState.cards, dueCards, effectiveClockIso],
  );

  return {
    loading,
    clockIso: effectiveClockIso,
    lastReviewedAt: deckState.lastReviewedAt,
    cards: deckState.cards,
    dueCards,
    stats,
    addCard,
    reviewDueCard,
  };
}
