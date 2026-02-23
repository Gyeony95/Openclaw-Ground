import { useCallback, useEffect, useMemo, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';

export function useDeck() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadDeck()
      .then((deck) => {
        if (active) {
          setCards(deck.cards);
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
    saveDeck({ cards, lastReviewedAt: nowIso() }).catch(() => {
      // Persist errors are non-fatal for in-session usage.
    });
  }, [cards, loading]);

  const dueCards = useMemo(() => {
    const current = nowIso();
    return cards
      .filter((card) => isDue(card.dueAt, current))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }, [cards]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const created = createNewCard(word, meaning, nowIso(), notes);
    setCards((prev) => [created, ...prev]);
  }, []);

  const reviewDueCard = useCallback((cardId: string, rating: Rating) => {
    const current = nowIso();
    setCards((prev) =>
      prev.map((card) => {
        if (card.id !== cardId) {
          return card;
        }
        return reviewCard(card, rating, current).card;
      }),
    );
  }, []);

  const stats = useMemo(() => computeDeckStats(cards), [cards]);

  return {
    loading,
    cards,
    dueCards,
    stats,
    addCard,
    reviewDueCard,
  };
}
