import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';

const CLOCK_REFRESH_MS = 15000;
const MAX_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const OVERDUE_GRACE_MS = 60 * 1000;
const FALLBACK_NOW_MS = Date.parse('1970-01-01T00:00:00.000Z');

function parseTimeOrMax(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function parseDueTimeForSort(iso: string): number {
  const parsed = Date.parse(iso);
  // Invalid schedules are actionable repair targets, so keep them at the front of due queues.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function parseTimeOrNaN(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  return Number.isFinite(runtimeNow) ? runtimeNow : FALLBACK_NOW_MS;
}

function parseDueAtOrNaN(dueAt: unknown): number {
  if (typeof dueAt !== 'string') {
    return Number.NaN;
  }
  return parseTimeOrNaN(dueAt);
}

function isReviewReadyDueAt(dueAt: unknown, currentIso: string): boolean {
  if (typeof dueAt !== 'string') {
    return true;
  }
  const dueMs = parseTimeOrNaN(dueAt);
  if (!Number.isFinite(dueMs)) {
    return true;
  }
  return isDue(dueAt, currentIso);
}

function parseTimeOrMin(iso?: string): number {
  if (!iso) {
    return Number.MIN_SAFE_INTEGER;
  }
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function normalizeMergeCounter(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.MIN_SAFE_INTEGER;
  }
  if (value < 0) {
    return Number.MIN_SAFE_INTEGER;
  }
  return Math.floor(value);
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

  // When timestamps tie, prefer the card with more completed review activity.
  const existingReps = normalizeMergeCounter(existing.reps);
  const loadedReps = normalizeMergeCounter(loaded.reps);
  if (loadedReps > existingReps) {
    return loaded;
  }
  if (loadedReps < existingReps) {
    return existing;
  }

  const existingLapses = normalizeMergeCounter(existing.lapses);
  const loadedLapses = normalizeMergeCounter(loaded.lapses);
  if (loadedLapses > existingLapses) {
    return loaded;
  }
  if (loadedLapses < existingLapses) {
    return existing;
  }

  const existingDue = parseTimeOrMin(existing.dueAt);
  const loadedDue = parseTimeOrMin(loaded.dueAt);
  // On full ties, keep the earlier due card to avoid delaying a due review.
  if (loadedDue < existingDue) {
    return loaded;
  }
  if (loadedDue > existingDue) {
    return existing;
  }

  const existingCreated = parseTimeOrMin(existing.createdAt);
  const loadedCreated = parseTimeOrMin(loaded.createdAt);
  if (loadedCreated < existingCreated) {
    return loaded;
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
    const dueMs = parseDueAtOrNaN(card.dueAt);
    return Number.isFinite(dueMs) && dueMs > nowMs && dueMs <= cutoffMs;
  }).length;
}

