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

export interface ReviewResult {
  card: Card;
  scheduledDays: number;
}

export type RatingIntervalPreview = Record<Rating, number>;

type SchedulerPhase = 'learning' | 'review' | 'relearning';

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
  const candidate = isValidIso(requestedNowIso) ? requestedNowIso : fallback;
  const candidateMs = Date.parse(candidate);
  const fallbackMs = Date.parse(fallback);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(fallbackMs)) {
    return fallback;
  }

  // Keep review time monotonic to avoid negative elapsed intervals on clock drift.
  return candidateMs < fallbackMs ? fallback : candidate;
}

function normalizeRating(input: Rating): Rating {
  if (input <= 1) {
    return 1;
  }
  if (input >= 4) {
    return 4;
  }
  return input === 2 ? 2 : 3;
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

function scheduleFloorForState(state: ReviewState): number {
  if (state === 'review') {
    return 1;
  }
  if (state === 'relearning') {
    return 10 * MINUTE_IN_DAYS;
  }
  return MINUTE_IN_DAYS;
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

function reviewIntervalDays(
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

  // Keep "Good" on-time reviews from shrinking the schedule due to rounding/noise.
  if (phase === 'review' && rating === 3 && elapsed >= scheduled) {
    floorFromSchedule = Math.max(floorFromSchedule, Math.ceil(scheduled));
  }

  return clamp(Math.max(rawInterval, floorFromSchedule), 1, STABILITY_MAX);
}

function graduationIntervalDays(phase: SchedulerPhase, rating: Rating, reps: number): number {
  if (phase === 'relearning') {
    return rating === 4 ? 1 : 0.5;
  }
  if (rating === 4) {
    return reps === 0 ? 1 : 2;
  }
  return reps === 0 ? 0.5 : 1;
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const normalizedRating = normalizeRating(rating);
  const currentState = normalizeState(card.state);
  const previousReps = normalizeCounter(card.reps);
  const previousLapses = normalizeCounter(card.lapses);
  const currentIso = resolveReviewIso(card.updatedAt, nowIso);
  const updatedAt = isValidIso(card.updatedAt) ? card.updatedAt : currentIso;
  const dueAt = isValidIso(card.dueAt) ? card.dueAt : updatedAt;
  const elapsedDays = daysBetween(updatedAt, currentIso);
  const scheduledDays = daysBetween(updatedAt, dueAt);
  const previousScheduledDays = Math.max(scheduledDays, scheduleFloorForState(currentState));
  const state = nextState(currentState, normalizedRating);
  const phase = currentState;

  const nextDifficulty = updateDifficulty(card.difficulty, normalizedRating);
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
    nextScheduledDays = graduationIntervalDays(phase, normalizedRating, previousReps);
  } else {
    nextScheduledDays = reviewIntervalDays(nextStability, normalizedRating, elapsedDays, previousScheduledDays, phase);
  }

  const nextDueAt = addDaysIso(currentIso, nextScheduledDays);

  return {
    scheduledDays: nextScheduledDays,
    card: {
      ...card,
      state,
      difficulty: nextDifficulty,
      stability: nextStability,
      reps: previousReps + 1,
      lapses: previousLapses + (normalizedRating === 1 ? 1 : 0),
      updatedAt: currentIso,
      dueAt: nextDueAt,
    },
  };
}

export function previewIntervals(card: Card, nowIso: string): RatingIntervalPreview {
  return {
    1: reviewCard(card, 1, nowIso).scheduledDays,
    2: reviewCard(card, 2, nowIso).scheduledDays,
    3: reviewCard(card, 3, nowIso).scheduledDays,
    4: reviewCard(card, 4, nowIso).scheduledDays,
  };
}

export function createNewCard(word: string, meaning: string, nowIso: string, notes?: string): Card {
  const createdAt = isValidIso(nowIso) ? nowIso : currentNowIso();
  const trimmedWord = word.trim();
  const trimmedMeaning = meaning.trim();

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
