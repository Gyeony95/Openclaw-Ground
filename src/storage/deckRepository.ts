import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  MEANING_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  STABILITY_MAX,
  STABILITY_MIN,
  WORD_MAX_LENGTH,
} from '../scheduler/constants';
import { Card, Deck, DeckStats, ReviewState } from '../types';
import { isDue, nowIso } from '../utils/time';

const KEY = 'word_memorizer.deck.v1';
const MAX_MONOTONIC_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORICAL_TIMESTAMP_AGE_MS = 20 * 365 * DAY_MS;
const MAX_ANCHOR_DISTANCE_FROM_WALL_MS = MAX_HISTORICAL_TIMESTAMP_AGE_MS;
const MINUTE_IN_DAYS = 1 / 1440;
const LEARNING_SCHEDULE_FALLBACK_DAYS = MINUTE_IN_DAYS;
const RELEARNING_SCHEDULE_FALLBACK_DAYS = 10 * MINUTE_IN_DAYS;
const LEARNING_MAX_SCHEDULE_DAYS = 1;
const RELEARNING_MAX_SCHEDULE_DAYS = 2;
const REVIEW_SCHEDULE_FLOOR_DAYS = 0.5;
const REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS = 7;
const NON_REVIEW_OUTLIER_MULTIPLIER = 6;

const VALID_STATES: ReviewState[] = ['learning', 'review', 'relearning'];
type CounterNormalizationMode = 'sanitize' | 'saturate';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeInt(
  value: unknown,
  fallback: number,
  mode: CounterNormalizationMode = 'sanitize',
): number {
  if (typeof value !== 'number') {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    if (mode === 'saturate' && value === Number.POSITIVE_INFINITY) {
      return COUNTER_MAX;
    }
    return fallback;
  }
  return clamp(Math.floor(value), 0, COUNTER_MAX);
}

function isValidState(state: unknown): state is ReviewState {
  return typeof state === 'string' && VALID_STATES.includes(state as ReviewState);
}

function normalizeState(state: unknown): ReviewState {
  if (isValidState(state)) {
    return state;
  }
  if (typeof state === 'string') {
    const normalized = state.trim().toLowerCase();
    if (isValidState(normalized)) {
      return normalized;
    }
  }
  return 'learning';
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function toCanonicalIso(iso: string): string {
  return new Date(Date.parse(iso)).toISOString();
}

function isDueOrInvalid(dueAt: string, currentIso: string): boolean {
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) {
    return true;
  }
  return isDue(dueAt, currentIso);
}

