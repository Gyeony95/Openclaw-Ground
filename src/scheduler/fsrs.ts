import { Card, Rating, ReviewState } from '../types';
import { addDaysIso, daysBetween, isIsoDateTime } from '../utils/time';
import { normalizeBoundedText, normalizeOptionalBoundedText } from '../utils/text';
import { parseRuntimeRatingValue, RATING_INTEGER_TOLERANCE } from '../utils/rating';
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MEAN_REVERSION,
  DIFFICULTY_MIN,
  MEANING_MAX_LENGTH,
  MINUTE_IN_DAYS,
  NOTES_MAX_LENGTH,
  REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  REVIEW_STABILITY_OUTLIER_MULTIPLIER,
  STABILITY_MAX,
  STABILITY_MIN,
  WORD_MAX_LENGTH,
} from './constants';

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;
const ON_TIME_TOLERANCE_DAYS = MINUTE_IN_DAYS;
const DAYLIKE_NEAR_ONE_FLOOR_TOLERANCE_DAYS = 5 * MINUTE_IN_DAYS;
const HARD_RATING_LATE_TOLERANCE_DAYS = 15 * MINUTE_IN_DAYS;
const HARD_REVIEW_STABILITY_GROWTH_CAP = 1.2;
const HARD_DAYLIKE_CAP_PROMOTION_THRESHOLD_DAYS = 1.75;
const MAX_MONOTONIC_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREATE_TIME_OFFSET_MS = 20 * 365 * DAY_MS;
const MAX_CREATE_HISTORICAL_LEAP_TOLERANCE_MS = 6 * DAY_MS;
const MAX_CREATE_PAST_OFFSET_MS = MAX_CREATE_TIME_OFFSET_MS + MAX_CREATE_HISTORICAL_LEAP_TOLERANCE_MS;
const MAX_CREATE_FUTURE_OFFSET_MS = MAX_MONOTONIC_CLOCK_SKEW_MS;
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const TIMELINE_JITTER_TOLERANCE_MS = 1000;
export interface ReviewResult {
  card: Card;
  scheduledDays: number;
}

export type RatingIntervalPreview = Record<Rating, number>;

type SchedulerPhase = 'learning' | 'review' | 'relearning';
type ReviewIntervalsByRating = Record<2 | 3 | 4, number>;
const REVIEW_SCHEDULE_FLOOR_DAYS = 0.5;
const RELEARNING_SCHEDULE_FLOOR_DAYS = 10 * MINUTE_IN_DAYS;
const LEARNING_MAX_SCHEDULE_DAYS = 1;
const RELEARNING_MAX_SCHEDULE_DAYS = 2;
const REVIEW_LAPSE_STABILITY_CEILING_DAYS = 1;
const RELEARNING_LAPSE_STABILITY_CEILING_DAYS = 2;
const NON_REVIEW_OUTLIER_MULTIPLIER = 6;
const COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const COUNTER_INTEGER_TOLERANCE = 1e-6;

let cardIdSequence = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeReadString(read: () => unknown, fallback: string): string {
  try {
    const value = read();
    return typeof value === 'string' ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeReadUnknown(read: () => unknown, fallback: unknown): unknown {
  try {
    const value = read();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function safeReadNumber(read: () => unknown, fallback: number): number {
  try {
    const value = parseRuntimeFiniteNumber(read());
    return value !== null ? value : fallback;
  } catch {
    return fallback;
  }
}

function safeReadCounter(read: () => unknown, fallback: number): number {
  try {
    return normalizeCounter(read());
  } catch {
    return fallback;
  }
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  if (Number.isFinite(runtimeNow)) {
    return runtimeNow;
  }
  // Preserve unknown wall-clock state so explicit caller timestamps can still be trusted.
  return Number.NaN;
}

function idEntropySalt(): string {
  try {
    const runtimeCrypto = (globalThis as { crypto?: { getRandomValues?: (buffer: Uint32Array) => Uint32Array } })
      .crypto;
    if (runtimeCrypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      runtimeCrypto.getRandomValues(buffer);
      return buffer[0].toString(36);
    }
  } catch {
    // Fall through to Math.random for older runtimes.
  }

  const fallbackRandom = Math.random();
  if (Number.isFinite(fallbackRandom) && fallbackRandom >= 0 && fallbackRandom < 1) {
    return Math.floor(fallbackRandom * 0x100000000).toString(36);
  }
  return '0';
}

function clockToken(ms: number): string {
  if (!Number.isFinite(ms)) {
    return '0';
  }
  return Math.trunc(Math.abs(ms)).toString(36);
}

function cardIdAnchorToken(ms: number): string {
  if (!Number.isFinite(ms)) {
    return '0';
  }
  const truncated = Math.trunc(ms);
  if (truncated >= 0) {
    return String(truncated);
  }
  // Keep IDs delimiter-safe for historical pre-epoch imports.
  return `n${Math.abs(truncated)}`;
}

function normalizeSnapshotIdToken(value: string): string {
  const normalized = normalizeBoundedText(value, 24)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'card';
}

function fallbackSnapshotCardId(fallbackUpdatedAt: string, word: string, meaning: string): string {
  const anchorMs = Date.parse(fallbackUpdatedAt);
  const anchorToken = cardIdAnchorToken(Number.isFinite(anchorMs) ? anchorMs : 0);
  const wordToken = normalizeSnapshotIdToken(word);
  const meaningToken = normalizeSnapshotIdToken(meaning);
  return `recovered-${anchorToken}-${wordToken}-${meaningToken}`;
}

function toSafeIso(ms: number): string {
  const safeMs = Number.isFinite(ms)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, ms))
    : 0;
  return new Date(safeMs).toISOString();
}

function toCanonicalIso(value: string, fallbackIso: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return fallbackIso;
  }
  return toSafeIso(parsed);
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clamp(fallback, min, max);
  }
  return clamp(value, min, max);
}

function normalizeRuntimeBoundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === Number.POSITIVE_INFINITY) {
    return max;
  }
  if (parsed === Number.NEGATIVE_INFINITY) {
    return min;
  }
  if (parsed === null) {
    return clamp(fallback, min, max);
  }
  return clamp(parsed, min, max);
}

function isValidIso(value: string): boolean {
  return isIsoDateTime(value);
}

