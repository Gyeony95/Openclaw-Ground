import { Card, Rating, ReviewState } from '../types';
import { addDaysIso, daysBetween, nowIso as currentNowIso } from '../utils/time';
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MEAN_REVERSION,
  DIFFICULTY_MIN,
  MEANING_MAX_LENGTH,
  MINUTE_IN_DAYS,
  NOTES_MAX_LENGTH,
  STABILITY_MAX,
  STABILITY_MIN,
  WORD_MAX_LENGTH,
} from './constants';

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;
const ON_TIME_TOLERANCE_DAYS = MINUTE_IN_DAYS;
const MAX_MONOTONIC_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREATE_TIME_OFFSET_MS = 20 * 365 * DAY_MS;
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
const REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS = 7;
const COUNTER_MAX = Number.MAX_SAFE_INTEGER;

let cardIdSequence = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeNowMs(): number {
  const parsed = Date.parse(currentNowIso());
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const runtimeNow = Date.now();
  if (Number.isFinite(runtimeNow)) {
    return runtimeNow;
  }
  return 0;
}

function toSafeIso(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : 0).toISOString();
}

function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return clamp(fallback, min, max);
  }
  return clamp(value, min, max);
}

function isValidIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function resolveReviewIso(cardUpdatedAt: string, requestedNowIso: string): string {
  const fallback = isValidIso(cardUpdatedAt) ? cardUpdatedAt : currentNowIso();
  const requestedValid = isValidIso(requestedNowIso);
  const wallClockMs = safeNowMs();
  const wallClockIso = toSafeIso(wallClockMs);
  const fallbackMs = Date.parse(fallback);
  if (
    !requestedValid &&
    Number.isFinite(fallbackMs) &&
    Number.isFinite(wallClockMs) &&
    fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS
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

  const candidate = requestedValid ? requestedNowIso : fallback;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(fallbackMs)) {
    return fallback;
  }

  if (
    requestedValid &&
    Number.isFinite(wallClockMs) &&
    candidateMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS
  ) {
    // Ignore pathological future runtime clocks to prevent runaway elapsed intervals.
    if (fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return wallClockIso;
    }
    return fallback;
  }
  if (
    requestedValid &&
    Number.isFinite(wallClockMs) &&
    wallClockMs - candidateMs > MAX_CREATE_TIME_OFFSET_MS
  ) {
    if (Math.abs(fallbackMs - wallClockMs) > MAX_CREATE_TIME_OFFSET_MS) {
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

    // Only roll backward when the card timestamp itself looks corrupted far into the future.
    if (Number.isFinite(wallClockMs) && fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      // Guard against stale review timestamps when recovering from corrupted future card timelines.
      if (wallClockMs - candidateMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
        return wallClockIso;
      }
      return candidate;
    }
    return fallback;
  }
  return candidate;
}

function normalizeRating(input: Rating, currentState: ReviewState): Rating {
  if (!Number.isFinite(input)) {
    // Runtime-corrupted ratings should be safe by phase:
    // - learning/relearning: avoid accidental promotion by treating as Again
    // - review: avoid punitive lapses by treating as neutral Good
    return currentState === 'review' ? 3 : 1;
  }

  // Runtime-corrupted fractional ratings should use the same safe fallback as other invalid values.
  if (!Number.isInteger(input)) {
    return currentState === 'review' ? 3 : 1;
  }

  const rounded = Math.round(input);
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
} {
  const fallbackMs = safeNowMs();
  const fallback = toSafeIso(fallbackMs);
  const dueMs = isValidIso(card.dueAt) ? Date.parse(card.dueAt) : Number.NaN;
  const dueLooksLikePlausibleAnchor =
    Number.isFinite(dueMs) &&
    Number.isFinite(fallbackMs) &&
    Math.abs(dueMs - fallbackMs) <= MAX_CREATE_TIME_OFFSET_MS;
  const safeDueAsCreatedAt = dueLooksLikePlausibleAnchor ? card.dueAt : undefined;
  let createdAt = isValidIso(card.createdAt)
    ? card.createdAt
    : isValidIso(card.updatedAt)
      ? card.updatedAt
      : safeDueAsCreatedAt ?? fallback;
  const updatedMsCandidate = isValidIso(card.updatedAt) ? Date.parse(card.updatedAt) : Number.NaN;
  const anchorCandidates = [updatedMsCandidate, dueMs, fallbackMs].filter((value) =>
    Number.isFinite(value),
  );
  const earliestAnchorMs = anchorCandidates.length > 0 ? Math.min(...anchorCandidates) : fallbackMs;
  const createdMsCandidate = Date.parse(createdAt);
  if (Number.isFinite(createdMsCandidate) && createdMsCandidate - earliestAnchorMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
    createdAt = toSafeIso(earliestAnchorMs);
  }
  const normalizedCreatedMs = Date.parse(createdAt);
  createdAt = toSafeIso(Number.isFinite(normalizedCreatedMs) ? normalizedCreatedMs : fallbackMs);
  const rawUpdatedAt = isValidIso(card.updatedAt) ? card.updatedAt : createdAt;
  const updatedMs = Date.parse(rawUpdatedAt);
  const fallbackUpdatedMs = Date.parse(createdAt);
  const updatedAt = toSafeIso(Number.isFinite(updatedMs) ? updatedMs : fallbackUpdatedMs);
  if (Date.parse(createdAt) > Date.parse(updatedAt)) {
    createdAt = updatedAt;
  }
  const normalizedState = normalizeState(card.state);
  const reviewFallbackDueDays =
    normalizedState === 'review'
      ? normalizeScheduledDays(card.stability, 'review')
      : scheduleFallbackForState(normalizedState);
  const fallbackDueAt = addDaysIso(updatedAt, reviewFallbackDueDays);
  const timelineRepairDueAt = addDaysIso(updatedAt, scheduleFallbackForState(normalizedState));
  const rawDueAtIsValid = isValidIso(card.dueAt);
  const rawDueAt = rawDueAtIsValid ? card.dueAt : undefined;
  const rawDueMs = rawDueAt ? Date.parse(rawDueAt) : Number.NaN;
  const updatedAtMs = Date.parse(updatedAt);
  const dueDaysFromUpdated = Number.isFinite(rawDueMs) ? (rawDueMs - updatedAtMs) / DAY_MS : Number.NaN;
  const expectedReviewScheduleDays = normalizeScheduledDays(card.stability, 'review');
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
    rawDueMs <= updatedAtMs;
  const dueBelowReviewFloor =
    normalizedState === 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated < REVIEW_SCHEDULE_FLOOR_DAYS;
  const dueBeyondReviewMaxWindow =
    normalizedState === 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > STABILITY_MAX;
  const dueBeyondStateWindow =
    normalizedState !== 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated > maxScheduleDaysForState(normalizedState);
  const dueBeyondReviewStabilityWindow =
    normalizedState === 'review' &&
    Number.isFinite(dueDaysFromUpdated) &&
    dueDaysFromUpdated >
      Math.max(REVIEW_SCHEDULE_FLOOR_DAYS, expectedReviewScheduleDays * 6, 30);
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
    (dueBeyondReviewMaxWindow || dueBeyondReviewStabilityWindow);
  const dueNeedsRepair =
    !rawDueAt ||
    dueNotAfterUpdatedAt ||
    dueBelowReviewFloor ||
    dueBeyondStateWindow ||
    dueBeyondReviewMaxWindow ||
    dueBeyondReviewStabilityWindow;
  const dueTimelineAnchor = dueNeedsRepair
    ? useReviewStabilityFallbackForDueRepair
      ? addDaysIso(updatedAt, repairedReviewScheduleDaysForInvalidDue)
      : useReviewStabilityFallbackForOutlierDue
        ? addDaysIso(updatedAt, repairedReviewScheduleDaysForOutlierDue)
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
  const resolvedCurrentIso = resolveReviewIso(updatedAt, requestedNowIso);
  const resolvedCurrentMs = Date.parse(resolvedCurrentIso);
  const wallClockMs = safeNowMs();
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

  return { createdAt, currentIso, updatedAt, dueAt };
}

function toReviewRating(rating: Rating): 2 | 3 | 4 {
  if (rating <= 2) {
    return 2;
  }
  return rating === 4 ? 4 : 3;
}

function normalizeState(input: ReviewState): ReviewState {
  if (input === 'review' || input === 'relearning') {
    return input;
  }
  return 'learning';
}

function normalizeCounter(value: number): number {
  if (value === Number.POSITIVE_INFINITY) {
    return COUNTER_MAX;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(Math.floor(value), 0, COUNTER_MAX);
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
  const retention = clamp(desiredRetention, 0.7, 0.98);
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
  // Imported/manual schedules can be non-integer; never round them down on on-time review floors.
  return Math.max(1, Math.ceil(scheduledDays - ON_TIME_TOLERANCE_DAYS));
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
    return clampFinite((previous * forgetPenalty) / overdueFailurePenalty, STABILITY_MIN, STABILITY_MAX, previous);
  }

  if (rating === 2) {
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
  let floorFromSchedule = rating === 4 ? scheduleFloor : REVIEW_SCHEDULE_FLOOR_DAYS;

  // Hard recalls should not shrink the schedule when the card was reviewed on-time or later.
  if (phase === 'review' && rating === 2 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, scheduleFloor);
  }
  if (phase === 'review' && rating === 2 && !scheduleIsDayLike && elapsed + ON_TIME_TOLERANCE_DAYS >= 1) {
    // When a sub-day review is already at least a day late, avoid pinning "Hard" to endless 12-hour loops.
    floorFromSchedule = Math.max(floorFromSchedule, 1);
  }

  // Keep "Good" on-time reviews from shrinking the schedule due to rounding/noise.
  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, scheduleFloor);
  }

  const flooredInterval = quantizeReviewIntervalDays(Math.max(rawInterval, floorFromSchedule), scheduled);

  // Keep "Hard" reviews conservative even when cards are heavily overdue.
  if (phase === 'review' && rating === 2) {
    const reviewedEarly = elapsed + ON_TIME_TOLERANCE_DAYS < scheduled;
    const reviewedOnTime = !reviewedEarly && elapsed <= scheduled + ON_TIME_TOLERANCE_DAYS;
    const earlyCap = scheduleIsDayLike ? Math.max(1, Math.floor(scheduled)) : REVIEW_SCHEDULE_FLOOR_DAYS;
    const overdueSubDayCap = elapsed + ON_TIME_TOLERANCE_DAYS >= 1 || scheduleIsDayLike ? 1 : REVIEW_SCHEDULE_FLOOR_DAYS;
    // Keep sub-day review cards on sub-day cadence for "Hard" unless they are already a day late.
    const onTimeOrLateCap = scheduleIsDayLike
      ? Math.max(1, Math.ceil(scheduled * 1.2))
      : Math.max(overdueSubDayCap, quantizedScheduled);
    const hardCap = reviewedEarly ? earlyCap : reviewedOnTime ? scheduleFloor : onTimeOrLateCap;
    return quantizeReviewIntervalDays(Math.min(flooredInterval, hardCap), scheduled);
  }

  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS < scheduled) {
    const earlyGoodFloor = scheduleIsDayLike
      ? Math.max(1, Math.floor(scheduled * 0.5))
      : REVIEW_SCHEDULE_FLOOR_DAYS;
    return quantizeReviewIntervalDays(Math.max(flooredInterval, earlyGoodFloor), scheduled);
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
  const hardStability = updateStability(baselineStability, prevDifficulty, 2, elapsedDays, phase, scheduledDays);
  const goodStability = updateStability(baselineStability, prevDifficulty, 3, elapsedDays, phase, scheduledDays);
  const easyStability = updateStability(baselineStability, prevDifficulty, 4, elapsedDays, phase, scheduledDays);

  const hard = rawReviewIntervalDays(hardStability, 2, elapsedDays, scheduledDays, phase);
  const good = rawReviewIntervalDays(goodStability, 3, elapsedDays, scheduledDays, phase);
  const easy = rawReviewIntervalDays(easyStability, 4, elapsedDays, scheduledDays, phase);
  return {
    2: hard,
    3: clamp(Math.max(good, hard), REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX),
    4: clamp(Math.max(easy, good, hard), REVIEW_SCHEDULE_FLOOR_DAYS, STABILITY_MAX),
  };
}

