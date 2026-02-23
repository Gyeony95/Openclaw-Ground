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

function normalizeCard(raw: Partial<Card>): Card | null {
  if (
    !raw.id ||
    !raw.word ||
    !raw.meaning ||
    !isValidIso(raw.dueAt) ||
    !isValidIso(raw.createdAt) ||
    !isValidIso(raw.updatedAt) ||
    !isValidState(raw.state)
  ) {
    return null;
  }

  const word = raw.word.trim();
  const meaning = raw.meaning.trim();
  if (!word || !meaning) {
    return null;
  }
  const createdMs = Date.parse(raw.createdAt);
  const updatedMs = Date.parse(raw.updatedAt);
  const dueMs = Date.parse(raw.dueAt);
  const normalizedUpdatedMs = Math.max(updatedMs, createdMs);
  const normalizedUpdatedAt = new Date(normalizedUpdatedMs).toISOString();
  const normalizedDueAt = new Date(Math.max(dueMs, normalizedUpdatedMs)).toISOString();

  return {
    id: raw.id,
    word,
    meaning,
    notes: raw.notes?.trim() || undefined,
    dueAt: normalizedDueAt,
    createdAt: raw.createdAt,
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
    const cards = (parsed.cards ?? [])
      .map((item) => normalizeCard(item as Partial<Card>))
      .filter((item): item is Card => item !== null)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    return {
      cards,
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
