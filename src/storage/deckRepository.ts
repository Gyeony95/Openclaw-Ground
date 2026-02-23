import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, Deck, DeckStats } from '../types';
import { isDue, nowIso } from '../utils/time';

const KEY = 'word_memorizer.deck.v1';

const EMPTY_DECK: Deck = {
  cards: [],
};

function normalizeCard(raw: Partial<Card>): Card | null {
  if (!raw.id || !raw.word || !raw.meaning || !raw.dueAt || !raw.createdAt || !raw.updatedAt || !raw.state) {
    return null;
  }

  return {
    id: raw.id,
    word: raw.word,
    meaning: raw.meaning,
    notes: raw.notes,
    dueAt: raw.dueAt,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    state: raw.state,
    reps: raw.reps ?? 0,
    lapses: raw.lapses ?? 0,
    stability: raw.stability ?? 0.5,
    difficulty: raw.difficulty ?? 5,
  };
}

export async function loadDeck(): Promise<Deck> {
  const serialized = await AsyncStorage.getItem(KEY);
  if (!serialized) {
    return EMPTY_DECK;
  }

  try {
    const parsed = JSON.parse(serialized) as Partial<Deck>;
    const cards = (parsed.cards ?? [])
      .map((item) => normalizeCard(item as Partial<Card>))
      .filter((item): item is Card => item !== null);

    return {
      cards,
      lastReviewedAt: parsed.lastReviewedAt,
    };
  } catch {
    return EMPTY_DECK;
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
