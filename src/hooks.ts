import { useCallback, useEffect, useMemo, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';

const CLOCK_REFRESH_MS = 15000;
const MAX_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;

function parseTimeOrMax(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function parseTimeOrNaN(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseTimeOrMin(iso?: string): number {
  if (!iso) {
    return Number.MIN_SAFE_INTEGER;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function isValidIso(value?: string): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function toCanonicalIso(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function pickFreshestCard(existing: Card, loaded: Card): Card {
  const existingUpdated = parseTimeOrMin(existing.updatedAt);
  const loadedUpdated = parseTimeOrMin(loaded.updatedAt);
  if (loadedUpdated > existingUpdated) {
    return loaded;
  }
  if (loadedUpdated < existingUpdated) {
    return existing;
  }

  const existingDue = parseTimeOrMin(existing.dueAt);
  const loadedDue = parseTimeOrMin(loaded.dueAt);
  if (loadedDue > existingDue) {
    return loaded;
  }
  if (loadedDue < existingDue) {
    return existing;
  }

  if (loaded.reps > existing.reps) {
    return loaded;
  }
  if (loaded.reps < existing.reps) {
    return existing;
  }

  if (loaded.lapses > existing.lapses) {
    return loaded;
  }
  if (loaded.lapses < existing.lapses) {
    return existing;
  }

  return existing;
}

export function countUpcomingDueCards(cards: Card[], currentIso: string, hours = 24): number {
  const nowMs = Date.parse(currentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  if (!Number.isFinite(hours)) {
    return 0;
  }
  if (hours <= 0) {
    return 0;
  }
  const safeHours = hours;
  const windowMs = safeHours * 60 * 60 * 1000;
  if (!Number.isFinite(windowMs)) {
    return 0;
  }
  const cutoffMs = nowMs + windowMs;

  return cards.filter((card) => {
    const dueMs = Date.parse(card.dueAt);
    return Number.isFinite(dueMs) && dueMs > nowMs && dueMs <= cutoffMs;
  }).length;
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
  if (existingCards.length === 0 && loadedCards.length === 0) {
    return [];
  }

  const mergedById = new Map<string, Card>();
  const order: string[] = [];

  for (const existing of existingCards) {
    const current = mergedById.get(existing.id);
    if (!current) {
      mergedById.set(existing.id, existing);
      order.push(existing.id);
      continue;
    }
    mergedById.set(existing.id, pickFreshestCard(current, existing));
  }

  for (const loaded of loadedCards) {
    const current = mergedById.get(loaded.id);
    if (!current) {
      mergedById.set(loaded.id, loaded);
      order.push(loaded.id);
      continue;
    }
    mergedById.set(loaded.id, pickFreshestCard(current, loaded));
  }

  return order.map((id) => mergedById.get(id)).filter((card): card is Card => card !== undefined);
}

export function selectLatestReviewedAt(current?: string, incoming?: string): string | undefined {
  const currentValid = isValidIso(current) ? toCanonicalIso(current) : undefined;
  const incomingValid = isValidIso(incoming) ? toCanonicalIso(incoming) : undefined;
  return parseTimeOrMin(incomingValid) > parseTimeOrMin(currentValid) ? incomingValid : currentValid;
}

export function applyDueReview(
  cards: Card[],
  cardId: string,
  rating: Rating,
  currentIso: string,
): { cards: Card[]; reviewed: boolean; reviewedAt?: string } {
  const targetIndex = cards.findIndex((card) => card.id === cardId && isDue(card.dueAt, currentIso));
  if (targetIndex === -1) {
    return { cards, reviewed: false };
  }

  const reviewed = reviewCard(cards[targetIndex], rating, currentIso).card;
  const nextCards = [...cards];
  nextCards[targetIndex] = reviewed;
  return { cards: nextCards, reviewed: true, reviewedAt: reviewed.updatedAt };
}

export function hasDueCard(cards: Card[], cardId: string, currentIso: string): boolean {
  return cards.some((card) => card.id === cardId && isDue(card.dueAt, currentIso));
}

export function resolveReviewClock(renderedClockIso: string, runtimeNowIso: string): string {
  const renderedMs = parseTimeOrNaN(renderedClockIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = Date.now();
  const wallClockIso = new Date(wallClockMs).toISOString();
  const canonicalRenderedIso = Number.isFinite(renderedMs) ? new Date(renderedMs).toISOString() : undefined;
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? new Date(runtimeMs).toISOString() : undefined;
  const runtimeTooFarAheadOfWall = Number.isFinite(runtimeMs) && runtimeMs - wallClockMs > MAX_CLOCK_SKEW_MS;
  const renderedTooFarAheadOfWall = Number.isFinite(renderedMs) && renderedMs - wallClockMs > MAX_CLOCK_SKEW_MS;

  if (Number.isFinite(renderedMs) && Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall) {
      if (renderedTooFarAheadOfWall) {
        return wallClockIso;
      }
      return canonicalRenderedIso ?? wallClockIso;
    }
    if (renderedMs - runtimeMs > MAX_CLOCK_SKEW_MS) {
      return canonicalRuntimeIso ?? wallClockIso;
    }
    return runtimeMs < renderedMs ? canonicalRenderedIso ?? wallClockIso : canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall) {
      return wallClockIso;
    }
    return canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(renderedMs)) {
    if (renderedTooFarAheadOfWall) {
      return wallClockIso;
    }
    return canonicalRenderedIso ?? wallClockIso;
  }
  return wallClockIso;
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
    const current = resolveReviewClock(clockIso, nowIso());
    if (!hasDueCard(deckState.cards, cardId, current)) {
      return false;
    }

    setDeckState((prev) => {
      const next = applyDueReview(prev.cards, cardId, rating, current);
      if (!next.reviewed) {
        return prev;
      }
      return {
        cards: next.cards,
        lastReviewedAt: next.reviewedAt ?? current,
      };
    });
    setClockIso(current);
    setCanPersist(true);
    return true;
  }, [clockIso, deckState.cards]);

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
