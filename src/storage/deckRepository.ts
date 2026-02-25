import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DIFFICULTY_MAX,
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
} from '../scheduler/constants';
import { Card, Deck, DeckStats, ReviewState } from '../types';
import { isDue, isIsoDateTime, nowIso } from '../utils/time';
import { normalizeBoundedText } from '../utils/text';

const KEY = 'word_memorizer.deck.v1';
const MAX_MONOTONIC_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const COUNTER_MAX = Number.MAX_SAFE_INTEGER;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const HISTORICAL_LEAP_TOLERANCE_MS = 6 * DAY_MS;
const MAX_HISTORICAL_TIMESTAMP_AGE_MS = 20 * 365 * DAY_MS + HISTORICAL_LEAP_TOLERANCE_MS;
const MAX_ANCHOR_DISTANCE_FROM_WALL_MS = MAX_HISTORICAL_TIMESTAMP_AGE_MS;
const LEARNING_SCHEDULE_FALLBACK_DAYS = MINUTE_IN_DAYS;
const RELEARNING_SCHEDULE_FALLBACK_DAYS = 10 * MINUTE_IN_DAYS;
const LEARNING_MAX_SCHEDULE_DAYS = 1;
const RELEARNING_MAX_SCHEDULE_DAYS = 2;
const REVIEW_SCHEDULE_FLOOR_DAYS = 0.5;
const NON_REVIEW_OUTLIER_MULTIPLIER = 6;
const TIMELINE_JITTER_TOLERANCE_MS = 1000;
const COUNTER_INTEGER_TOLERANCE = 1e-6;

const VALID_STATES: ReviewState[] = ['learning', 'review', 'relearning'];
type CounterNormalizationMode = 'sanitize' | 'saturate';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function parseRuntimeFiniteNumber(value: unknown): number | null {
  const unwrapNumberLike = (candidate: unknown): string | number | null => {
    if (typeof candidate === 'number' || typeof candidate === 'string') {
      return candidate;
    }
    if (candidate instanceof Number) {
      return candidate.valueOf();
    }
    if (candidate instanceof String) {
      return candidate.valueOf();
    }
    return null;
  };
  const normalizedValue = (() => {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value !== 'object') {
      return value;
    }
    const valueObject = value as { valueOf?: () => unknown; toString?: () => unknown };
    try {
      const valueOf = valueObject.valueOf;
      if (typeof valueOf === 'function') {
        const unboxed = valueOf.call(value);
        const normalizedUnboxed = unwrapNumberLike(unboxed);
        if (normalizedUnboxed !== null) {
          return normalizedUnboxed;
        }
      }
    } catch {
      // Fall through to toString for bridged runtime objects with broken valueOf.
    }
    try {
      const toString = valueObject.toString;
      if (typeof toString === 'function') {
        const stringified = toString.call(value);
        const normalizedStringified = unwrapNumberLike(stringified);
        if (normalizedStringified !== null) {
          return normalizedStringified;
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

function asFiniteNumber(value: unknown): number | null {
  return parseRuntimeFiniteNumber(value);
}

function asNonNegativeInt(
  value: unknown,
  fallback: number,
  mode: CounterNormalizationMode = 'sanitize',
): number {
  if (mode === 'saturate' && value === Number.POSITIVE_INFINITY) {
    return COUNTER_MAX;
  }
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === null) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  const normalized = Math.abs(parsed - rounded) <= COUNTER_INTEGER_TOLERANCE ? rounded : Math.floor(parsed);
  return clamp(normalized, 0, COUNTER_MAX);
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
    if (normalized === 'reviewing' || normalized === 'reviewed') {
      return 'review';
    }
    if (normalized === 'relearned') {
      return 'relearning';
    }
    if (normalized === 'rev') {
      return 'review';
    }
    if (normalized === 'relearn' || normalized === 're-learn') {
      return 'relearning';
    }
    const folded = normalized.replace(/[\s_-]+/g, '');
    if (folded === 'review') {
      return 'review';
    }
    if (folded === 'reviewing' || folded === 'reviewed') {
      return 'review';
    }
    if (folded === 'rev') {
      return 'review';
    }
    if (folded === 'learning' || folded === 'learn') {
      return 'learning';
    }
    if (folded === 'relearning' || folded === 'relearn' || folded === 'relearned') {
      return 'relearning';
    }
    const alphaFolded = normalized.replace(/[^a-z]+/g, '');
    if (alphaFolded === 'review') {
      return 'review';
    }
    if (alphaFolded === 'reviewing' || alphaFolded === 'reviewed') {
      return 'review';
    }
    if (alphaFolded === 'rev') {
      return 'review';
    }
    if (alphaFolded === 'learning' || alphaFolded === 'learn') {
      return 'learning';
    }
    if (alphaFolded === 'relearning' || alphaFolded === 'relearn' || alphaFolded === 'relearned') {
      return 'relearning';
    }
    if (isValidState(normalized)) {
      return normalized;
    }
  }
  return 'learning';
}

function isValidIso(value: unknown): value is string {
  return isIsoDateTime(value);
}

function toCanonicalIso(iso: string): string {
  return new Date(Date.parse(iso)).toISOString();
}

function toSafeIso(ms: number, fallbackMs = 0): string {
  const safeFallbackMs = Number.isFinite(fallbackMs)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, fallbackMs))
    : 0;
  const safeMs = Number.isFinite(ms)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, ms))
    : safeFallbackMs;
  return new Date(safeMs).toISOString();
}

function isDueOrInvalid(dueAt: string, currentIso: string): boolean {
  if (!isValidIso(dueAt)) {
    return true;
  }
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) {
    return true;
  }
  return isDue(dueAt, currentIso);
}