function normalizeIsoInput(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeValidIsoInput(value: unknown): string | undefined {
  const normalized = normalizeIsoInput(value);
  if (!normalized || !isValidIso(normalized)) {
    return undefined;
  }
  return toCanonicalIso(normalized, normalized);
}

function isWithinCreatePastWindow(pastOffsetMs: number): boolean {
  return pastOffsetMs <= MAX_CREATE_PAST_OFFSET_MS;
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

function resolveReviewIso(cardUpdatedAt: string, requestedNowIso: string): string {
  const wallClockMs = safeNowMs();
  const wallClockIso = toSafeIso(wallClockMs);
  const normalizedCardUpdatedAt = normalizeIsoInput(cardUpdatedAt);
  const fallbackRaw = normalizedCardUpdatedAt && isValidIso(normalizedCardUpdatedAt) ? normalizedCardUpdatedAt : wallClockIso;
  const fallback = toCanonicalIso(fallbackRaw, wallClockIso);
  const normalizedRequestedNowIso = normalizeIsoInput(requestedNowIso);
  const requestedValid = Boolean(normalizedRequestedNowIso && isValidIso(normalizedRequestedNowIso));
  const fallbackMs = Date.parse(fallback);
  if (
    !requestedValid &&
    Number.isFinite(fallbackMs) &&
    Number.isFinite(wallClockMs) &&
    fallbackMs - wallClockMs >= MAX_MONOTONIC_CLOCK_SKEW_MS
  ) {
    // Invalid review clocks should not preserve future-corrupted card timelines.
    return wallClockIso;
  }
  if (
    !requestedValid &&
    Number.isFinite(fallbackMs) &&
    Number.isFinite(wallClockMs) &&
    Math.abs(fallbackMs - wallClockMs) > MAX_CREATE_TIME_OFFSET_MS
  ) {
    return wallClockIso;
  }

  const candidate = requestedValid ? normalizedRequestedNowIso ?? fallback : fallback;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(fallbackMs)) {
    return fallback;
  }

  if (requestedValid && candidateMs - fallbackMs > MAX_CREATE_TIME_OFFSET_MS) {
    if (!Number.isFinite(wallClockMs)) {
      // Without a reliable wall clock, keep large forward jumps anchored to the
      // existing card timeline to avoid runaway intervals from corrupted inputs.
      return fallback;
    }
    if (Number.isFinite(wallClockMs)) {
      const fallbackIsPathologicallyStale = wallClockMs - fallbackMs > MAX_CREATE_TIME_OFFSET_MS;
      const candidateFutureSkewMs = candidateMs - wallClockMs;
      const candidatePastOffsetMs = wallClockMs - candidateMs;
      const candidateIsWallSafe =
        candidateFutureSkewMs < MAX_MONOTONIC_CLOCK_SKEW_MS &&
        isWithinCreatePastWindow(candidatePastOffsetMs);
      if (fallbackIsPathologicallyStale && candidateIsWallSafe) {
        // Recover stale/corrupted card timelines by accepting a wall-safe review clock.
        return toCanonicalIso(candidate, fallback);
      }
    }
    // Prevent runaway elapsed intervals when review timestamps jump far beyond card history.
    return fallback;
  }

  if (
    requestedValid &&
    Number.isFinite(wallClockMs) &&
    candidateMs - wallClockMs >= MAX_MONOTONIC_CLOCK_SKEW_MS
  ) {
    // Ignore pathological future runtime clocks to prevent runaway elapsed intervals.
    if (fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return wallClockIso;
    }
    if (wallClockMs - fallbackMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      // Avoid snapping to stale history when the requested review time is future-skewed.
      return wallClockIso;
    }
    return fallback;
  }
  if (
    requestedValid &&
    Number.isFinite(wallClockMs) &&
    !isWithinCreatePastWindow(wallClockMs - candidateMs)
  ) {
    if (Math.abs(fallbackMs - wallClockMs) > MAX_CREATE_TIME_OFFSET_MS) {
      return wallClockIso;
    }
    if (fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      // Do not preserve future-skewed card timelines when the requested review
      // timestamp is pathologically stale.
      return wallClockIso;
    }
    return fallback;
  }

  // Keep review time monotonic to avoid negative elapsed intervals on clock drift.
  if (candidateMs < fallbackMs) {
    const skewMs = fallbackMs - candidateMs;
    if (skewMs <= MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return fallback;
    }

    if (!Number.isFinite(wallClockMs) && requestedValid) {
      // Without a reliable wall clock, trust explicit caller review timestamps
      // so corrupted future card timelines do not pin scheduling indefinitely.
      // Keep a long-horizon guard to avoid accepting implausibly old rollbacks.
      if (skewMs > MAX_CREATE_TIME_OFFSET_MS) {
        return fallback;
      }
      return toCanonicalIso(candidate, fallback);
    }

    // Only roll backward when the card timestamp itself looks corrupted far into the future.
    if (Number.isFinite(wallClockMs) && fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      // Guard against stale review timestamps when recovering from corrupted future card timelines.
      if (wallClockMs - candidateMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
        return wallClockIso;
      }
      return toCanonicalIso(candidate, fallback);
    }
    return fallback;
  }
  return toCanonicalIso(candidate, fallback);
}

function resolvePreviewIso(requestedNowIso: string): string {
  const wallClockMs = safeNowMs();
  const wallClockIso = toSafeIso(wallClockMs);
  const normalizedRequestedNowIso = normalizeIsoInput(requestedNowIso);
  if (!normalizedRequestedNowIso || !isValidIso(normalizedRequestedNowIso)) {
    return wallClockIso;
  }
  const candidateMs = Date.parse(normalizedRequestedNowIso);
  if (!Number.isFinite(candidateMs)) {
    return wallClockIso;
  }
  if (
    Number.isFinite(wallClockMs) &&
    candidateMs - wallClockMs >= MAX_MONOTONIC_CLOCK_SKEW_MS
  ) {
    return wallClockIso;
  }
  if (
    Number.isFinite(wallClockMs) &&
    !isWithinCreatePastWindow(wallClockMs - candidateMs)
  ) {
    return wallClockIso;
  }
  return toCanonicalIso(normalizedRequestedNowIso, wallClockIso);
}

function normalizeRating(input: Rating, currentState: ReviewState): Rating {
  // Runtime ratings can arrive with small floating-point drift
  // (e.g. from serialized UI state). Treat near-integers as integers.
  const parsedInput = parseRuntimeRatingValue(input);

  if (!Number.isFinite(parsedInput)) {
    // Runtime-corrupted ratings should be safe by phase:
    // - learning/relearning: avoid accidental promotion by treating as Again
    // - review: avoid punitive lapses by treating as neutral Good
    return currentState === 'review' ? 3 : 1;
  }

  const rounded = Math.round(parsedInput);
  const isIntegerLike = Math.abs(parsedInput - rounded) <= RATING_INTEGER_TOLERANCE;
  // Runtime-corrupted fractional ratings should use the same safe fallback as other invalid values.
  if (!isIntegerLike) {
    return currentState === 'review' ? 3 : 1;
  }

  if (rounded < 1 || rounded > 4) {
    return currentState === 'review' ? 3 : 1;
  }
  if (rounded <= 1) {
    return 1;
  }
  if (rounded >= 4) {
    return 4;
  }
  return rounded === 2 ? 2 : 3;
}

function normalizeTimeline(
  card: Card,
  requestedNowIso: string,
): {
  createdAt: string;
  currentIso: string;
  updatedAt: string;
  dueAt: string;
  dueNeedsRepair: boolean;
} {
  const wallClockMs = safeNowMs();
  const normalizedRequestedNowIso = normalizeIsoInput(requestedNowIso);
  const requestedNowMs =
    normalizedRequestedNowIso && isValidIso(normalizedRequestedNowIso)
      ? Date.parse(normalizedRequestedNowIso)
      : Number.NaN;
  const requestedNowLooksWallSafe =
    Number.isFinite(requestedNowMs) &&
    (!Number.isFinite(wallClockMs) || Math.abs(requestedNowMs - wallClockMs) <= MAX_CREATE_TIME_OFFSET_MS);
  const fallbackMs = requestedNowLooksWallSafe ? requestedNowMs : wallClockMs;
  const fallback = toSafeIso(fallbackMs);
  const normalizedCreatedAtInput = normalizeValidIsoInput(card.createdAt);
  const normalizedUpdatedAtInput = normalizeValidIsoInput(card.updatedAt);
  const normalizedDueAtInput = normalizeValidIsoInput(card.dueAt);
  const dueMs = normalizedDueAtInput ? Date.parse(normalizedDueAtInput) : Number.NaN;
  const updatedMsCandidate = normalizedUpdatedAtInput ? Date.parse(normalizedUpdatedAtInput) : Number.NaN;
  const dueLooksLikePlausibleAnchor =
    Number.isFinite(dueMs) &&
    Number.isFinite(fallbackMs) &&
    Math.abs(dueMs - fallbackMs) <= MAX_CREATE_TIME_OFFSET_MS;
  const dueLooksLikeTimelineAnchor =
    Number.isFinite(dueMs) &&
    ((Number.isFinite(updatedMsCandidate) &&
      Math.abs(dueMs - updatedMsCandidate) <= MAX_CREATE_TIME_OFFSET_MS) ||
      dueLooksLikePlausibleAnchor);
  const safeDueAsCreatedAt = dueLooksLikePlausibleAnchor ? normalizedDueAtInput : undefined;
  let createdAt = normalizedCreatedAtInput
    ? normalizedCreatedAtInput
    : normalizedUpdatedAtInput
      ? normalizedUpdatedAtInput
      : safeDueAsCreatedAt ?? fallback;
  const anchorCandidates = [updatedMsCandidate, dueLooksLikeTimelineAnchor ? dueMs : Number.NaN, fallbackMs].filter((value) =>
    Number.isFinite(value),
  );
  const earliestAnchorMs = anchorCandidates.length > 0 ? Math.min(...anchorCandidates) : fallbackMs;
  const latestAnchorMs = anchorCandidates.length > 0 ? Math.max(...anchorCandidates) : fallbackMs;
  let createdMsCandidate = Date.parse(createdAt);
  if (Number.isFinite(createdMsCandidate) && createdMsCandidate - earliestAnchorMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
    createdAt = toSafeIso(earliestAnchorMs);
    createdMsCandidate = Date.parse(createdAt);
  }
  if (
    Number.isFinite(createdMsCandidate) &&
    Number.isFinite(latestAnchorMs) &&
    !isWithinCreatePastWindow(latestAnchorMs - createdMsCandidate)
  ) {
    // Keep persisted creation timestamps within the same bounded historical window
    // used for runtime imports, while preserving monotonicity against timeline anchors.
    const boundedHistoricalFloorMs = Math.max(earliestAnchorMs, latestAnchorMs - MAX_CREATE_TIME_OFFSET_MS);
    createdAt = toSafeIso(boundedHistoricalFloorMs);
  }
  const normalizedCreatedMs = Date.parse(createdAt);
  createdAt = toSafeIso(Number.isFinite(normalizedCreatedMs) ? normalizedCreatedMs : fallbackMs);
  const rawUpdatedAt = normalizedUpdatedAtInput ?? createdAt;
  const updatedMs = Date.parse(rawUpdatedAt);
  const fallbackUpdatedMs = Date.parse(createdAt);
  const updatedAt = toSafeIso(Number.isFinite(updatedMs) ? updatedMs : fallbackUpdatedMs);
  if (Date.parse(createdAt) > Date.parse(updatedAt)) {
    createdAt = updatedAt;
  }
  const rawDueAtIsValid = Boolean(normalizedDueAtInput);
  const rawDueAt = normalizedDueAtInput;
  const repsForStateInference = normalizeCounter(card.reps);
  const lapsesForStateInference = normalizeCounter(card.lapses);
  const hasReviewHistoryForStateInference = repsForStateInference > 0 || lapsesForStateInference > 0;
  const parsedStabilityForStateInference = parseRuntimeFiniteNumber(card.stability);
  const fallbackDueDaysForStateInference = hasReviewHistoryForStateInference
    ? clampFinite(
        parsedStabilityForStateInference ?? Number.NaN,
        RELEARNING_SCHEDULE_FLOOR_DAYS,
        STABILITY_MAX,
        RELEARNING_SCHEDULE_FLOOR_DAYS,
      )
    : MINUTE_IN_DAYS;
  const dueAtForStateInference = rawDueAt ?? addDaysIso(updatedAt, fallbackDueDaysForStateInference);
  const normalizedState =
    parseState(card.state) ??
    inferStateFromCard({
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
      stability: card.stability,
      updatedAt,
      dueAt: dueAtForStateInference,
    });
  const reviewFallbackDueDays =
    normalizedState === 'review'
      ? normalizeScheduledDays(card.stability, 'review')
      : scheduleFallbackForState(normalizedState);
  const fallbackDueAt = addDaysIso(updatedAt, reviewFallbackDueDays);
  const timelineRepairDueAt = addDaysIso(updatedAt, scheduleFallbackForState(normalizedState));
  const rawDueMs = rawDueAt ? Date.parse(rawDueAt) : Number.NaN;
  const updatedAtMs = Date.parse(updatedAt);
  const dueDaysFromUpdated = Number.isFinite(rawDueMs) ? (rawDueMs - updatedAtMs) / DAY_MS : Number.NaN;
  const hasSaturatedUpperBoundTimeline =
    Number.isFinite(rawDueMs) &&
    Number.isFinite(updatedAtMs) &&
    rawDueMs >= MAX_DATE_MS &&
    updatedAtMs >= MAX_DATE_MS;
  const stateScheduleFloorDays = scheduleFallbackForState(normalizedState);
  const timelineJitterToleranceDays = TIMELINE_JITTER_TOLERANCE_MS / DAY_MS;
  const floorWithTimelineToleranceDays = Math.max(
    0,
    stateScheduleFloorDays - timelineJitterToleranceDays,
  );
  const parsedReviewStability = parseRuntimeFiniteNumber(card.stability);
  const hasFiniteReviewStability = Number.isFinite(parsedReviewStability);
  const expectedReviewScheduleDays = normalizeScheduledDays(
    parsedReviewStability ?? (typeof card.stability === 'number' ? card.stability : Number.NaN),
    'review',
  );
  const maxStateScheduleDays = maxScheduleDaysForState(normalizedState);
  const repairedReviewScheduleDaysForInvalidDue = clamp(
    expectedReviewScheduleDays,
    REVIEW_SCHEDULE_FLOOR_DAYS,
    REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  );
  const repairedReviewScheduleDaysForOutlierDue = clamp(
    expectedReviewScheduleDays,
    REVIEW_SCHEDULE_FLOOR_DAYS,
    REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  );
  const dueNotAfterUpdatedAt =
    Number.isFinite(rawDueMs) &&
    rawDueMs < updatedAtMs - TIMELINE_JITTER_TOLERANCE_MS &&
    !hasSaturatedUpperBoundTimeline;
  const dueBelowStateFloor =
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated < floorWithTimelineToleranceDays;
  const dueBelowReviewFloor = normalizedState === 'review' && dueBelowStateFloor;
  const dueBeyondReviewMaxWindow =
    normalizedState === 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > STABILITY_MAX;
  const dueBeyondReviewInvalidStabilityWindow =
    normalizedState === 'review' &&
    !hasFiniteReviewStability &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS;
  const dueBeyondStateWindow =
    normalizedState !== 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > maxStateScheduleDays;
  const dueWithinModerateNonReviewOutlierWindow =
    normalizedState !== 'review' &&
    rawDueAtIsValid &&
    !dueNotAfterUpdatedAt &&
    !dueBelowStateFloor &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated <= maxStateScheduleDays * NON_REVIEW_OUTLIER_MULTIPLIER;
  const reviewStabilityOutlierWindowDays = Math.max(
    REVIEW_SCHEDULE_FLOOR_DAYS,
    expectedReviewScheduleDays * REVIEW_STABILITY_OUTLIER_MULTIPLIER,
    REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  );
  const dueBeyondReviewStabilityWindow =
    normalizedState === 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > reviewStabilityOutlierWindowDays;
  const useReviewStabilityFallbackForDueRepair = shouldUseReviewStabilityFallbackForDueRepair(
    normalizedState,
    rawDueAtIsValid,
    dueNotAfterUpdatedAt,
    dueBelowReviewFloor,
    expectedReviewScheduleDays,
  );
  const useReviewStabilityFallbackForOutlierDue =
    normalizedState === 'review' &&
    Number.isFinite(expectedReviewScheduleDays) &&
    (dueBeyondReviewMaxWindow || dueBeyondReviewStabilityWindow || dueBeyondReviewInvalidStabilityWindow);
  const dueNeedsRepair =
    !rawDueAtIsValid ||
    dueNotAfterUpdatedAt ||
    dueBelowStateFloor ||
    dueBeyondStateWindow ||
    dueBeyondReviewMaxWindow ||
    dueBeyondReviewStabilityWindow ||
    dueBeyondReviewInvalidStabilityWindow;
  const dueTimelineAnchor = dueNeedsRepair
    ? useReviewStabilityFallbackForDueRepair
      ? addDaysIso(updatedAt, repairedReviewScheduleDaysForInvalidDue)
      : useReviewStabilityFallbackForOutlierDue
        ? addDaysIso(updatedAt, repairedReviewScheduleDaysForOutlierDue)
        : dueWithinModerateNonReviewOutlierWindow
          ? addDaysIso(updatedAt, maxStateScheduleDays)
          : timelineRepairDueAt
    : rawDueAt ?? fallbackDueAt;
  const dueAnchorMs = Date.parse(dueTimelineAnchor ?? fallbackDueAt);
  const fallbackDueMs = Date.parse(fallbackDueAt);
  const safeDueAnchorMs = Number.isFinite(dueAnchorMs)
    ? dueAnchorMs
    : Number.isFinite(fallbackDueMs)
      ? fallbackDueMs
      : updatedAtMs;
  const dueAt = toSafeIso(Math.max(safeDueAnchorMs, updatedAtMs));
  const resolvedCurrentIso = resolveReviewIso(updatedAt, normalizedRequestedNowIso ?? requestedNowIso);
  const resolvedCurrentMs = Date.parse(resolvedCurrentIso);
  const updatedAtLooksCorruptedFuture =
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(wallClockMs) &&
    updatedAtMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS;
  const recoveryWantsRollback =
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(resolvedCurrentMs) &&
    updatedAtMs - resolvedCurrentMs > MAX_MONOTONIC_CLOCK_SKEW_MS;
  const monotonicMs = Number.isFinite(resolvedCurrentMs) && Number.isFinite(updatedAtMs)
    ? Math.max(resolvedCurrentMs, updatedAtMs)
    : Number.isFinite(updatedAtMs)
      ? updatedAtMs
      : Number.isFinite(resolvedCurrentMs)
        ? resolvedCurrentMs
        : fallbackMs;
  const currentIso =
    updatedAtLooksCorruptedFuture && recoveryWantsRollback && Number.isFinite(resolvedCurrentMs)
      ? toSafeIso(resolvedCurrentMs)
      : toSafeIso(monotonicMs);

  return { createdAt, currentIso, updatedAt, dueAt, dueNeedsRepair };
}

function toReviewRating(rating: Rating): 2 | 3 | 4 {
  if (rating <= 2) {
    return 2;
  }
  return rating === 4 ? 4 : 3;
}

function normalizeState(input: unknown): ReviewState {
  const parsed = parseState(input);
  if (parsed) {
    return parsed;
  }
  return 'learning';
}

function parseState(input: unknown): ReviewState | undefined {
  if (input === 'review' || input === 'relearning' || input === 'learning') {
    return input;
  }
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'review' || normalized === 'relearning' || normalized === 'learning') {
      return normalized;
    }
    const folded = normalized.replace(/[\s_-]+/g, '');
    if (folded === 'review') {
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
    if (alphaFolded === 'learning' || alphaFolded === 'learn') {
      return 'learning';
    }
    if (alphaFolded === 'relearning' || alphaFolded === 'relearn') {
      return 'relearning';
    }
  }
  return undefined;
}