export function countOverdueCards(cards: Card[], currentIso: string): number {
  const nowMs = Date.parse(currentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  const overdueCutoff = nowMs - OVERDUE_GRACE_MS;

  return cards.filter((card) => {
    const dueMs = parseDueAtOrNaN(card.dueAt);
    if (!Number.isFinite(dueMs)) {
      // Keep malformed schedules visible in overdue metrics so repair work stays prominent.
      return true;
    }
    return dueMs <= overdueCutoff;
  }).length;
}

export function compareDueCards(a: Card, b: Card): number {
  const dueDelta = parseDueTimeForSort(a.dueAt) - parseDueTimeForSort(b.dueAt);
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
  const effectiveCurrentIso = resolveReviewClock(currentIso, nowIso());
  let targetIndex = -1;
  for (let index = 0; index < cards.length; index += 1) {
    const candidate = cards[index];
    if (candidate.id !== cardId || !isReviewReadyDueAt(candidate.dueAt, effectiveCurrentIso)) {
      continue;
    }
    if (targetIndex === -1 || compareDueCards(candidate, cards[targetIndex]) < 0) {
      targetIndex = index;
    }
  }
  if (targetIndex < 0) {
    return { cards, reviewed: false };
  }

  const reviewed = reviewCard(cards[targetIndex], rating, effectiveCurrentIso).card;
  const nextCards = [...cards];
  nextCards[targetIndex] = reviewed;
  return { cards: nextCards, reviewed: true, reviewedAt: reviewed.updatedAt };
}

export function applyReviewToDeckState(
  deckState: { cards: Card[]; lastReviewedAt?: string },
  cardId: string,
  rating: Rating,
  currentIso: string,
): { deckState: { cards: Card[]; lastReviewedAt?: string }; reviewed: boolean } {
  const next = applyDueReview(deckState.cards, cardId, rating, currentIso);
  if (!next.reviewed) {
    return { deckState, reviewed: false };
  }
  return {
    reviewed: true,
    deckState: {
      cards: next.cards,
      lastReviewedAt: selectLatestReviewedAt(deckState.lastReviewedAt, next.reviewedAt ?? currentIso),
    },
  };
}

export function hasDueCard(cards: Card[], cardId: string, currentIso: string): boolean {
  const effectiveCurrentIso = resolveReviewClock(currentIso, nowIso());
  return cards.some((card) => card.id === cardId && isReviewReadyDueAt(card.dueAt, effectiveCurrentIso));
}

export function resolveReviewClock(renderedClockIso: string, runtimeNowIso: string): string {
  const renderedMs = parseTimeOrNaN(renderedClockIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();
  const wallClockIso = new Date(wallClockMs).toISOString();
  const canonicalRenderedIso = Number.isFinite(renderedMs) ? new Date(renderedMs).toISOString() : undefined;
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? new Date(runtimeMs).toISOString() : undefined;
  const runtimeTooFarAheadOfWall = Number.isFinite(runtimeMs) && runtimeMs - wallClockMs > MAX_CLOCK_SKEW_MS;
  const runtimeTooFarBehindWall = Number.isFinite(runtimeMs) && wallClockMs - runtimeMs > MAX_CLOCK_SKEW_MS;
  const renderedTooFarAheadOfWall = Number.isFinite(renderedMs) && renderedMs - wallClockMs > MAX_CLOCK_SKEW_MS;
  const renderedTooFarBehindWall = Number.isFinite(renderedMs) && wallClockMs - renderedMs > MAX_CLOCK_SKEW_MS;

  if (Number.isFinite(renderedMs) && Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall || runtimeTooFarBehindWall) {
      if (renderedTooFarAheadOfWall || renderedTooFarBehindWall) {
        return wallClockIso;
      }
      return canonicalRenderedIso ?? wallClockIso;
    }
    if (renderedMs - runtimeMs > MAX_CLOCK_SKEW_MS) {
      if (renderedTooFarBehindWall) {
        return wallClockIso;
      }
      if (!renderedTooFarAheadOfWall) {
        return canonicalRenderedIso ?? wallClockIso;
      }
      return canonicalRuntimeIso ?? wallClockIso;
    }
    return runtimeMs < renderedMs ? canonicalRenderedIso ?? wallClockIso : canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(runtimeMs)) {
    if (runtimeTooFarAheadOfWall || runtimeTooFarBehindWall) {
      return wallClockIso;
    }
    return canonicalRuntimeIso ?? wallClockIso;
  }
  if (Number.isFinite(renderedMs)) {
    if (renderedTooFarAheadOfWall || renderedTooFarBehindWall) {
      return wallClockIso;
    }
    return canonicalRenderedIso ?? wallClockIso;
  }
  return wallClockIso;
}

export function resolveNextUiClock(currentClockIso: string, reviewedAtIso?: string): string {
  const wallClockMs = safeNowMs();
  const wallClockIso = new Date(wallClockMs).toISOString();
  const normalizeWallSafeIso = (candidate?: string): string | undefined => {
    if (!isValidIso(candidate)) {
      return undefined;
    }
    const candidateMs = Date.parse(candidate);
    if (Math.abs(candidateMs - wallClockMs) > MAX_CLOCK_SKEW_MS) {
      return undefined;
    }
    return toCanonicalIso(candidate);
  };

  const wallSafeCurrent = normalizeWallSafeIso(currentClockIso);
  const wallSafeReviewed = normalizeWallSafeIso(reviewedAtIso);
  const resolved = selectLatestReviewedAt(wallSafeCurrent, wallSafeReviewed);
  if (resolved) {
    return resolved;
  }
  return wallClockIso;
}

export function useDeck() {
  const [deckState, setDeckState] = useState<{ cards: Card[]; lastReviewedAt?: string }>({ cards: [] });
  const [loading, setLoading] = useState(true);
  const [canPersist, setCanPersist] = useState(false);
  const [clockIso, setClockIso] = useState(() => nowIso());
  const deckStateRef = useRef(deckState);
  const persistVersionRef = useRef(0);
  const persistInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    deckStateRef.current = deckState;
  }, [deckState]);

  useEffect(() => {
    let active = true;
    loadDeck()
      .then((deck) => {
        if (active) {
          setDeckState((prev) => {
            const next = {
              cards: mergeDeckCards(prev.cards, deck.cards),
              lastReviewedAt: selectLatestReviewedAt(prev.lastReviewedAt, deck.lastReviewedAt),
            };
            deckStateRef.current = next;
            return next;
          });
          setCanPersist(true);
        }
      })
      .catch(() => {
        // Keep in-memory defaults when storage is unavailable.
        // Enable best-effort writes for later user actions if storage recovers.
        setCanPersist(true);
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
    persistVersionRef.current += 1;
    const writeVersion = persistVersionRef.current;
    const persist = async () => {
      await saveDeck(deckState);
      if (persistVersionRef.current !== writeVersion) {
        return;
      }
      persistInFlightRef.current = null;
    };

    const run = (persistInFlightRef.current ?? Promise.resolve())
      .catch(() => {
        // Continue queue processing even if a prior write failed.
      })
      .then(persist);

    persistInFlightRef.current = run.catch(() => {
      // Persist errors are non-fatal for in-session usage.
      if (persistVersionRef.current === writeVersion) {
        persistInFlightRef.current = null;
      }
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
    return deckState.cards
      .filter((card) => isReviewReadyDueAt(card.dueAt, clockIso))
      .sort(compareDueCards);
  }, [deckState.cards, clockIso]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const trimmedWord = word.trim();
    const trimmedMeaning = meaning.trim();
    if (!trimmedWord || !trimmedMeaning) {
      return;
    }
    const current = resolveReviewClock(clockIso, nowIso());
    const created = createNewCard(trimmedWord, trimmedMeaning, current, notes);
    setClockIso(current);
    setCanPersist(true);
    setDeckState((prev) => {
      const next = { ...prev, cards: [created, ...prev.cards] };
      deckStateRef.current = next;
      return next;
    });
  }, [clockIso]);

  const reviewDueCard = useCallback((cardId: string, rating: Rating): boolean => {
    const current = resolveReviewClock(clockIso, nowIso());
    const next = applyReviewToDeckState(deckStateRef.current, cardId, rating, current);
    if (!next.reviewed) {
      return false;
    }

    setDeckState(next.deckState);
    deckStateRef.current = next.deckState;
    setClockIso(resolveNextUiClock(current, next.deckState.lastReviewedAt));
    setCanPersist(true);
    return true;
  }, [clockIso]);

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
