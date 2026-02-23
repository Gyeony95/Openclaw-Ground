import { useCallback, useEffect, useMemo, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';

function compareDueCards(a: Card, b: Card): number {
  const dueDelta = Date.parse(a.dueAt) - Date.parse(b.dueAt);
  if (dueDelta !== 0) {
    return dueDelta;
  }
  return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
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

export function useDeck() {
  const [deckState, setDeckState] = useState<{ cards: Card[]; lastReviewedAt?: string }>({ cards: [] });
  const [loading, setLoading] = useState(true);
  const [clockIso, setClockIso] = useState(() => nowIso());

  useEffect(() => {
    let active = true;
    loadDeck()
      .then((deck) => {
        if (active) {
          setDeckState({ cards: deck.cards, lastReviewedAt: deck.lastReviewedAt });
        }
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
    if (loading) {
      return;
    }
    saveDeck(deckState).catch(() => {
      // Persist errors are non-fatal for in-session usage.
    });
  }, [deckState, loading]);

  useEffect(() => {
    const timer = setInterval(() => {
      setClockIso(nowIso());
    }, 30000);

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
    setDeckState((prev) => ({ ...prev, cards: [created, ...prev.cards] }));
  }, []);

  const reviewDueCard = useCallback((cardId: string, rating: Rating) => {
    const current = nowIso();
    setClockIso(current);
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
  }, []);

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
