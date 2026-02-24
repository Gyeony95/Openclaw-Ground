import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import { MEANING_MAX_LENGTH, NOTES_MAX_LENGTH, STABILITY_MAX, STABILITY_MIN, WORD_MAX_LENGTH } from './scheduler/constants';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, Rating } from './types';
import { isDue, nowIso } from './utils/time';
import { normalizeBoundedText } from './utils/text';

const CLOCK_REFRESH_MS = 15000;
const MAX_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const MAX_UI_FUTURE_SKEW_MS = 60 * 1000;
const OVERDUE_GRACE_MS = 60 * 1000;
const FALLBACK_NOW_MS = Date.parse('1970-01-01T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_MIN_SCHEDULE_MS = 60 * 1000;
const RELEARNING_MIN_SCHEDULE_MS = 10 * 60 * 1000;
const REVIEW_MIN_SCHEDULE_MS = 0.5 * DAY_MS;
const LEARNING_MAX_SCHEDULE_MS = DAY_MS;
const RELEARNING_MAX_SCHEDULE_MS = 2 * DAY_MS;
const REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS = 7;
const REVIEW_STABILITY_OUTLIER_MULTIPLIER = 12;
const REVIEW_STABILITY_OUTLIER_FLOOR_DAYS = 120;

function parseTimeOrRepairPriority(iso: string): number {
  const parsed = Date.parse(iso);
  // Invalid timeline anchors should be prioritized for immediate repair.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
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
  return Number.isFinite(runtimeNow) ? runtimeNow : Number.NaN;
}

function toSafeIso(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : FALLBACK_NOW_MS).toISOString();
}

function parseDueAtOrNaN(dueAt: unknown): number {
  if (typeof dueAt !== 'string') {
    return Number.NaN;
  }
  return parseTimeOrNaN(dueAt);
}

function normalizeNonNegativeCounter(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0) {
    return null;
  }
  return value;
}

function normalizeReviewState(value: unknown): Card['state'] | null {
  if (value === 'review' || value === 'relearning' || value === 'learning') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  const folded = normalized.replace(/[\s_-]+/g, '');
  if (folded === 'review') {
    return 'review';
  }
  if (folded === 'learning' || folded === 'learn') {
    return 'learning';
  }
  if (folded === 'relearning' || folded === 'relearn') {
    return 'relearning';
  }
  return null;
}

function minScheduleMsForState(state: Card['state']): number {
  if (state === 'review') {
    return REVIEW_MIN_SCHEDULE_MS;
  }
  if (state === 'relearning') {
    return RELEARNING_MIN_SCHEDULE_MS;
  }
  return LEARNING_MIN_SCHEDULE_MS;
}

function normalizedReviewStabilityDays(stability: unknown): number {
  if (typeof stability !== 'number' || !Number.isFinite(stability) || stability <= 0) {
    return REVIEW_MIN_SCHEDULE_MS / DAY_MS;
  }
  return clamp(stability, STABILITY_MIN, STABILITY_MAX);
}

function maxScheduleMsBeforeRepair(state: Card['state'], stability: unknown): number {
  if (state === 'learning') {
    return LEARNING_MAX_SCHEDULE_MS;
  }
  if (state === 'relearning') {
    return RELEARNING_MAX_SCHEDULE_MS;
  }

  const normalizedStabilityDays = normalizedReviewStabilityDays(stability);
  const stabilityOutlierWindowDays = Math.max(
    REVIEW_MIN_SCHEDULE_MS / DAY_MS,
    normalizedStabilityDays * REVIEW_STABILITY_OUTLIER_MULTIPLIER,
    REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  );
  const maxReviewDays = Math.min(
    STABILITY_MAX,
    Math.max(REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS, stabilityOutlierWindowDays),
  );
  return maxReviewDays * DAY_MS;
}