function inferStateFromCard(card: Pick<Card, 'state' | 'reps' | 'lapses' | 'stability' | 'updatedAt' | 'dueAt'>): ReviewState {
  const scheduledDays = normalizeElapsedDays(daysBetween(card.updatedAt, card.dueAt));
  const reps = normalizeCounter(card.reps);
  const lapses = normalizeCounter(card.lapses);
  const hasReviewHistory = reps > 0 || lapses > 0;
  const normalizedStability = clampFinite(
    parseRuntimeFiniteNumber(card.stability) ?? card.stability,
    STABILITY_MIN,
    STABILITY_MAX,
    STABILITY_MIN,
  );
  const parsedState = parseState(card.state);
  if (parsedState) {
    if (parsedState === 'review') {
      if (scheduledDays >= REVIEW_SCHEDULE_FLOOR_DAYS) {
        return parsedState;
      }
      if (scheduledDays >= RELEARNING_SCHEDULE_FLOOR_DAYS) {
        return hasReviewHistory ? 'relearning' : 'learning';
      }
      if (scheduledDays > 0) {
        return hasReviewHistory ? 'relearning' : 'learning';
      }
      if (hasReviewHistory || normalizedStability >= REVIEW_SCHEDULE_FLOOR_DAYS) {
        // Keep explicit review cards in review phase when timelines collapse to zero.
        // Collapsed anchors are repaired separately; phase demotion here can over-penalize mature cards.
        // Also preserve mature imported cards when review counters are missing/corrupted.
        return 'review';
      }
      return 'learning';
    }
    if (parsedState === 'relearning') {
      // Relearning should remain short-step retry cadence; day-like windows indicate
      // the card already returned to review scheduling and should be normalized.
      if (scheduledDays >= REVIEW_SCHEDULE_FLOOR_DAYS) {
        return 'review';
      }
      if (scheduledDays > 0) {
        return hasReviewHistory ? parsedState : 'learning';
      }
      // Explicit relearning without any review history is likely imported phase drift.
      return hasReviewHistory ? parsedState : 'learning';
    }
    // Recover corrupted persisted "learning" states for cards that clearly
    // have review history and schedule anchors from later phases.
    if (!hasReviewHistory) {
      return parsedState;
    }
    if (scheduledDays <= 0) {
      // Collapsed schedule anchors (dueAt == updatedAt) on cards with review
      // history should not fall back to fresh-learning semantics.
      return normalizedStability >= REVIEW_SCHEDULE_FLOOR_DAYS ? 'review' : 'relearning';
    }
    if (scheduledDays >= REVIEW_SCHEDULE_FLOOR_DAYS) {
      return 'review';
    }
    if (scheduledDays >= RELEARNING_SCHEDULE_FLOOR_DAYS) {
      return 'relearning';
    }
    return parsedState;
  }

  // Prefer schedule-based inference so short-step cards are not accidentally
  // promoted by stale/corrupted stability values.
  if (scheduledDays >= REVIEW_SCHEDULE_FLOOR_DAYS) {
    if (!hasReviewHistory && normalizedStability < REVIEW_SCHEDULE_FLOOR_DAYS) {
      return 'learning';
    }
    return 'review';
  }
  if (scheduledDays >= RELEARNING_SCHEDULE_FLOOR_DAYS) {
    // Only infer relearning from sub-day retry windows.
    // Day-like intervals are classified as review cadence by the branch above.
    return hasReviewHistory ? 'relearning' : 'learning';
  }

  if (scheduledDays > 0) {
    return 'learning';
  }

  // When schedule anchors collapse to zero (e.g. dueAt==updatedAt), use review
  // history to avoid treating previously-reviewed cards as fresh learning cards.
  if (hasReviewHistory) {
    if (normalizedStability >= REVIEW_SCHEDULE_FLOOR_DAYS) {
      return 'review';
    }
    return 'relearning';
  }
  return 'learning';
}