function parseTimeOrMin(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function scheduleFallbackForState(state: ReviewState): number {
  if (state === 'review') {
    return REVIEW_SCHEDULE_FLOOR_DAYS;
  }
  if (state === 'relearning') {
    return RELEARNING_SCHEDULE_FALLBACK_DAYS;
  }
  return LEARNING_SCHEDULE_FALLBACK_DAYS;
}

function maxScheduleDaysForState(state: ReviewState): number {
  if (state === 'review') {
    return STABILITY_MAX;
  }
  if (state === 'relearning') {
    return RELEARNING_MAX_SCHEDULE_DAYS;
  }
  return LEARNING_MAX_SCHEDULE_DAYS;
}

function pickFreshestDuplicate(existing: Card, incoming: Card): Card {
  const existingUpdated = parseTimeOrMin(existing.updatedAt);
  const incomingUpdated = parseTimeOrMin(incoming.updatedAt);
  if (incomingUpdated > existingUpdated) {
    return incoming;
  }
  if (incomingUpdated < existingUpdated) {
    return existing;
  }

  // When timestamps tie, preserve the branch with more review history.
  if (incoming.reps > existing.reps) {
    return incoming;
  }
  if (incoming.reps < existing.reps) {
    return existing;
  }

  if (incoming.lapses > existing.lapses) {
    return incoming;
  }
  if (incoming.lapses < existing.lapses) {
    return existing;
  }

  const existingDue = parseTimeOrMin(existing.dueAt);
  const incomingDue = parseTimeOrMin(incoming.dueAt);
  // On full ties, keep the earlier due card to avoid postponing overdue work.
  if (incomingDue < existingDue) {
    return incoming;
  }
  if (incomingDue > existingDue) {
    return existing;
  }

  const existingCreated = parseTimeOrMin(existing.createdAt);
  const incomingCreated = parseTimeOrMin(incoming.createdAt);
  if (incomingCreated < existingCreated) {
    return incoming;
  }
  return existing;
}

function normalizeCard(raw: Partial<Card>, counterMode: CounterNormalizationMode = 'sanitize'): Card | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const wordValue =
    typeof raw.word === 'string' ? raw.word.trim().replace(/\s+/g, ' ').slice(0, WORD_MAX_LENGTH) : '';
  const meaningValue =
    typeof raw.meaning === 'string' ? raw.meaning.trim().replace(/\s+/g, ' ').slice(0, MEANING_MAX_LENGTH) : '';
  const notesValue =
    typeof raw.notes === 'string'
      ? raw.notes.trim().replace(/\s+/g, ' ').slice(0, NOTES_MAX_LENGTH)
      : '';
  const state = normalizeState(raw.state);
  if (
    !id ||
    !wordValue ||
    !meaningValue
  ) {
    return null;
  }

  const wallClockIso = nowIso();
  const wallClockMs = Date.parse(wallClockIso);
  const dueCandidate = isValidIso(raw.dueAt) ? raw.dueAt : null;
  const dueCandidateMs = dueCandidate ? Date.parse(dueCandidate) : Number.NaN;
  const safeDueAsAnchor =
    dueCandidate &&
    Number.isFinite(dueCandidateMs) &&
    Number.isFinite(wallClockMs) &&
    Math.abs(dueCandidateMs - wallClockMs) <= MAX_ANCHOR_DISTANCE_FROM_WALL_MS
      ? dueCandidate
      : null;
  const createdAt = isValidIso(raw.createdAt)
    ? raw.createdAt
    : isValidIso(raw.updatedAt)
      ? raw.updatedAt
      : safeDueAsAnchor;
  if (!createdAt) {
    return null;
  }

  const normalizeWallSafeTimestamp = (candidateIso: string): number => {
    const candidateMs = Date.parse(candidateIso);
    if (!Number.isFinite(candidateMs)) {
      return wallClockMs;
    }
    if (candidateMs - wallClockMs > MAX_MONOTONIC_CLOCK_SKEW_MS) {
      return wallClockMs;
    }
    if (wallClockMs - candidateMs > MAX_HISTORICAL_TIMESTAMP_AGE_MS) {
      return wallClockMs;
    }
    return candidateMs;
  };

  const normalizedCreatedMs = normalizeWallSafeTimestamp(createdAt);
  const normalizedCreatedAt = new Date(normalizedCreatedMs).toISOString();
  const updatedAt = isValidIso(raw.updatedAt) ? raw.updatedAt : normalizedCreatedAt;
  const dueIsValid = isValidIso(raw.dueAt);
  const dueAt = dueIsValid ? raw.dueAt : updatedAt;
  const normalizedStability = clamp(asFiniteNumber(raw.stability) ?? 0.5, STABILITY_MIN, STABILITY_MAX);
  const createdMs = Date.parse(normalizedCreatedAt);
  const updatedMs = normalizeWallSafeTimestamp(updatedAt);
  const dueMs = Date.parse(dueAt);
  const normalizedUpdatedMs = Math.max(updatedMs, createdMs);
  const normalizedUpdatedAt = new Date(normalizedUpdatedMs).toISOString();
  let normalizedDueMs = Math.max(dueMs, normalizedUpdatedMs);
  let scheduleDays = (normalizedDueMs - normalizedUpdatedMs) / DAY_MS;
  if (scheduleDays <= 0) {
    const shouldUseReviewStabilityFallback =
      state === 'review' &&
      Number.isFinite(normalizedStability);
    const fallbackDays = shouldUseReviewStabilityFallback
      ? clamp(
          normalizedStability,
          REVIEW_SCHEDULE_FLOOR_DAYS,
          REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
        )
      : scheduleFallbackForState(state);
    normalizedDueMs = normalizedUpdatedMs + fallbackDays * DAY_MS;
    scheduleDays = (normalizedDueMs - normalizedUpdatedMs) / DAY_MS;
  }
  if (state === 'review' && scheduleDays < REVIEW_SCHEDULE_FLOOR_DAYS) {
    const repairedReviewDays = clamp(
      normalizedStability,
      REVIEW_SCHEDULE_FLOOR_DAYS,
      REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
    );
    normalizedDueMs = normalizedUpdatedMs + repairedReviewDays * DAY_MS;
    scheduleDays = repairedReviewDays;
  }
  const maxScheduleDays = maxScheduleDaysForState(state);
  if (scheduleDays > maxScheduleDays) {
    const isModerateNonReviewOutlier =
      state !== 'review' &&
      Number.isFinite(scheduleDays) &&
      scheduleDays <= maxScheduleDays * NON_REVIEW_OUTLIER_MULTIPLIER;
    if (state === 'review') {
      normalizedDueMs = normalizedUpdatedMs + STABILITY_MAX * DAY_MS;
    } else if (isModerateNonReviewOutlier) {
      normalizedDueMs = normalizedUpdatedMs + maxScheduleDays * DAY_MS;
    } else {
      normalizedDueMs = normalizedUpdatedMs + scheduleFallbackForState(state) * DAY_MS;
    }
    scheduleDays = (normalizedDueMs - normalizedUpdatedMs) / DAY_MS;
  }
  const reviewScheduleCapDays = Math.max(REVIEW_SCHEDULE_FLOOR_DAYS, normalizedStability * 6, 30);
  if (state === 'review' && scheduleDays > reviewScheduleCapDays) {
    const repairedReviewDays = clamp(
      normalizedStability,
      REVIEW_SCHEDULE_FLOOR_DAYS,
      REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
    );
    normalizedDueMs = normalizedUpdatedMs + repairedReviewDays * DAY_MS;
    scheduleDays = repairedReviewDays;
  }
  const normalizedDueAt = new Date(normalizedDueMs).toISOString();

  return {
    id,
    word: wordValue,
    meaning: meaningValue,
    notes: notesValue || undefined,
    dueAt: normalizedDueAt,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    state,
    reps: asNonNegativeInt(raw.reps, 0, counterMode),
    lapses: asNonNegativeInt(raw.lapses, 0, counterMode),
    stability: normalizedStability,
    difficulty: clamp(asFiniteNumber(raw.difficulty) ?? 5, DIFFICULTY_MIN, DIFFICULTY_MAX),
  };
}