export function hasScheduleRepairNeed(
  card: Pick<Card, 'dueAt' | 'updatedAt' | 'state'> & Partial<Pick<Card, 'stability' | 'reps'>>,
): boolean {
  const dueMs = parseTimeOrNaN(card.dueAt);
  const updatedMs = parseTimeOrNaN(card.updatedAt);
  const state = normalizeReviewState(card.state);
  if (!Number.isFinite(dueMs) || !Number.isFinite(updatedMs)) {
    return true;
  }
  if (!state) {
    return true;
  }
  if (dueMs < updatedMs) {
    return true;
  }
  if (dueMs > updatedMs) {
    const scheduleMs = dueMs - updatedMs;
    if (scheduleMs < minScheduleMsForState(state)) {
      return true;
    }
    return scheduleMs > maxScheduleMsBeforeRepair(state, card.stability);
  }
  // Brand-new learning cards are legitimately due at creation time; persisted learning cards should move forward.
  if (state !== 'learning') {
    return true;
  }
  const reps = normalizeNonNegativeCounter(card.reps);
  if (reps === null) {
    return true;
  }
  return reps > 0;
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

export function countScheduleRepairCards(cards: Card[]): number {
  return cards.filter((card) => hasScheduleRepairNeed(card)).length;
}

export function compareDueCards(a: Card, b: Card): number {
  const dueDelta = parseDueTimeForSort(a.dueAt) - parseDueTimeForSort(b.dueAt);
  if (dueDelta !== 0) {
    return dueDelta;
  }
  const updatedDelta = parseTimeOrRepairPriority(a.updatedAt) - parseTimeOrRepairPriority(b.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  const createdDelta = parseTimeOrRepairPriority(a.createdAt) - parseTimeOrRepairPriority(b.createdAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }
  return a.id.localeCompare(b.id);
}

export function collectDueCards(cards: Card[], currentIso: string, runtimeNowIso: string): Card[] {
  const effectiveCurrentIso = resolveReviewClock(currentIso, runtimeNowIso);
  return cards.filter((card) => isReviewReadyDueAt(card.dueAt, effectiveCurrentIso)).sort(compareDueCards);
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
  const wallClockIso = toSafeIso(wallClockMs);
  const hasFiniteWallClock = Number.isFinite(wallClockMs);
  const canonicalRenderedIso = Number.isFinite(renderedMs) ? new Date(renderedMs).toISOString() : undefined;
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? new Date(runtimeMs).toISOString() : undefined;
  const runtimeTooFarAheadOfWall =
    hasFiniteWallClock && Number.isFinite(runtimeMs) && runtimeMs - wallClockMs > MAX_CLOCK_SKEW_MS;
  const runtimeTooFarBehindWall =
    hasFiniteWallClock && Number.isFinite(runtimeMs) && wallClockMs - runtimeMs > MAX_CLOCK_SKEW_MS;
  const renderedTooFarAheadOfWall =
    hasFiniteWallClock && Number.isFinite(renderedMs) && renderedMs - wallClockMs > MAX_CLOCK_SKEW_MS;
  const renderedTooFarBehindWall =
    hasFiniteWallClock && Number.isFinite(renderedMs) && wallClockMs - renderedMs > MAX_CLOCK_SKEW_MS;

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
  const wallClockIso = toSafeIso(wallClockMs);
  const hasFiniteWallClock = Number.isFinite(wallClockMs);
  const normalizeWallSafeIso = (candidate?: string): string | undefined => {
    if (!isValidIso(candidate)) {
      return undefined;
    }
    const candidateMs = Date.parse(candidate);
    if (hasFiniteWallClock) {
      if (candidateMs - wallClockMs > MAX_UI_FUTURE_SKEW_MS) {
        return undefined;
      }
      if (wallClockMs - candidateMs > MAX_CLOCK_SKEW_MS) {
        return undefined;
      }
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

export function resolveDeckClockTick(previousClockIso: string, runtimeNowIso: string): string {
  return resolveNextUiClock(previousClockIso, runtimeNowIso);
}

export function useDeck() {
  const [deckState, setDeckState] = useState<{ cards: Card[]; lastReviewedAt?: string }>({ cards: [] });
  const [loading, setLoading] = useState(true);
  const [canPersist, setCanPersist] = useState(false);
  const [clockIso, setClockIso] = useState(() => resolveDeckClockTick(nowIso(), nowIso()));
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
      const runtimeNow = nowIso();
      setClockIso((previousClockIso) => resolveDeckClockTick(previousClockIso, runtimeNow));
    }, CLOCK_REFRESH_MS);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const effectiveClockIso = useMemo(() => resolveReviewClock(clockIso, nowIso()), [clockIso]);

  const dueCards = useMemo(() => {
    // Keep due queue selection aligned with the same wall-safe clock exposed to the UI and stats.
    return collectDueCards(deckState.cards, effectiveClockIso, effectiveClockIso);
  }, [deckState.cards, effectiveClockIso]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const normalizedWord = normalizeBoundedText(word, WORD_MAX_LENGTH);
    const normalizedMeaning = normalizeBoundedText(meaning, MEANING_MAX_LENGTH);
    const normalizedNotes = normalizeBoundedText(notes, NOTES_MAX_LENGTH);
    if (!normalizedWord || !normalizedMeaning) {
      return;
    }
    const current = resolveReviewClock(clockIso, nowIso());
    const created = createNewCard(normalizedWord, normalizedMeaning, current, normalizedNotes || undefined);
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

  const stats = useMemo(() => computeDeckStats(deckState.cards, effectiveClockIso), [deckState.cards, effectiveClockIso]);

  return {
    loading,
    clockIso: effectiveClockIso,
    lastReviewedAt: deckState.lastReviewedAt,
    cards: deckState.cards,
    dueCards,
    stats,
    addCard,
    reviewDueCard,
  };
}
