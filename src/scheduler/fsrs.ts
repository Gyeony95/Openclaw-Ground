import { Card, Rating, ReviewState } from '../types';
import { addDaysIso, daysBetween, nowIso as currentNowIso } from '../utils/time';
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MEAN_REVERSION,
  DIFFICULTY_MIN,
  MINUTE_IN_DAYS,
  STABILITY_MAX,
  STABILITY_MIN,
} from './constants';

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;
const ON_TIME_TOLERANCE_DAYS = MINUTE_IN_DAYS;
const MAX_MONOTONIC_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;

export interface ReviewResult {
  card: Card;
  scheduledDays: number;
}

export type RatingIntervalPreview = Record<Rating, number>;

type SchedulerPhase = 'learning' | 'review' | 'relearning';
type ReviewIntervalsByRating = Record<2 | 3 | 4, number>;
const REVIEW_SCHEDULE_FLOOR_DAYS = 0.5;

let cardIdSequence = 0;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const wallClockIso = currentNowIso();
  const wallClockMs = Date.parse(wallClockIso);
  const fallbackMs = Date.parse(fallback);
  if (
    !requestedValid &&
    Number.isFinite(fallbackMs) &&
    Number.isFinite(wallClockMs) &&
    fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS
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

  // Keep review time monotonic to avoid negative elapsed intervals on clock drift.
  if (candidateMs < fallbackMs) {
    const skewMs = fallbackMs - candidateMs;
    if (skewMs <= MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return fallback;
    }

    // Only roll backward when the card timestamp itself looks corrupted far into the future.
    if (Number.isFinite(wallClockMs) && fallbackMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return candidate;
    }
    return fallback;
  }
  return candidate;
}

function normalizeRating(input: Rating): Rating {
  if (!Number.isFinite(input)) {
    return 1;
  }

  const rounded = Math.round(input);
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
  const fallback = currentNowIso();
  const createdAt = isValidIso(card.createdAt)
    ? card.createdAt
    : isValidIso(card.updatedAt)
      ? card.updatedAt
      : isValidIso(card.dueAt)
        ? card.dueAt
        : fallback;
  const rawUpdatedAt = isValidIso(card.updatedAt) ? card.updatedAt : createdAt;
  const createdMs = Date.parse(createdAt);
  const updatedMs = Date.parse(rawUpdatedAt);
  const updatedAt = new Date(Math.max(createdMs, updatedMs)).toISOString();
  const rawDueAt = isValidIso(card.dueAt) ? card.dueAt : updatedAt;
  const dueAt = new Date(Math.max(Date.parse(rawDueAt), Date.parse(updatedAt))).toISOString();
  const resolvedCurrentIso = resolveReviewIso(updatedAt, requestedNowIso);
  const currentIso = new Date(Math.max(Date.parse(resolvedCurrentIso), createdMs)).toISOString();

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
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function scheduleFallbackForState(state: ReviewState): number {
  if (state === 'review') {
    return 1;
  }
  if (state === 'relearning') {
    return 10 * MINUTE_IN_DAYS;
  }
  return MINUTE_IN_DAYS;
}

function normalizeScheduledDays(value: number, state: ReviewState): number {
  if (Number.isFinite(value) && value > 0) {
    const normalized = Math.max(value, MINUTE_IN_DAYS);
    if (state === 'review') {
      return Math.max(normalized, REVIEW_SCHEDULE_FLOOR_DAYS);
    }
    return normalized;
  }
  return scheduleFallbackForState(state);
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
      return 10 * MINUTE_IN_DAYS;
    default:
      return 10 * MINUTE_IN_DAYS;
  }
}

