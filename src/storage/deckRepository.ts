import AsyncStorage from '@react-native-async-storage/async-storage';
import { DIFFICULTY_MAX, DIFFICULTY_MIN, STABILITY_MAX, STABILITY_MIN } from '../scheduler/constants';
import { Card, Deck, DeckStats, ReviewState } from '../types';
import { isDue, nowIso } from '../utils/time';

const KEY = 'word_memorizer.deck.v1';

const VALID_STATES: ReviewState[] = ['learning', 'review', 'relearning'];
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  const numeric = asFiniteNumber(value);
  if (numeric === null) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

function isValidState(state: unknown): state is ReviewState {
  return typeof state === 'string' && VALID_STATES.includes(state as ReviewState);
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseTimeOrMin(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
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

  const existingDue = parseTimeOrMin(existing.dueAt);
  const incomingDue = parseTimeOrMin(incoming.dueAt);
  if (incomingDue > existingDue) {
    return incoming;
  }
  if (incomingDue < existingDue) {
    return existing;
  }

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

  const existingCreated = parseTimeOrMin(existing.createdAt);
  const incomingCreated = parseTimeOrMin(incoming.createdAt);
  if (incomingCreated < existingCreated) {
    return incoming;
  }
  return existing;
}

function normalizeCard(raw: Partial<Card>): Card | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const wordValue = typeof raw.word === 'string' ? raw.word.trim() : '';
  const meaningValue = typeof raw.meaning === 'string' ? raw.meaning.trim() : '';
  const notesValue = typeof raw.notes === 'string' ? raw.notes.trim() : '';
  if (
    !id ||
    !wordValue ||
    !meaningValue ||
    !isValidState(raw.state)
  ) {
    return null;
  }

  const createdAt = isValidIso(raw.createdAt)
    ? raw.createdAt
    : isValidIso(raw.updatedAt)
      ? raw.updatedAt
      : isValidIso(raw.dueAt)
        ? raw.dueAt
        : null;
  if (!createdAt) {
    return null;
  }

  const updatedAt = isValidIso(raw.updatedAt) ? raw.updatedAt : createdAt;
  const dueAt = isValidIso(raw.dueAt) ? raw.dueAt : updatedAt;
  const createdMs = Date.parse(createdAt);
  const updatedMs = Date.parse(updatedAt);
  const dueMs = Date.parse(dueAt);
  const normalizedUpdatedMs = Math.max(updatedMs, createdMs);
  const normalizedUpdatedAt = new Date(normalizedUpdatedMs).toISOString();
  const normalizedDueAt = new Date(Math.max(dueMs, normalizedUpdatedMs)).toISOString();

  return {
    id,
    word: wordValue,
    meaning: meaningValue,
    notes: notesValue || undefined,
    dueAt: normalizedDueAt,
    createdAt,
    updatedAt: normalizedUpdatedAt,
    state: raw.state,
    reps: asNonNegativeInt(raw.reps, 0),
    lapses: asNonNegativeInt(raw.lapses, 0),
    stability: clamp(asFiniteNumber(raw.stability) ?? 0.5, STABILITY_MIN, STABILITY_MAX),
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
      .map((item) => normalizeCard(item as Partial<Card>))
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
      lastReviewedAt: isValidIso(parsed.lastReviewedAt) ? parsed.lastReviewedAt : undefined,
    };
  } catch {
    return { cards: [] };
  }
}

export async function saveDeck(deck: Deck): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(deck));
}

export function computeDeckStats(cards: Card[], currentIso = nowIso()): DeckStats {
  return cards.reduce<DeckStats>(
    (acc, card) => {
      acc.total += 1;
      if (isDue(card.dueAt, currentIso)) {
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
