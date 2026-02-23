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
export interface ReviewResult {
  card: Card;
  scheduledDays: number;
}

export type RatingIntervalPreview = Record<Rating, number>;

type SchedulerPhase = 'learning' | 'review' | 'relearning';
type ReviewIntervalsByRating = Record<2 | 3 | 4, number>;
const REVIEW_SCHEDULE_FLOOR_DAYS = 0.5;
const RELEARNING_SCHEDULE_FLOOR_DAYS = 10 * MINUTE_IN_DAYS;
const COUNTER_MAX = Number.MAX_SAFE_INTEGER;

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
  const fallbackMs = Date.parse(fallback);
  const dueMs = isValidIso(card.dueAt) ? Date.parse(card.dueAt) : Number.NaN;
  const safeDueAsCreatedAt =
    Number.isFinite(dueMs) && Number.isFinite(fallbackMs) && dueMs - fallbackMs <= MAX_MONOTONIC_CLOCK_SKEW_MS
      ? card.dueAt
      : undefined;
  let createdAt = isValidIso(card.createdAt)
    ? card.createdAt
    : isValidIso(card.updatedAt)
      ? card.updatedAt
      : safeDueAsCreatedAt ?? fallback;
  const requestedMs = isValidIso(requestedNowIso) ? Date.parse(requestedNowIso) : Number.NaN;
  const updatedMsCandidate = isValidIso(card.updatedAt) ? Date.parse(card.updatedAt) : Number.NaN;
  const anchorCandidates = [updatedMsCandidate, dueMs, requestedMs, fallbackMs].filter((value) =>
    Number.isFinite(value),
  );
  const earliestAnchorMs = anchorCandidates.length > 0 ? Math.min(...anchorCandidates) : fallbackMs;
  const createdMsCandidate = Date.parse(createdAt);
  if (Number.isFinite(createdMsCandidate) && createdMsCandidate - earliestAnchorMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
    createdAt = new Date(earliestAnchorMs).toISOString();
  }
  const normalizedCreatedMs = Date.parse(createdAt);
  createdAt = new Date(Number.isFinite(normalizedCreatedMs) ? normalizedCreatedMs : fallbackMs).toISOString();
  const rawUpdatedAt = isValidIso(card.updatedAt) ? card.updatedAt : createdAt;
  const updatedMs = Date.parse(rawUpdatedAt);
  const fallbackUpdatedMs = Date.parse(createdAt);
  const updatedAt = new Date(Number.isFinite(updatedMs) ? updatedMs : fallbackUpdatedMs).toISOString();
  if (Date.parse(createdAt) > Date.parse(updatedAt)) {
    createdAt = updatedAt;
  }
  const normalizedState = normalizeState(card.state);
  const fallbackDueDays =
    normalizedState === 'review'
      ? normalizeScheduledDays(card.stability, 'review')
      : scheduleFallbackForState(normalizedState);
  const fallbackDueAt = addDaysIso(updatedAt, fallbackDueDays);
  const rawDueAt = isValidIso(card.dueAt) ? card.dueAt : fallbackDueAt;
  const dueAt = new Date(Math.max(Date.parse(rawDueAt), Date.parse(updatedAt))).toISOString();
  const resolvedCurrentIso = resolveReviewIso(updatedAt, requestedNowIso);
  const resolvedCurrentMs = Date.parse(resolvedCurrentIso);
  const updatedAtMs = Date.parse(updatedAt);
  const wallClockMs = Date.parse(currentNowIso());
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
      ? new Date(resolvedCurrentMs).toISOString()
      : new Date(monotonicMs).toISOString();

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