function relearningIntervalDays(rating: Rating): number {
  switch (rating) {
    case 1:
      return 10 * MINUTE_IN_DAYS;
    case 2:
      return 30 * MINUTE_IN_DAYS;
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
  return clamp(interval, 1, STABILITY_MAX);
}

function updateDifficulty(prevDifficulty: number, rating: Rating): number {
  const previous = clampFinite(prevDifficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_MEAN_REVERSION);
  const ratingShift = rating === 4 ? -0.45 : rating === 3 ? -0.1 : rating === 2 ? 0.15 : 0.6;
  const meanReversion = (DIFFICULTY_MEAN_REVERSION - previous) * 0.08;
  return clamp(previous + ratingShift + meanReversion, DIFFICULTY_MIN, DIFFICULTY_MAX);
}

function nextDifficultyForPhase(prevDifficulty: number, currentState: ReviewState, rating: Rating): number {
  // Learning misses are short-step retries and should not permanently harden card difficulty.
  if (currentState === 'learning' && rating <= 2) {
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
  const previous = clampFinite(prevStability, STABILITY_MIN, STABILITY_MAX, 0.5);
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
    return clamp((previous * forgetPenalty) / overdueFailurePenalty, STABILITY_MIN, STABILITY_MAX);
  }

  if (rating === 2) {
    const hardGain = 1 + 0.12 * (1 - r) * difficultyFactor * timingRatio;
    return clamp(Math.max(previous + 0.05, previous * hardGain), STABILITY_MIN, STABILITY_MAX);
  }

  const recallGainBase = rating === 4 ? 0.9 : 0.62;
  const growth = 1 + recallGainBase * (1 - r) * difficultyFactor * timingRatio;

  return clamp(Math.max(previous + 0.1, previous * growth), STABILITY_MIN, STABILITY_MAX);
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
  const timingRatio = clamp(elapsed / scheduled, 0.5, 2.5);
  const timingScale = phase === 'review' ? clamp(0.75 + timingRatio * 0.25, 0.75, 1.35) : 1;
  const rawInterval = clamp(Math.round(baseInterval * ratingScale * timingScale), 1, STABILITY_MAX);
  let floorFromSchedule = rating === 4 ? Math.ceil(scheduled) : 1;

  // Hard recalls should not shrink the schedule when the card was reviewed on-time or later.
  if (phase === 'review' && rating === 2 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, Math.ceil(scheduled));
  }

  // Keep "Good" on-time reviews from shrinking the schedule due to rounding/noise.
  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, Math.ceil(scheduled));
  }

  const flooredInterval = Math.max(rawInterval, floorFromSchedule);

  // Keep "Hard" reviews conservative even when cards are heavily overdue.
  if (phase === 'review' && rating === 2) {
    const hardCap = Math.max(1, Math.ceil(scheduled * 1.2));
    return clamp(Math.min(flooredInterval, hardCap), 1, STABILITY_MAX);
  }

  return clamp(flooredInterval, 1, STABILITY_MAX);
}

function orderedReviewIntervals(
  nextStability: number,
  elapsedDays: number,
  scheduledDays: number,
  phase: SchedulerPhase,
): ReviewIntervalsByRating {
  const hard = rawReviewIntervalDays(nextStability, 2, elapsedDays, scheduledDays, phase);
  const good = rawReviewIntervalDays(nextStability, 3, elapsedDays, scheduledDays, phase);
  const easy = rawReviewIntervalDays(nextStability, 4, elapsedDays, scheduledDays, phase);
  return {
    2: hard,
    3: clamp(Math.max(good, hard), 1, STABILITY_MAX),
    4: clamp(Math.max(easy, good, hard), 1, STABILITY_MAX),
  };
}

function graduationIntervalDays(rating: Rating): number {
  return rating === 4 ? 1 : 0.5;
}

function ensureOrderedPreview(intervals: RatingIntervalPreview): RatingIntervalPreview {
  const again = intervals[1];
  const hard = Math.max(intervals[2], again);
  const good = Math.max(intervals[3], hard);
  const easy = Math.max(intervals[4], good);
  return {
    1: again,
    2: hard,
    3: good,
    4: easy,
  };
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const normalizedRating = normalizeRating(rating);
  const currentState = normalizeState(card.state);
  const previousReps = normalizeCounter(card.reps);
  const previousLapses = normalizeCounter(card.lapses);
  const { createdAt, currentIso, updatedAt, dueAt } = normalizeTimeline(card, nowIso);
  const elapsedDays = daysBetween(updatedAt, currentIso);
  const scheduledDays = daysBetween(updatedAt, dueAt);
  const previousScheduledDays = normalizeScheduledDays(scheduledDays, currentState);
  const state = nextState(currentState, normalizedRating);
  const phase = currentState;
  const lapseIncrement = shouldCountLapse(currentState, normalizedRating) ? 1 : 0;

  const nextDifficulty = nextDifficultyForPhase(card.difficulty, currentState, normalizedRating);
  const nextStability = updateStability(
    card.stability,
    card.difficulty,
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
    const intervals = orderedReviewIntervals(nextStability, elapsedDays, previousScheduledDays, phase);
    nextScheduledDays = intervals[toReviewRating(normalizedRating)];
  }

  const safeScheduledDays = normalizeScheduledDays(nextScheduledDays, state);
  const nextDueAt = addDaysIso(currentIso, safeScheduledDays);

  return {
    scheduledDays: safeScheduledDays,
    card: {
      ...card,
      createdAt,
      state,
      difficulty: nextDifficulty,
      stability: nextStability,
      reps: previousReps + 1,
      lapses: previousLapses + lapseIncrement,
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
  const createdAt = isValidIso(nowIso) ? nowIso : currentNowIso();
  const trimmedWord = word.trim();
  const trimmedMeaning = meaning.trim();
  const createdAtMs = Date.parse(createdAt);
  cardIdSequence = (cardIdSequence + 1) % 1_000_000;
  const uniqueSuffix = `${cardIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: `${Number.isFinite(createdAtMs) ? createdAtMs : Date.now()}-${uniqueSuffix}`,
    word: trimmedWord,
    meaning: trimmedMeaning,
    notes: notes?.trim() || undefined,
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
