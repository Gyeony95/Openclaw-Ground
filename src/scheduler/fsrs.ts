import { Card, Rating, ReviewState } from '../types';
import { addDaysIso, daysBetween } from '../utils/time';

const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 10;
const STABILITY_MIN = 0.1;

export interface ReviewResult {
  card: Card;
  scheduledDays: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextState(current: ReviewState, rating: Rating): ReviewState {
  if (rating === 1) {
    return 'relearning';
  }
  if (current === 'learning' && rating >= 3) {
    return 'review';
  }
  if (current === 'relearning' && rating >= 3) {
    return 'review';
  }
  return current;
}

function intervalFromStability(stability: number): number {
  return Math.max(1, Math.round(stability));
}

function updateDifficulty(prevDifficulty: number, rating: Rating): number {
  const adjustment = rating === 4 ? -0.35 : rating === 3 ? -0.05 : rating === 2 ? 0.25 : 0.7;
  return clamp(prevDifficulty + adjustment, DIFFICULTY_MIN, DIFFICULTY_MAX);
}

function updateStability(
  prevStability: number,
  prevDifficulty: number,
  rating: Rating,
  elapsedDays: number,
  wasReview: boolean,
): number {
  if (rating === 1) {
    return STABILITY_MIN;
  }

  if (rating === 2) {
    return clamp(Math.max(0.3, prevStability * 0.6), STABILITY_MIN, 3650);
  }

  const retrievabilityPenalty = wasReview && elapsedDays > prevStability ? 0.85 : 1;
  const gainBase = rating === 4 ? 0.34 : 0.2;
  const difficultyFactor = (11 - prevDifficulty) / 10;
  const elapsedBoost = 1 + Math.min(elapsedDays / Math.max(prevStability, 1), 1.5) * 0.1;
  const growth = 1 + gainBase * difficultyFactor * retrievabilityPenalty * elapsedBoost;

  return clamp(Math.max(prevStability + 0.2, prevStability * growth), STABILITY_MIN, 3650);
}

function initialInterval(rating: Rating): number {
  switch (rating) {
    case 1:
      return 0;
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 4;
    default:
      return 1;
  }
}

export function reviewCard(card: Card, rating: Rating, nowIso: string): ReviewResult {
  const elapsedDays = daysBetween(card.updatedAt, nowIso);
  const wasReview = card.state === 'review';

  const nextDifficulty = updateDifficulty(card.difficulty, rating);
  const nextStability = updateStability(card.stability, card.difficulty, rating, elapsedDays, wasReview);
  const state = nextState(card.state, rating);

  let scheduledDays: number;

  if (card.reps === 0 || card.state === 'learning') {
    scheduledDays = initialInterval(rating);
  } else if (state === 'relearning') {
    scheduledDays = rating <= 2 ? 0 : 1;
  } else {
    const baseInterval = intervalFromStability(nextStability);
    scheduledDays = rating === 2 ? Math.max(1, Math.floor(baseInterval * 0.5)) : baseInterval;
  }

  const dueAt = addDaysIso(nowIso, scheduledDays);

  return {
    scheduledDays,
    card: {
      ...card,
      state,
      difficulty: nextDifficulty,
      stability: nextStability,
      reps: card.reps + 1,
      lapses: card.lapses + (rating === 1 ? 1 : 0),
      updatedAt: nowIso,
      dueAt,
    },
  };
}

export function createNewCard(word: string, meaning: string, nowIso: string, notes?: string): Card {
  const trimmedWord = word.trim();
  const trimmedMeaning = meaning.trim();

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    word: trimmedWord,
    meaning: trimmedMeaning,
    notes: notes?.trim() || undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
    dueAt: nowIso,
    state: 'learning',
    reps: 0,
    lapses: 0,
    stability: 0.5,
    difficulty: 5,
  };
}