function isStatsRuntimeCardCandidate(value: unknown): value is Pick<
  Card,
  'id' | 'word' | 'meaning' | 'dueAt' | 'createdAt' | 'updatedAt' | 'state'
> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Card>;
  const id = safeReadString(() => candidate.id);
  const word = safeReadString(() => candidate.word);
  const meaning = safeReadString(() => candidate.meaning);
  const dueAt = safeReadString(() => candidate.dueAt);
  const createdAt = safeReadString(() => candidate.createdAt);
  const updatedAt = safeReadString(() => candidate.updatedAt);
  const state = safeReadString(() => candidate.state);

  return (
    id.trim().length > 0 &&
    word.trim().length > 0 &&
    meaning.trim().length > 0 &&
    dueAt.trim().length > 0 &&
    createdAt.trim().length > 0 &&
    updatedAt.trim().length > 0 &&
    state.trim().length > 0
  );
}

function parseTimeOrMin(iso: string): number {
  if (!isIsoDateTime(iso)) {
    return Number.MIN_SAFE_INTEGER;
  }
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
  const wordValue = normalizeBoundedText(raw.word, WORD_MAX_LENGTH);
  const meaningValue = normalizeBoundedText(raw.meaning, MEANING_MAX_LENGTH);
  const notesValue = normalizeBoundedText(raw.notes, NOTES_MAX_LENGTH);
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
  const normalizedCreatedAt = toSafeIso(normalizedCreatedMs, wallClockMs);
  const updatedAt = isValidIso(raw.updatedAt) ? raw.updatedAt : normalizedCreatedAt;
  const dueIsValid = isValidIso(raw.dueAt);
  const dueAt = dueIsValid ? raw.dueAt : updatedAt;
  const normalizedReps = asNonNegativeInt(raw.reps, 0, counterMode);
  const normalizedLapses = asNonNegativeInt(raw.lapses, 0, counterMode);
  const normalizedStability = clamp(asFiniteNumber(raw.stability) ?? 0.5, STABILITY_MIN, STABILITY_MAX);
  const createdMs = Date.parse(normalizedCreatedAt);
  const updatedMs = normalizeWallSafeTimestamp(updatedAt);
  const dueMs = Date.parse(dueAt);
  const normalizedUpdatedMs = Math.max(updatedMs, createdMs);
  const normalizedUpdatedAt = toSafeIso(normalizedUpdatedMs, normalizedCreatedMs);
  let normalizedDueMs = Math.max(dueMs, normalizedUpdatedMs);
  let scheduleDays = (normalizedDueMs - normalizedUpdatedMs) / DAY_MS;
  const createdAtMatchesUpdatedAt =
    Math.abs(normalizedUpdatedMs - createdMs) <= TIMELINE_JITTER_TOLERANCE_MS;
  const dueAtMatchesUpdatedAt =
    Math.abs(normalizedDueMs - normalizedUpdatedMs) <= TIMELINE_JITTER_TOLERANCE_MS;
  const preserveFreshLearningImmediateDue =
    state === 'learning' &&
    normalizedReps === 0 &&
    normalizedLapses === 0 &&
    createdAtMatchesUpdatedAt &&
    dueAtMatchesUpdatedAt;
  if (scheduleDays <= 0) {
    if (preserveFreshLearningImmediateDue) {
      scheduleDays = 0;
    } else {
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
  }
  const stateScheduleFloorDays = scheduleFallbackForState(state);
  if (scheduleDays > 0 && scheduleDays < stateScheduleFloorDays) {
    if (state === 'review') {
      const repairedReviewDays = clamp(
        normalizedStability,
        REVIEW_SCHEDULE_FLOOR_DAYS,
        REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
      );
      normalizedDueMs = normalizedUpdatedMs + repairedReviewDays * DAY_MS;
      scheduleDays = repairedReviewDays;
    } else {
      normalizedDueMs = normalizedUpdatedMs + stateScheduleFloorDays * DAY_MS;
      scheduleDays = stateScheduleFloorDays;
    }
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
  // Keep review outlier repairs conservative so plausible long intervals are preserved.
  const reviewScheduleCapDays = Math.max(
    REVIEW_SCHEDULE_FLOOR_DAYS,
    normalizedStability * REVIEW_STABILITY_OUTLIER_MULTIPLIER,
    REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  );
  if (state === 'review' && scheduleDays > reviewScheduleCapDays) {
    const repairedReviewDays = clamp(
      normalizedStability,
      REVIEW_SCHEDULE_FLOOR_DAYS,
      REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
    );
    normalizedDueMs = normalizedUpdatedMs + repairedReviewDays * DAY_MS;
    scheduleDays = repairedReviewDays;
  }
  const normalizedDueAt = toSafeIso(normalizedDueMs, normalizedUpdatedMs);

  return {
    id,
    word: wordValue,
    meaning: meaningValue,
    notes: notesValue || undefined,
    dueAt: normalizedDueAt,
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    state,
    reps: normalizedReps,
    lapses: normalizedLapses,
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
      if (!isStatsRuntimeCardCandidate(card)) {
        return acc;
      }
      const dueAt = safeReadString(() => card.dueAt);
      const state = safeReadString(() => card.state);
      acc.total += 1;
      if (isDueOrInvalid(dueAt, currentIso)) {
        acc.dueNow += 1;
      }
      if (state === 'learning') {
        acc.learning += 1;
      }
      if (state === 'review') {
        acc.review += 1;
      }
      if (state === 'relearning') {
        acc.relearning += 1;
      }
      return acc;
    },
    { total: 0, dueNow: 0, learning: 0, review: 0, relearning: 0 },
  );
}
