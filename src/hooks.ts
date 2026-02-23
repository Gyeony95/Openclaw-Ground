import { useCallback, useEffect, useMemo, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';

const CLOCK_REFRESH_MS = 15000;

function parseTimeOrMax(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function parseTimeOrMin(iso?: string): number {
  if (!iso) {
    return Number.MIN_SAFE_INTEGER;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

export function compareDueCards(a: Card, b: Card): number {
  const dueDelta = parseTimeOrMax(a.dueAt) - parseTimeOrMax(b.dueAt);
  if (dueDelta !== 0) {
    return dueDelta;
  }
  const updatedDelta = parseTimeOrMax(a.updatedAt) - parseTimeOrMax(b.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  const createdDelta = parseTimeOrMax(a.createdAt) - parseTimeOrMax(b.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }
  return a.id.localeCompare(b.id);
}

export function mergeDeckCards(existingCards: Card[], loadedCards: Card[]): Card[] {
  if (existingCards.length === 0) {
    return loadedCards;
  }
  if (loadedCards.length === 0) {
    return existingCards;
  }

  const seenIds = new Set(existingCards.map((card) => card.id));
  const merged = [...existingCards];
  for (const loaded of loadedCards) {
    if (!seenIds.has(loaded.id)) {
      merged.push(loaded);
      seenIds.add(loaded.id);
    }
  }
  return merged;
}

export function selectLatestReviewedAt(current?: string, incoming?: string): string | undefined {
  return parseTimeOrMin(incoming) > parseTimeOrMin(current) ? incoming : current;
}

export function applyDueReview(cards: Card[], cardId: string, rating: Rating, currentIso: string): { cards: Card[]; reviewed: boolean } {
  const targetIndex = cards.findIndex((card) => card.id === cardId && isDue(card.dueAt, currentIso));
  if (targetIndex === -1) {
    return { cards, reviewed: false };
  }

  const nextCards = [...cards];
  nextCards[targetIndex] = reviewCard(cards[targetIndex], rating, currentIso).card;
  return { cards: nextCards, reviewed: true };
}

export function hasDueCard(cards: Card[], cardId: string, currentIso: string): boolean {
  return cards.some((card) => card.id === cardId && isDue(card.dueAt, currentIso));
}

export function useDeck() {
  const [deckState, setDeckState] = useState<{ cards: Card[]; lastReviewedAt?: string }>({ cards: [] });
  const [loading, setLoading] = useState(true);
  const [canPersist, setCanPersist] = useState(false);
  const [clockIso, setClockIso] = useState(() => nowIso());

  useEffect(() => {
    let active = true;
    loadDeck()
      .then((deck) => {
        if (active) {
          setDeckState((prev) => ({
            cards: mergeDeckCards(prev.cards, deck.cards),
            lastReviewedAt: selectLatestReviewedAt(prev.lastReviewedAt, deck.lastReviewedAt),
          }));
          setCanPersist(true);
        }
      })
      .catch(() => {
        // Keep in-memory defaults when storage is unavailable.
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !canPersist) {
      return;
    }
    saveDeck(deckState).catch(() => {
      // Persist errors are non-fatal for in-session usage.
    });
  }, [canPersist, deckState, loading]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockIso(nowIso());
    }, CLOCK_REFRESH_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const dueCards = useMemo(() => {
    return deckState.cards.filter((card) => isDue(card.dueAt, clockIso)).sort(compareDueCards);
  }, [deckState.cards, clockIso]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const trimmedWord = word.trim();
    const trimmedMeaning = meaning.trim();
    if (!trimmedWord || !trimmedMeaning) {
      return;
    }
    const current = nowIso();
    const created = createNewCard(trimmedWord, trimmedMeaning, current, notes);
    setClockIso(current);
    setCanPersist(true);
    setDeckState((prev) => ({ ...prev, cards: [created, ...prev.cards] }));
  }, []);

  const reviewDueCard = useCallback((cardId: string, rating: Rating): boolean => {
    const current = nowIso();
    const reviewed = hasDueCard(deckState.cards, cardId, current);
    if (!reviewed) {
      return false;
    }

    setDeckState((prev) => {
      const next = applyDueReview(prev.cards, cardId, rating, current);
      if (!next.reviewed) {
        return prev;
      }
      return {
        cards: next.cards,
        lastReviewedAt: current,
      };
    });

    setClockIso(current);
    setCanPersist(true);
    return true;
  }, [deckState.cards]);

  const stats = useMemo(() => computeDeckStats(deckState.cards, clockIso), [deckState.cards, clockIso]);

  return {
    loading,
    clockIso,
    lastReviewedAt: deckState.lastReviewedAt,
    cards: deckState.cards,
    dueCards,
    stats,
    addCard,
    reviewDueCard,
  };
}