function normalizeCounter(value: unknown): number {
  if (value === Number.POSITIVE_INFINITY) {
    return COUNTER_MAX;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'infinity' || trimmed === '+infinity') {
      return COUNTER_MAX;
    }
    if (trimmed === '-infinity') {
      return 0;
    }
  }
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === Number.POSITIVE_INFINITY) {
    return COUNTER_MAX;
  }
  if (parsed === Number.NEGATIVE_INFINITY) {
    return 0;
  }
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const rounded = Math.round(parsed);
  const normalized = Math.abs(parsed - rounded) <= COUNTER_INTEGER_TOLERANCE ? rounded : Math.floor(parsed);
  return clamp(normalized, 0, COUNTER_MAX);
}

function scheduleFallbackForState(state: ReviewState): number {
  if (state === 'review') {
    return REVIEW_SCHEDULE_FLOOR_DAYS;
  }
  if (state === 'relearning') {
    return RELEARNING_SCHEDULE_FLOOR_DAYS;
  }
  return MINUTE_IN_DAYS;
}

function rollbackScheduleFallbackForState(state: ReviewState, stability: number): number {
  if (state !== 'review') {
    return scheduleFallbackForState(state);
  }
  // Keep rollback repairs conservative while preserving mature review context.
  // Recovery should not collapse mature review cadence all the way into relearning windows.
  return clamp(
    normalizeScheduledDays(stability, 'review'),
    REVIEW_SCHEDULE_FLOOR_DAYS,
    REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  );
}

function maxScheduleDaysForState(state: ReviewState): number {
  if (state === 'relearning') {
    return RELEARNING_MAX_SCHEDULE_DAYS;
  }
  if (state === 'learning') {
    return LEARNING_MAX_SCHEDULE_DAYS;
  }
  return STABILITY_MAX;
}

function shouldUseReviewStabilityFallbackForDueRepair(
  state: ReviewState,
  dueAtIsValid: boolean,
  dueNotAfterUpdatedAt: boolean,
  dueBelowReviewFloor: boolean,
  stabilityDays?: number,
): boolean {
  if (state !== 'review') {
    return false;
  }
  if (dueAtIsValid && !dueNotAfterUpdatedAt && !dueBelowReviewFloor) {
    return false;
  }
  return Number.isFinite(stabilityDays);
}

function normalizeScheduledDays(value: number, state: ReviewState): number {
  if (value === Number.POSITIVE_INFINITY) {
    return maxScheduleDaysForState(state);
  }
  if (Number.isFinite(value) && value > 0) {
    const normalized = clamp(value, MINUTE_IN_DAYS, STABILITY_MAX);
    if (state === 'review') {
      return clamp(normalized, REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX);
    }
    if (state === 'relearning') {
      return clamp(normalized, RELEARNING_SCHEDULE_FLOOR_DAYS, RELEARNING_MAX_SCHEDULE_DAYS);
    }
    return clamp(normalized, MINUTE_IN_DAYS, LEARNING_MAX_SCHEDULE_DAYS);
  }
  return scheduleFallbackForState(state);
}

function stabilityCeilingForState(state: ReviewState, scheduledDays: number): number {
  const scheduleAnchor = clampFinite(
    scheduledDays,
    STABILITY_MIN,
    STABILITY_MAX,
    scheduleFallbackForState(state),
  );

  if (state === 'review') {
    return clamp(
      Math.max(
        REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
        scheduleAnchor * REVIEW_STABILITY_OUTLIER_MULTIPLIER,
      ),
      STABILITY_MIN,
      STABILITY_MAX,
    );
  }

  if (state === 'relearning') {
    return clamp(
      Math.max(RELEARNING_MAX_SCHEDULE_DAYS, scheduleAnchor * NON_REVIEW_OUTLIER_MULTIPLIER),
      STABILITY_MIN,
      STABILITY_MAX,
    );
  }

  return clamp(
    Math.max(LEARNING_MAX_SCHEDULE_DAYS, scheduleAnchor * NON_REVIEW_OUTLIER_MULTIPLIER),
    STABILITY_MIN,
    STABILITY_MAX,
  );
}

function normalizeElapsedDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, 0, STABILITY_MAX);
}

function nextState(current: ReviewState, rating: Rating): ReviewState {
  if (current === 'learning') {
    return rating >= 3 ? 'review' : 'learning';
  }
  if (current === 'relearning') {
    return rating >= 3 ? 'review' : 'relearning';
  }
  return rating === 1 ? 'relearning' : 'review';
}

function shouldCountLapse(current: ReviewState, rating: Rating): boolean {
  // In FSRS-style review flow, a lapse is a failed review card, not a failed learning step.
  return current === 'review' && rating === 1;
}

function learningIntervalDays(rating: Rating): number {
  switch (rating) {
    case 1:
      return 1 * MINUTE_IN_DAYS;
    case 2:
      return 5 * MINUTE_IN_DAYS;
    default:
      return 10 * MINUTE_IN_DAYS;
  }
}

function relearningIntervalDays(rating: Rating): number {
  switch (rating) {
    case 1:
      return 10 * MINUTE_IN_DAYS;
    case 2:
      return 15 * MINUTE_IN_DAYS;
    case 3:
      return 0.5;
    case 4:
      return 1;
    default:
      return 1;
  }
}