function graduationIntervalDays(rating: Rating): number {
  return rating === 4 ? 1 : 0.5;
}

function ensureOrderedPreview(intervals: RatingIntervalPreview): RatingIntervalPreview {
  const again = clampFinite(intervals[1], MINUTE_IN_DAYS, STABILITY_MAX, MINUTE_IN_DAYS);
  const hardBase = clampFinite(intervals[2], MINUTE_IN_DAYS, STABILITY_MAX, again);
  const goodBase = clampFinite(intervals[3], MINUTE_IN_DAYS, STABILITY_MAX, hardBase);
  const easyBase = clampFinite(intervals[4], MINUTE_IN_DAYS, STABILITY_MAX, goodBase);
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

function normalizeWordValue(word: string): string {
  if (typeof word !== 'string') {
    return '';
  }
  return word.trim().replace(/\s+/g, ' ').slice(0, WORD_MAX_LENGTH);
}

function normalizeMeaningValue(meaning: string): string {
  if (typeof meaning !== 'string') {
    return '';
  }
  return meaning.trim().replace(/\s+/g, ' ').slice(0, MEANING_MAX_LENGTH);
}

function normalizeNotesValue(notes?: string): string | undefined {
  if (notes !== undefined && typeof notes !== 'string') {
    return undefined;
  }
  return notes?.trim().slice(0, NOTES_MAX_LENGTH);
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const currentState = normalizeState(card.state);
  const normalizedRating = normalizeRating(rating, currentState);
  const previousReps = normalizeCounter(card.reps);
  const previousLapses = normalizeCounter(card.lapses);
  const { createdAt, currentIso, updatedAt, dueAt } = normalizeTimeline(card, nowIso);
  const elapsedDays = normalizeElapsedDays(daysBetween(updatedAt, currentIso));
  const scheduledDays = daysBetween(updatedAt, dueAt);
  const previousScheduledDays = normalizeScheduledDays(scheduledDays, currentState);
  const state = nextState(currentState, normalizedRating);
  const phase = currentState;
  const lapseIncrement = shouldCountLapse(currentState, normalizedRating) ? 1 : 0;
  const previousDifficulty = clampFinite(
    card.difficulty,
    DIFFICULTY_MIN,
    DIFFICULTY_MAX,
    DIFFICULTY_MEAN_REVERSION,
  );
  const previousStability = effectivePreviousStability(card.stability, previousScheduledDays, phase);

  const nextDifficulty = nextDifficultyForPhase(previousDifficulty, currentState, normalizedRating);
  const nextStability = updateStability(
    previousStability,
    previousDifficulty,
    normalizedRating,
    elapsedDays,
    phase,
    previousScheduledDays,
  );

  let nextScheduledDays: number;

  if (state === 'learning') {
    nextScheduledDays = learningIntervalDays(normalizedRating);
  } else if (state === 'relearning') {
    nextScheduledDays = relearningIntervalDays(normalizedRating);
  } else if (phase !== 'review') {
    nextScheduledDays = graduationIntervalDays(normalizedRating);
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
  const nextDueAt = addDaysIso(currentIso, safeScheduledDays);
  const normalizedText = normalizeCardText(card);

  return {
    scheduledDays: safeScheduledDays,
    card: {
      ...card,
      ...normalizedText,
      createdAt,
      state,
      difficulty: nextDifficulty,
      stability: nextStability,
      reps: Math.min(COUNTER_MAX, previousReps + 1),
      lapses: Math.min(COUNTER_MAX, previousLapses + lapseIncrement),
      updatedAt: currentIso,
      dueAt: nextDueAt,
    },
  };
}

export function previewIntervals(card: Card, nowIso: string): RatingIntervalPreview {
  const { currentIso } = normalizeTimeline(card, nowIso);
  const preview = {
    1: reviewCard(card, 1, currentIso).scheduledDays,
    2: reviewCard(card, 2, currentIso).scheduledDays,
    3: reviewCard(card, 3, currentIso).scheduledDays,
    4: reviewCard(card, 4, currentIso).scheduledDays,
  };

  return ensureOrderedPreview(preview);
}

export function createNewCard(word: string, meaning: string, nowIso: string, notes?: string): Card {
  const wallClockMs = safeNowMs();
  const requestedCreatedMs = isValidIso(nowIso) ? Date.parse(nowIso) : Number.NaN;
  // Preserve realistic historical import timestamps, but reject pathological clock skew.
  const createOffsetMs = requestedCreatedMs - wallClockMs;
  const requestedIsPlausible =
    Number.isFinite(requestedCreatedMs) &&
    Number.isFinite(wallClockMs) &&
    Math.abs(createOffsetMs) <= MAX_CREATE_TIME_OFFSET_MS;
  const safeCreatedMs = requestedIsPlausible ? requestedCreatedMs : wallClockMs;
  const createdAt = toSafeIso(safeCreatedMs);
  const trimmedWord = normalizeWordValue(word);
  const trimmedMeaning = normalizeMeaningValue(meaning);
  const trimmedNotes = normalizeNotesValue(notes);
  const createdAtMs = Date.parse(createdAt);
  cardIdSequence = cardIdSequence >= COUNTER_MAX ? 1 : cardIdSequence + 1;
  const uniqueSuffix = cardIdSequence.toString(36);
  const runtimeSalt = safeNowMs().toString(36);

  return {
    id: `${Number.isFinite(createdAtMs) ? createdAtMs : safeNowMs()}-${runtimeSalt}-${uniqueSuffix}`,
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