function normalizeScheduledDays(value: number, state: ReviewState): number {
  if (Number.isFinite(value) && value > 0) {
    const normalized = clamp(value, MINUTE_IN_DAYS, STABILITY_MAX);
    if (state === 'review') {
      return Math.max(normalized, REVIEW_SCHEDULE_FLOOR_DAYS);
    }
    if (state === 'relearning') {
      return Math.max(normalized, RELEARNING_SCHEDULE_FLOOR_DAYS);
    }
    return normalized;
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
  const minReviewInterval = safeScheduledDays < 1 ? REVIEW_SCHEDULE_FLOOR_DAYS : 1;
  const safeIntervalDays = Number.isFinite(intervalDays) ? intervalDays : safeScheduledDays;

  if (safeScheduledDays < 1) {
    const halfDayQuantized = Math.round(safeIntervalDays * 2) / 2;
    return clamp(halfDayQuantized, minReviewInterval, STABILITY_MAX);
  }
  return clamp(Math.round(safeIntervalDays), minReviewInterval, STABILITY_MAX);
}

function updateDifficulty(prevDifficulty: number, rating: Rating): number {
  const previous = clampFinite(prevDifficulty, DIFFICULTY_MIN, DIFFICULTY_MAX, DIFFICULTY_MEAN_REVERSION);
  const ratingShift = rating === 4 ? -0.45 : rating === 3 ? -0.1 : rating === 2 ? 0.15 : 0.6;
  const meanReversion = (DIFFICULTY_MEAN_REVERSION - previous) * 0.08;
  return clamp(previous + ratingShift + meanReversion, DIFFICULTY_MIN, DIFFICULTY_MAX);
}

function nextDifficultyForPhase(prevDifficulty: number, currentState: ReviewState, rating: Rating): number {
  // Non-review "Again" steps are short retries and should not harden long-term card difficulty.
  if (currentState !== 'review' && rating === 1) {
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
  const rawInterval = quantizeReviewIntervalDays(baseInterval * ratingScale * timingScale, scheduled);
  const scheduleFloor = scheduled < 1 ? REVIEW_SCHEDULE_FLOOR_DAYS : Math.ceil(scheduled);
  let floorFromSchedule = rating === 4 ? scheduleFloor : REVIEW_SCHEDULE_FLOOR_DAYS;

  // Hard recalls should not shrink the schedule when the card was reviewed on-time or later.
  if (phase === 'review' && rating === 2 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, scheduleFloor);
  }

  // Keep "Good" on-time reviews from shrinking the schedule due to rounding/noise.
  if (phase === 'review' && rating === 3 && elapsed + ON_TIME_TOLERANCE_DAYS >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, scheduleFloor);
  }

  const flooredInterval = quantizeReviewIntervalDays(Math.max(rawInterval, floorFromSchedule), scheduled);

  // Keep "Hard" reviews conservative even when cards are heavily overdue.
  if (phase === 'review' && rating === 2) {
    const reviewedEarly = elapsed + ON_TIME_TOLERANCE_DAYS < scheduled;
    const earlyCap = scheduled < 1 ? REVIEW_SCHEDULE_FLOOR_DAYS : Math.max(1, Math.floor(scheduled));
    // Keep sub-day review cards on sub-day cadence for "Hard" even when reviewed on time.
    const onTimeOrLateCap = scheduled < 1 ? REVIEW_SCHEDULE_FLOOR_DAYS : Math.max(1, Math.ceil(scheduled * 1.2));
    const hardCap = reviewedEarly ? earlyCap : onTimeOrLateCap;
    return quantizeReviewIntervalDays(Math.min(flooredInterval, hardCap), scheduled);
  }

  return quantizeReviewIntervalDays(flooredInterval, scheduled);
}

function orderedReviewIntervals(
  prevStability: number,
  prevDifficulty: number,
  elapsedDays: number,
  scheduledDays: number,
  phase: SchedulerPhase,
): ReviewIntervalsByRating {
  const hardStability = updateStability(prevStability, prevDifficulty, 2, elapsedDays, phase, scheduledDays);
  const goodStability = updateStability(prevStability, prevDifficulty, 3, elapsedDays, phase, scheduledDays);
  const easyStability = updateStability(prevStability, prevDifficulty, 4, elapsedDays, phase, scheduledDays);

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
  return word.trim().slice(0, WORD_MAX_LENGTH);
}

function normalizeMeaningValue(meaning: string): string {
  if (typeof meaning !== 'string') {
    return '';
  }
  return meaning.trim().slice(0, MEANING_MAX_LENGTH);
}

function normalizeNotesValue(notes?: string): string | undefined {
  if (notes !== undefined && typeof notes !== 'string') {
    return undefined;
  }
  return notes?.trim().slice(0, NOTES_MAX_LENGTH);
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const normalizedRating = normalizeRating(rating);
  const currentState = normalizeState(card.state);
  const previousReps = normalizeCounter(card.reps);
  const previousLapses = normalizeCounter(card.lapses);
  const { createdAt, currentIso, updatedAt, dueAt } = normalizeTimeline(card, nowIso);
  const elapsedDays = normalizeElapsedDays(daysBetween(updatedAt, currentIso));
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
    const intervals = orderedReviewIntervals(
      card.stability,
      card.difficulty,
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
  const createdAtInput = isValidIso(nowIso) ? nowIso : currentNowIso();
  const createdAt = new Date(Date.parse(createdAtInput)).toISOString();
  const trimmedWord = normalizeWordValue(word);
  const trimmedMeaning = normalizeMeaningValue(meaning);
  const trimmedNotes = normalizeNotesValue(notes);
  const createdAtMs = Date.parse(createdAt);
  cardIdSequence = (cardIdSequence + 1) % 1_000_000;
  const uniqueSuffix = `${cardIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: `${Number.isFinite(createdAtMs) ? createdAtMs : Date.now()}-${uniqueSuffix}`,
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