function initialStability(rating: Rating): number {
  switch (rating) {
    case 1:
      return STABILITY_MIN;
    case 2:
      return 0.3;
    case 3:
      return 1;
    case 4:
      return 2.4;
    default:
      return 0.5;
  }
}

function retrievability(elapsedDays: number, stability: number): number {
  const s = clampFinite(stability, STABILITY_MIN, STABILITY_MAX, 0.5);
  const elapsed = Math.max(0, elapsedDays);
  return Math.pow(1 + (FSRS_FACTOR * elapsed) / s, FSRS_DECAY);
}

function intervalFromStability(stability: number, desiredRetention: number): number {
  const s = clampFinite(stability, STABILITY_MIN, STABILITY_MAX, 0.5);
  const retention = clampFinite(desiredRetention, 0.7, 0.98, 0.9);
  const interval = (s / FSRS_FACTOR) * (Math.pow(retention, 1 / FSRS_DECAY) - 1);
  return clamp(interval, REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX);
}

function quantizeReviewIntervalDays(intervalDays: number, scheduledDays: number): number {
  const safeScheduledDays = Number.isFinite(scheduledDays)
    ? clamp(scheduledDays, MINUTE_IN_DAYS, STABILITY_MAX)
    : REVIEW_SCHEDULE_FLOOR_DAYS;
  const scheduleIsDayLike = safeScheduledDays + ON_TIME_TOLERANCE_DAYS >= 1;
  const minReviewInterval = scheduleIsDayLike ? 1 : REVIEW_SCHEDULE_FLOOR_DAYS;
  const safeIntervalDays = Number.isFinite(intervalDays) ? intervalDays : safeScheduledDays;

  if (!scheduleIsDayLike) {
    const halfDayQuantized = Math.round(safeIntervalDays * 2) / 2;
    return clamp(halfDayQuantized, minReviewInterval, STABILITY_MAX);
  }
  return clamp(Math.round(safeIntervalDays), minReviewInterval, STABILITY_MAX);
}

function dayLikeScheduleFloorDays(scheduledDays: number): number {
  if (!Number.isFinite(scheduledDays)) {
    return 1;
  }
  // Keep floor aligned to the same day-quantization used by review intervals.
  return Math.max(1, quantizeReviewIntervalDays(scheduledDays, scheduledDays));
}

function dayLikePreserveScheduleFloorDays(scheduledDays: number): number {
  if (!Number.isFinite(scheduledDays)) {
    return 1;
  }
  if (scheduledDays <= 1 + DAYLIKE_NEAR_ONE_FLOOR_TOLERANCE_DAYS) {
    // A one-day cadence with small timestamp drift should stay on a one-day floor.
    return 1;
  }
  if (scheduledDays < 2) {
    // Near one-day cadence should not collapse back to one day on on-time reviews.
    return 2;
  }
  // Preserve day-like cadence without forcing an additional full-day jump
  // for mild drift above an integer schedule (e.g. 2.1d should keep a 2d floor).
  return Math.max(2, Math.round(scheduledDays));
}

function updateDifficulty(prevDifficulty: number, rating: Rating): number {
  const previous = clampFinite(prevDifficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_MEAN_REVERSION);
  const ratingShift = rating === 4 ? -0.45 : rating === 3 ? -0.1 : rating === 2 ? 0.15 : 0.6;
  const meanReversion = (DIFFICULTY_MEAN_REVERSION - previous) * 0.08;
  return clamp(previous + ratingShift + meanReversion, DIFFICULTY_MIN, DIFFICULTY_MAX);
}

function nextDifficultyForPhase(prevDifficulty: number, currentState: ReviewState, rating: Rating): number {
  // Non-review low ratings are short retries and should not harden long-term card difficulty.
  if (currentState !== 'review' && rating <= 2) {
    return clampFinite(prevDifficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_MEAN_REVERSION);
  }
  return updateDifficulty(prevDifficulty, rating);
}

function updateStability(
  prevStability: number,
  prevDifficulty: number,
  rating: Rating,
  elapsedDays: number,
  phase: SchedulerPhase,
  scheduledDays: number,
): number {
  const stabilityFallback =
    phase === 'review' || phase === 'relearning'
      ? clampFinite(scheduledDays, STABILITY_MIN, STABILITY_MAX, 0.5)
      : 0.5;
  const previous = clampFinite(prevStability, STABILITY_MIN, STABILITY_MAX, stabilityFallback);
  const difficulty = clampFinite(prevDifficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_MEAN_REVERSION);

  if (phase === 'learning') {
    return initialStability(rating);
  }

  const r = retrievability(elapsedDays, previous);
  const difficultyFactor = (11 - difficulty) / 10;
  const timingRatio =
    phase === 'review'
      ? clamp(elapsedDays / Math.max(scheduledDays, MINUTE_IN_DAYS), 0.5, 2.5)
      : clamp(elapsedDays / Math.max(scheduledDays, MINUTE_IN_DAYS), 0.8, 1.6);

  if (rating === 1) {
    const forgetPenalty = 0.12 + 0.22 * difficultyFactor;
    const overdueFailurePenalty = timingRatio > 1 ? 1 + (timingRatio - 1) * 0.25 : 1;
    const reducedStability = (previous * forgetPenalty) / overdueFailurePenalty;
    if (phase === 'review') {
      return clampFinite(
        Math.min(reducedStability, REVIEW_LAPSE_STABILITY_CEILING_DAYS),
        STABILITY_MIN,
        STABILITY_MAX,
        previous,
      );
    }
    if (phase === 'relearning') {
      return clampFinite(
        Math.min(reducedStability, RELEARNING_LAPSE_STABILITY_CEILING_DAYS),
        STABILITY_MIN,
        STABILITY_MAX,
        previous,
      );
    }
    return clampFinite(reducedStability, STABILITY_MIN, STABILITY_MAX, previous);
  }

  if (rating === 2) {
    if (phase === 'relearning') {
      // Relearning "Hard" means the card still needs short-step recovery.
      // Keep stability flat to avoid inflating graduation intervals through repeated retries.
      return clampFinite(previous, STABILITY_MIN, STABILITY_MAX, previous);
    }
    const hardGain = 1 + 0.12 * (1 - r) * difficultyFactor * timingRatio;
    return clampFinite(Math.max(previous + 0.05, previous * hardGain), STABILITY_MIN, STABILITY_MAX, previous);
  }

  const recallGainBase = rating === 4 ? 0.9 : 0.62;
  const growth = 1 + recallGainBase * (1 - r) * difficultyFactor * timingRatio;

  return clampFinite(Math.max(previous + 0.1, previous * growth), STABILITY_MIN, STABILITY_MAX, previous);
}

function effectivePreviousStability(
  prevStability: number,
  scheduledDays: number,
  phase: SchedulerPhase,
): number {
  const scheduleFallback =
    phase === 'review' || phase === 'relearning'
      ? clampFinite(scheduledDays, STABILITY_MIN, STABILITY_MAX, 0.5)
      : 0.5;
  const normalized = clampFinite(prevStability, STABILITY_MIN, STABILITY_MAX, scheduleFallback);
  if (phase !== 'review' && phase !== 'relearning') {
    return normalized;
  }

  const scheduleAnchor = clampFinite(scheduledDays, STABILITY_MIN, STABILITY_MAX, scheduleFallback);
  // If persisted stability is unrealistically low for an established schedule, anchor it toward the schedule.
  const scheduleScaledFloor = clamp(scheduleAnchor * 0.6, STABILITY_MIN, STABILITY_MAX);
  return Math.max(normalized, scheduleScaledFloor);
}

function reviewDesiredRetention(rating: Rating): number {
  if (rating === 2) {
    return 0.95;
  }
  if (rating === 4) {
    return 0.86;
  }
  return 0.9;
}