export async function loadDeck(): Promise<Deck> {
  const serialized = await AsyncStorage.getItem(KEY);
  if (!serialized) {
    return { cards: [] };
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<Deck>;
    const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const cards = rawCards
      .map((item) => normalizeCard(item as Partial<Card>, 'sanitize'))
      .filter((item): item is Card => item !== null)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const dedupedById = new Map<string, Card>();
    for (const card of cards) {
      const existing = dedupedById.get(card.id);
      if (!existing) {
        dedupedById.set(card.id, card);
        continue;
      }
      dedupedById.set(card.id, pickFreshestDuplicate(existing, card));
    }
    const uniqueCards = [...dedupedById.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    return {
      cards: uniqueCards,
      lastReviewedAt: isValidIso(parsed.lastReviewedAt) ? toCanonicalIso(parsed.lastReviewedAt) : undefined,
    };
  } catch {
    return { cards: [] };
  }
}

export async function saveDeck(deck: Deck): Promise<void> {
  const normalizedCards = deck.cards
    .map((card) => normalizeCard(card, 'saturate'))
    .filter((card): card is Card => card !== null)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const dedupedById = new Map<string, Card>();
  for (const card of normalizedCards) {
    const existing = dedupedById.get(card.id);
    if (!existing) {
      dedupedById.set(card.id, card);
      continue;
    }
    dedupedById.set(card.id, pickFreshestDuplicate(existing, card));
  }
  const cards = [...dedupedById.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const safeDeck: Deck = {
    cards,
    lastReviewedAt: isValidIso(deck.lastReviewedAt) ? toCanonicalIso(deck.lastReviewedAt) : undefined,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(safeDeck));
}

export function computeDeckStats(cards: Card[], currentIso = nowIso()): DeckStats {
  return cards.reduce<DeckStats>(
    (acc, card) => {
      acc.total += 1;
      if (isDueOrInvalid(card.dueAt, currentIso)) {
        acc.dueNow += 1;
      }
      if (card.state === 'learning') {
        acc.learning += 1;
      }
      if (card.state === 'review') {
        acc.review += 1;
      }
      if (card.state === 'relearning') {
        acc.relearning += 1;
      }
      return acc;
    },
    { total: 0, dueNow: 0, learning: 0, review: 0, relearning: 0 },
  );
}