function rawReviewIntervalDays(
  nextStability: number,
  rating: Rating,
  elapsedDays: number,
  scheduledDays: number,
  phase: SchedulerPhase,
): number {
  const baseInterval = intervalFromStability(nextStability, reviewDesiredRetention(rating));
  const ratingScale = rating === 2 ? 0.85 : rating === 4 ? 1.15 : 1;
  const elapsed = Number.isFinite(elapsedDays) ? Math.max(0, elapsedDays) : 0;
  const scheduled = Number.isFinite(scheduledDays) ? Math.max(scheduledDays, MINUTE_IN_DAYS) : 1;
  const scheduleIsDayLike = scheduled + ON_TIME_TOLERANCE_DAYS >= 1;
  const quantizedScheduled = quantizeReviewIntervalDays(scheduled, scheduled);
  const timingRatio = clamp(elapsed / scheduled, 0.5, 2.5);
  const timingScale = phase === 'review' ? clamp(0.75 + timingRatio * 0.25, 0.75, 1.35) : 1;
  const rawInterval = quantizeReviewIntervalDays(baseInterval * ratingScale * timingScale, scheduled);
  // Mild runtime drift (e.g. +minutes on a 1-day card) should not bump floor to the next full day.
  const scheduleFloor = scheduleIsDayLike
    ? dayLikeScheduleFloorDays(scheduled)
    : Math.max(REVIEW_SCHEDULE_FLOOR_DAYS, quantizedScheduled);
  const schedulePreserveFloor = scheduleIsDayLike ? dayLikePreserveScheduleFloorDays(scheduled) : scheduleFloor;
  let floorFromSchedule = rating === 4 ? scheduleFloor : REVIEW_SCHEDULE_FLOOR_DAYS;

  // Hard recalls should not shrink the schedule when the card was reviewed on-time or later.
  if (phase === 'review' && rating === 2 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    const hardOnTimeFloor = scheduleIsDayLike ? schedulePreserveFloor : REVIEW_SCHEDULE_FLOOR_DAYS;
    floorFromSchedule = Math.max(floorFromSchedule, hardOnTimeFloor);
  }
  if (phase === 'review' && rating === 2 && !scheduleIsDayLike && elapsed + ON_TIME_TOLERANCE_DAYS >= 1) {
    // When a sub-day review is already at least a day late, avoid pinning "Hard" to endless 12-hour loops.
    floorFromSchedule = Math.max(floorFromSchedule, 1);
  }
  if (phase === 'review' && rating === 3 && !scheduleIsDayLike && elapsed + ON_TIME_TOLERANCE_DAYS >= 1) {
    // Once a sub-day review card is a day late, "Good" should graduate to at least a day cadence.
    floorFromSchedule = Math.max(floorFromSchedule, 1);
  }

  // Keep "Good" on-time reviews from shrinking the schedule due to rounding/noise.
  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, schedulePreserveFloor);
  }
  // Keep on-time day-like "Easy" reviews from dropping into a shorter day bucket.
  if (phase === 'review' && rating === 4 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, schedulePreserveFloor);
  }

  const flooredInterval = quantizeReviewIntervalDays(Math.max(rawInterval, floorFromSchedule), scheduled);

  // Keep "Hard" reviews conservative even when cards are heavily overdue.
  if (phase === 'review' && rating === 2) {
    const reviewedEarly = elapsed + ON_TIME_TOLERANCE_DAYS < scheduled;
    const reviewedOnTime = !reviewedEarly && elapsed <= scheduled + ON_TIME_TOLERANCE_DAYS;
    const reviewedSlightlyLate = !reviewedEarly && elapsed <= scheduled + HARD_RATING_LATE_TOLERANCE_DAYS;
    const nearTwoDayDayLikeSchedule =
      scheduleIsDayLike &&
      scheduled + ON_TIME_TOLERANCE_DAYS >= HARD_DAYLIKE_CAP_PROMOTION_THRESHOLD_DAYS &&
      scheduled < 2;
    const earlyCap = scheduleIsDayLike
      ? nearTwoDayDayLikeSchedule
        ? quantizedScheduled
        : Math.max(1, Math.floor(scheduled))
      : REVIEW_SCHEDULE_FLOOR_DAYS;
    const overdueSubDayCap = elapsed + ON_TIME_TOLERANCE_DAYS >= 1 || scheduleIsDayLike ? 1 : REVIEW_SCHEDULE_FLOOR_DAYS;
    const onTimeHardCap = scheduleIsDayLike
      ? scheduled + ON_TIME_TOLERANCE_DAYS >= HARD_DAYLIKE_CAP_PROMOTION_THRESHOLD_DAYS
        ? Math.max(schedulePreserveFloor, quantizedScheduled)
        : schedulePreserveFloor
      : Math.max(overdueSubDayCap, quantizedScheduled);
    // Keep sub-day review cards on sub-day cadence for "Hard" unless they are already a day late.
    const onTimeOrLateCap = scheduleIsDayLike
      ? Math.max(schedulePreserveFloor, Math.floor(scheduled * 1.2))
      : Math.max(overdueSubDayCap, quantizedScheduled);
    const hardCap = reviewedEarly ? earlyCap : reviewedOnTime || reviewedSlightlyLate ? onTimeHardCap : onTimeOrLateCap;
    return quantizeReviewIntervalDays(Math.min(flooredInterval, hardCap), scheduled);
  }

  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS < scheduled) {
    const earlyGoodFloor = scheduleIsDayLike
      ? Math.max(1, Math.floor(scheduled * 0.5))
      : REVIEW_SCHEDULE_FLOOR_DAYS;
    return quantizeReviewIntervalDays(Math.max(flooredInterval, earlyGoodFloor), scheduled);
  }

  if (phase === 'review' && rating === 4 && elapsed + ON_TIME_TOLERANCE_DAYS < scheduled) {
    // Very-early "Easy" responses should not leap too far ahead of the current plan.
    const earlyEasyCap = scheduleIsDayLike
      ? Math.max(1, Math.ceil(scheduled * 2))
      : 1;
    return quantizeReviewIntervalDays(Math.min(flooredInterval, earlyEasyCap), scheduled);
  }

  return quantizeReviewIntervalDays(flooredInterval, scheduled);
}

function orderedReviewIntervals(
  baselineStability: number,
  prevDifficulty: number,
  elapsedDays: number,
  scheduledDays: number,
  phase: SchedulerPhase,
): ReviewIntervalsByRating {
  const hardStabilityRaw = updateStability(baselineStability, prevDifficulty, 2, elapsedDays, phase, scheduledDays);
  const hardStability =
    phase === 'review'
      ? Math.min(hardStabilityRaw, baselineStability * HARD_REVIEW_STABILITY_GROWTH_CAP)
      : hardStabilityRaw;
  const goodStability = updateStability(baselineStability, prevDifficulty, 3, elapsedDays, phase, scheduledDays);
  const easyStability = updateStability(baselineStability, prevDifficulty, 4, elapsedDays, phase, scheduledDays);

  const hard = clampFinite(
    rawReviewIntervalDays(hardStability, 2, elapsedDays, scheduledDays, phase),
    REVIEW_SCHEDULE_FLOOR_DAYS,
    STABILITY_MAX,
    REVIEW_SCHEDULE_FLOOR_DAYS,
  );
  const good = clampFinite(
    rawReviewIntervalDays(goodStability, 3, elapsedDays, scheduledDays, phase),
    REVIEW_SCHEDULE_FLOOR_DAYS,
    STABILITY_MAX,
    hard,
  );
  const easy = clampFinite(
    rawReviewIntervalDays(easyStability, 4, elapsedDays, scheduledDays, phase),
    REVIEW_SCHEDULE_FLOOR_DAYS,
    STABILITY_MAX,
    good,
  );
  return {
    2: hard,
    3: clampFinite(Math.max(good, hard), REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX, hard),
    4: clampFinite(Math.max(easy, good, hard), REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX, good),
  };
}

function graduationIntervalDays(rating: Rating): number {
  return rating === 4 ? 1 : 0.5;
}

function ensureOrderedPreview(
  intervals: RatingIntervalPreview,
  minimums: Partial<RatingIntervalPreview> = {},
): RatingIntervalPreview {
  const againFloor = clampFinite(minimums[1] ?? MINUTE_IN_DAYS, MINUTE_IN_DAYS, STABILITY_MAX, MINUTE_IN_DAYS);
  const hardFloor = clampFinite(minimums[2] ?? againFloor, againFloor, STABILITY_MAX, againFloor);
  const goodFloor = clampFinite(minimums[3] ?? hardFloor, hardFloor, STABILITY_MAX, hardFloor);
  const easyFloor = clampFinite(minimums[4] ?? goodFloor, goodFloor, STABILITY_MAX, goodFloor);
  const again = clampFinite(intervals[1], againFloor, STABILITY_MAX, againFloor);
  const hardBase = clampFinite(intervals[2], hardFloor, STABILITY_MAX, Math.max(hardFloor, again));
  const goodBase = clampFinite(intervals[3], goodFloor, STABILITY_MAX, Math.max(goodFloor, hardBase));
  const easyBase = clampFinite(intervals[4], easyFloor, STABILITY_MAX, Math.max(easyFloor, goodBase));
  const hard = Math.max(hardBase, again);
  const good = Math.max(goodBase, hard);
  const easy = Math.max(easyBase, good);
  return {
    1: again,
    2: hard,
    3: good,
    4: easy,
  };
}

function previewMinimumIntervalByRating(state: ReviewState): RatingIntervalPreview {
  if (state === 'review') {
    return {
      1: RELEARNING_SCHEDULE_FLOOR_DAYS,
      2: REVIEW_SCHEDULE_FLOOR_DAYS,
      3: REVIEW_SCHEDULE_FLOOR_DAYS,
      4: REVIEW_SCHEDULE_FLOOR_DAYS,
    };
  }
  if (state === 'relearning') {
    return {
      1: RELEARNING_SCHEDULE_FLOOR_DAYS,
      2: 15 * MINUTE_IN_DAYS,
      // Relearning "Good" can graduate from short-step retries to either a half-day
      // or one-day review cadence depending on the incoming relearning schedule.
      3: REVIEW_SCHEDULE_FLOOR_DAYS,
      4: 1,
    };
  }
  return {
    1: MINUTE_IN_DAYS,
    2: 5 * MINUTE_IN_DAYS,
    3: REVIEW_SCHEDULE_FLOOR_DAYS,
    4: 1,
  };
}

function previewMaximumIntervalByRating(state: ReviewState): RatingIntervalPreview {
  if (state === 'review') {
    return {
      1: RELEARNING_SCHEDULE_FLOOR_DAYS,
      2: STABILITY_MAX,
      3: STABILITY_MAX,
      4: STABILITY_MAX,
    };
  }
  if (state === 'relearning') {
    return {
      1: RELEARNING_SCHEDULE_FLOOR_DAYS,
      2: 15 * MINUTE_IN_DAYS,
      // Keep preview ceilings aligned with graduation behavior. Relearning cards
      // can surface day-like schedules via imports before phase normalization.
      3: 1,
      4: 1,
    };
  }
  return {
    1: MINUTE_IN_DAYS,
    2: 5 * MINUTE_IN_DAYS,
    3: REVIEW_SCHEDULE_FLOOR_DAYS,
    4: 1,
  };
}

function normalizeCardText(
  card: Pick<Card, 'word' | 'meaning' | 'notes'>,
): Pick<Card, 'word' | 'meaning' | 'notes'> {
  const normalizedWord = normalizeWordValue(card.word);
  const normalizedMeaning = normalizeMeaningValue(card.meaning);
  const word = normalizedWord.length > 0 ? normalizedWord : '[invalid word]';
  const meaning = normalizedMeaning.length > 0 ? normalizedMeaning : '[invalid meaning]';
  const trimmedNotes = normalizeNotesValue(card.notes);

  return {
    word,
    meaning,
    notes: trimmedNotes || undefined,
  };
}

function snapshotSchedulingCard(card: Card): Card {
  const fallbackIso = toSafeIso(safeNowMs());
  const fallbackUpdatedAt = safeReadString(() => card.updatedAt, fallbackIso);
  const fallbackDueAt = safeReadString(() => card.dueAt, fallbackUpdatedAt);
  const snapshotWord = safeReadString(() => card.word, '');
  const snapshotMeaning = safeReadString(() => card.meaning, '');
  const rawId = safeReadString(() => card.id, '');
  const normalizedId = rawId.trim();
  const snapshotId =
    normalizedId.length > 0 ? normalizedId : fallbackSnapshotCardId(fallbackUpdatedAt, snapshotWord, snapshotMeaning);
  // Snapshot runtime-backed properties once so normalization and scheduling stay deterministic.
  return {
    id: snapshotId,
    word: snapshotWord,
    meaning: snapshotMeaning,
    notes: safeReadString(() => card.notes, ''),
    createdAt: safeReadString(() => card.createdAt, fallbackUpdatedAt),
    updatedAt: fallbackUpdatedAt,
    dueAt: fallbackDueAt,
    state: normalizeState(safeReadString(() => card.state, 'learning')),
    reps: safeReadCounter(() => card.reps, 0),
    lapses: safeReadCounter(() => card.lapses, 0),
    stability: safeReadNumber(() => card.stability, Number.NaN),
    difficulty: safeReadNumber(() => card.difficulty, Number.NaN),
  };
}

function normalizeWordValue(word: string): string {
  return normalizeBoundedText(word, WORD_MAX_LENGTH);
}

function normalizeMeaningValue(meaning: string): string {
  return normalizeBoundedText(meaning, MEANING_MAX_LENGTH);
}

function normalizeNotesValue(notes?: string): string | undefined {
  return normalizeOptionalBoundedText(notes, NOTES_MAX_LENGTH);
}

function normalizeSchedulingCard(
  card: Card,
  requestedNowIso: string,
): { card: Card; currentIso: string } {
  const rawReps = safeReadUnknown(() => card.reps, 0);
  const rawLapses = safeReadUnknown(() => card.lapses, 0);
  const countersFromLegacyStrings = typeof rawReps === 'string' || typeof rawLapses === 'string';
  const snapshot = snapshotSchedulingCard(card);
  const { createdAt, currentIso, updatedAt, dueAt, dueNeedsRepair } = normalizeTimeline(snapshot, requestedNowIso);
  const normalizedText = normalizeCardText(snapshot);
  const normalizedState = inferStateFromCard({
    state: snapshot.state,
    reps: snapshot.reps,
    lapses: snapshot.lapses,
    stability: snapshot.stability,
    updatedAt,
    dueAt,
  });
  const normalizedScheduledDays = normalizeScheduledDays(daysBetween(updatedAt, dueAt), normalizedState);
  const normalizedDifficulty = normalizeRuntimeBoundedNumber(
    snapshot.difficulty,
    DIFFICULTY_MIN,
    DIFFICULTY_MAX,
    DIFFICULTY_MEAN_REVERSION,
  );
  const parsedStability = parseRuntimeFiniteNumber(snapshot.stability);
  const normalizedStabilityFallback =
    normalizedState === 'learning' ? 0.5 : normalizedScheduledDays;
  // If due anchors were repaired, prefer schedule-derived stability to avoid
  // amplifying corrupted historical stability into runaway intervals.
  const stabilityInput =
    dueNeedsRepair && normalizedState !== 'learning' ? normalizedScheduledDays : parsedStability ?? snapshot.stability;
  const normalizedStabilityBase = normalizeRuntimeBoundedNumber(
    stabilityInput,
    STABILITY_MIN,
    STABILITY_MAX,
    normalizedStabilityFallback,
  );
  const normalizedStability = clampFinite(
    Math.min(
      normalizedStabilityBase,
      stabilityCeilingForState(normalizedState, normalizedScheduledDays),
    ),
    STABILITY_MIN,
    STABILITY_MAX,
    normalizedStabilityFallback,
  );
  const normalizedReps = normalizeCounter(snapshot.reps);
  const normalizedLapsesRaw = normalizeCounter(snapshot.lapses);
  const normalizedLapses =
    countersFromLegacyStrings && normalizedLapsesRaw > normalizedReps
      ? normalizedLapsesRaw
      : Math.min(normalizedLapsesRaw, normalizedReps);

  return {
    currentIso,
    card: {
      ...snapshot,
      ...normalizedText,
      createdAt,
      updatedAt,
      dueAt,
      state: normalizedState,
      difficulty: normalizedDifficulty,
      stability: normalizedStability,
      reps: normalizedReps,
      lapses: normalizedLapses,
    },
  };
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const normalized = normalizeSchedulingCard(card, nowIso);
  return reviewNormalizedCard(normalized.card, normalized.currentIso, rating);
}

function reviewNormalizedCard(baseCard: Card, currentIso: string, rating: Rating): ReviewResult {
  const currentState = normalizeState(baseCard.state);
  const normalizedRating = normalizeRating(rating, currentState);
  const previousReps = normalizeCounter(baseCard.reps);
  const previousLapses = normalizeCounter(baseCard.lapses);
  const updatedAt = baseCard.updatedAt;
  const dueAt = baseCard.dueAt;
  const createdAt = baseCard.createdAt;
  const updatedAtMs = Date.parse(updatedAt);
  const currentMs = Date.parse(currentIso);
  const timelineRolledBack =
    Number.isFinite(updatedAtMs) &&
    Number.isFinite(currentMs) &&
    updatedAtMs - currentMs > MAX_MONOTONIC_CLOCK_SKEW_MS;
  const rollbackScheduleFromStability = rollbackScheduleFallbackForState(currentState, baseCard.stability);
  const rollbackScheduleFromDueAnchor = normalizeScheduledDays(daysBetween(updatedAt, dueAt), currentState);
  const rollbackScheduleDays =
    currentState === 'review'
      // Preserve mature review cadence when recovering from future-skewed timelines.
      // Due anchors are already normalized, so keep whichever review cadence is longer.
      ? Math.max(rollbackScheduleFromStability, rollbackScheduleFromDueAnchor)
      : Math.min(rollbackScheduleFromStability, rollbackScheduleFromDueAnchor);
  const scheduleAnchorUpdatedAt = timelineRolledBack
    ? currentState === 'review'
      // For rollback recovery, keep review cards on an on-time cadence anchor instead of
      // interpreting them as instant early repeats, which can artificially shrink intervals.
      ? addDaysIso(currentIso, -rollbackScheduleDays)
      : currentIso
    : updatedAt;
  const scheduleAnchorDueAt = timelineRolledBack
    ? currentState === 'review'
      ? currentIso
      : addDaysIso(currentIso, rollbackScheduleDays)
    : dueAt;
  const elapsedDays = normalizeElapsedDays(daysBetween(scheduleAnchorUpdatedAt, currentIso));
  const scheduledDays = daysBetween(scheduleAnchorUpdatedAt, scheduleAnchorDueAt);
  const previousScheduledDays = normalizeScheduledDays(scheduledDays, currentState);
  const state = nextState(currentState, normalizedRating);
  const phase = currentState;
  const lapseIncrement = shouldCountLapse(currentState, normalizedRating) ? 1 : 0;
  const previousDifficulty = baseCard.difficulty;
  const stabilitySeed = timelineRolledBack ? previousScheduledDays : baseCard.stability;
  const previousStability = effectivePreviousStability(stabilitySeed, previousScheduledDays, phase);

  const nextDifficulty = nextDifficultyForPhase(previousDifficulty, currentState, normalizedRating);
  const nextStabilityRaw = updateStability(
    previousStability,
    previousDifficulty,
    normalizedRating,
    elapsedDays,
    phase,
    previousScheduledDays,
  );
  const nextStability =
    phase === 'review' && normalizedRating === 2
      ? Math.min(nextStabilityRaw, previousStability * HARD_REVIEW_STABILITY_GROWTH_CAP)
      : nextStabilityRaw;

  let nextScheduledDays: number;

  if (state === 'learning') {
    nextScheduledDays = learningIntervalDays(normalizedRating);
  } else if (state === 'relearning') {
    nextScheduledDays = relearningIntervalDays(normalizedRating);
  } else if (phase !== 'review') {
    const graduationInterval = graduationIntervalDays(normalizedRating);
    if (phase === 'relearning' && normalizedRating >= 3) {
      const dayLikeRelearningFloor =
        previousScheduledDays + ON_TIME_TOLERANCE_DAYS >= 1 ? 1 : REVIEW_SCHEDULE_FLOOR_DAYS;
      nextScheduledDays = Math.max(graduationInterval, dayLikeRelearningFloor);
    } else {
      nextScheduledDays = graduationInterval;
    }
  } else {
    const intervals = orderedReviewIntervals(
      previousStability,
      previousDifficulty,
      elapsedDays,
      previousScheduledDays,
      phase,
    );
    nextScheduledDays = intervals[toReviewRating(normalizedRating)];
  }

  const safeScheduledDays = normalizeScheduledDays(nextScheduledDays, state);
  const stableGraduationFloor =
    currentState === 'relearning' && state === 'review' && normalizedRating >= 3
      ? safeScheduledDays
      : STABILITY_MIN;
  const normalizedNextStability = clampFinite(
    Math.min(
      Math.max(nextStability, stableGraduationFloor),
      stabilityCeilingForState(state, safeScheduledDays),
    ),
    STABILITY_MIN,
    STABILITY_MAX,
    safeScheduledDays,
  );
  const nextDueAt = addDaysIso(currentIso, safeScheduledDays);
  const nextUpdatedMs = Date.parse(currentIso);
  const createdMs = Date.parse(createdAt);
  const normalizedCreatedAt =
    Number.isFinite(nextUpdatedMs) && Number.isFinite(createdMs) && createdMs > nextUpdatedMs
      ? currentIso
      : createdAt;
  const nextReps = Math.min(COUNTER_MAX, previousReps + 1);
  const nextLapsesRaw = Math.min(COUNTER_MAX, previousLapses + lapseIncrement);
  const nextLapses =
    previousLapses > previousReps
      ? nextLapsesRaw
      : Math.min(nextReps, nextLapsesRaw);

  return {
    scheduledDays: safeScheduledDays,
    card: {
      ...baseCard,
      createdAt: normalizedCreatedAt,
      state,
      difficulty: nextDifficulty,
      stability: normalizedNextStability,
      reps: nextReps,
      lapses: nextLapses,
      updatedAt: currentIso,
      dueAt: nextDueAt,
    },
  };
}

export function previewIntervals(card: Card, nowIso: string): RatingIntervalPreview {
  const previewNowIso = resolvePreviewIso(nowIso);
  const fallbackState = inferStateFromCard({
    state: safeReadString(() => card.state, 'learning'),
    reps: safeReadCounter(() => card.reps, 0),
    lapses: safeReadCounter(() => card.lapses, 0),
    stability: safeReadNumber(() => card.stability, STABILITY_MIN),
    updatedAt: safeReadString(() => card.updatedAt, previewNowIso),
    dueAt: safeReadString(() => card.dueAt, previewNowIso),
  });
  const fallbackFloor = previewMinimumIntervalByRating(fallbackState);
  const fallbackPreview = ensureOrderedPreview(fallbackFloor, fallbackFloor);
  try {
    const normalized = normalizeSchedulingCard(card, previewNowIso);
    const previewCard = normalized.card;
    const previewIso = normalized.currentIso;
    const previewFloor = previewMinimumIntervalByRating(previewCard.state);
    const previewCeiling = previewMaximumIntervalByRating(previewCard.state);
    const previewScheduledDays = normalizeScheduledDays(
      daysBetween(previewCard.updatedAt, previewCard.dueAt),
      previewCard.state,
    );
    const reviewFallbackFloorDays =
      previewCard.state === 'review'
        ? Math.max(
            REVIEW_SCHEDULE_FLOOR_DAYS,
            quantizeReviewIntervalDays(previewScheduledDays, previewScheduledDays),
          )
        : REVIEW_SCHEDULE_FLOOR_DAYS;
    const ensureFiniteWithinBounds = (candidate: number, floor: number, ceiling: number): number => {
      if (!Number.isFinite(candidate)) {
        return floor;
      }
      return clamp(candidate, floor, ceiling);
    };
    const fallbackPreviewForRating = (rating: Rating): number => {
      if (rating === 1) {
        return previewFloor[1];
      }
      if (previewCard.state === 'review') {
        return Math.max(previewFloor[rating], reviewFallbackFloorDays);
      }
      return previewFloor[rating];
    };
    const previewForRating = (rating: Rating): number => {
      try {
        return reviewNormalizedCard(previewCard, previewIso, rating).scheduledDays;
      } catch {
        // Preserve mature review cadence when a single preview branch fails.
        return fallbackPreviewForRating(rating);
      }
    };
    const preview = {
      1: ensureFiniteWithinBounds(previewForRating(1), previewFloor[1], previewCeiling[1]),
      2: ensureFiniteWithinBounds(previewForRating(2), previewFloor[2], previewCeiling[2]),
      3: ensureFiniteWithinBounds(previewForRating(3), previewFloor[3], previewCeiling[3]),
      4: ensureFiniteWithinBounds(previewForRating(4), previewFloor[4], previewCeiling[4]),
    };
    return ensureOrderedPreview(preview, previewFloor);
  } catch {
    // Keep interval previews available for UI/analytics when runtime card accessors are corrupted.
    return fallbackPreview;
  }
}

export function createNewCard(word: string, meaning: string, nowIso: string, notes?: string): Card {
  const wallClockMs = safeNowMs();
  const normalizedNowIso = normalizeIsoInput(nowIso);
  const requestedCreatedMs =
    normalizedNowIso && isValidIso(normalizedNowIso) ? Date.parse(normalizedNowIso) : Number.NaN;
  // Preserve reasonable historical imports while rejecting pathologically stale/future timestamps.
  const requestedPastOffsetMs =
    Number.isFinite(wallClockMs) && Number.isFinite(requestedCreatedMs) ? wallClockMs - requestedCreatedMs : 0;
  const requestedIsPlausible =
    Number.isFinite(requestedCreatedMs) &&
    (!Number.isFinite(wallClockMs) ||
      (requestedCreatedMs - wallClockMs < MAX_CREATE_FUTURE_OFFSET_MS &&
        isWithinCreatePastWindow(requestedPastOffsetMs)));
  const safeCreatedMs = requestedIsPlausible
    ? requestedCreatedMs
    : Number.isFinite(wallClockMs)
      ? wallClockMs
      : 0;
  const createdAt = toSafeIso(safeCreatedMs);
  const trimmedWord = normalizeWordValue(word);
  const trimmedMeaning = normalizeMeaningValue(meaning);
  const trimmedNotes = normalizeNotesValue(notes);
  const createdAtMs = Date.parse(createdAt);
  cardIdSequence = cardIdSequence >= COUNTER_MAX ? 1 : cardIdSequence + 1;
  const uniqueSuffix = cardIdSequence.toString(36);
  const runtimeSaltMs = safeNowMs();
  const runtimeSalt = clockToken(runtimeSaltMs);
  const entropySalt = idEntropySalt();
  const idAnchor = Number.isFinite(createdAtMs) ? createdAtMs : safeCreatedMs;
  const idAnchorToken = cardIdAnchorToken(idAnchor);

  return {
    id: `${idAnchorToken}-${runtimeSalt}-${entropySalt}-${uniqueSuffix}`,
    word: trimmedWord.length > 0 ? trimmedWord : '[invalid word]',
    meaning: trimmedMeaning.length > 0 ? trimmedMeaning : '[invalid meaning]',
    notes: trimmedNotes || undefined,
    createdAt,
    updatedAt: createdAt,
    dueAt: createdAt,
    state: 'learning',
    reps: 0,
    lapses: 0,
    stability: 0.5,
    difficulty: 5,
  };
}
