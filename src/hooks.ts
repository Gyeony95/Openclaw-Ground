import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNewCard, reviewCard } from './scheduler/fsrs';
import {
  MEANING_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS,
  REVIEW_STABILITY_OUTLIER_FLOOR_DAYS,
  REVIEW_STABILITY_OUTLIER_MULTIPLIER,
  STABILITY_MAX,
  STABILITY_MIN,
  WORD_MAX_LENGTH,
} from './scheduler/constants';
import { computeDeckStats, loadDeck, saveDeck } from './storage/deckRepository';
import { Card, DeckStats, Rating } from './types';
import { isDue, isIsoDateTime, nowIso } from './utils/time';
import { normalizeBoundedText } from './utils/text';

const CLOCK_REFRESH_MS = 15000;
const MAX_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;
const MAX_UI_FUTURE_SKEW_MS = 60 * 1000;
const OVERDUE_GRACE_MS = 60 * 1000;
const FALLBACK_NOW_MS = Date.parse('1970-01-01T00:00:00.000Z');
const MIN_DATE_MS = -8640000000000000;
const MAX_DATE_MS = 8640000000000000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LEARNING_MIN_SCHEDULE_MS = 60 * 1000;
const RELEARNING_MIN_SCHEDULE_MS = 10 * 60 * 1000;
const REVIEW_MIN_SCHEDULE_MS = 0.5 * DAY_MS;
const LEARNING_MAX_SCHEDULE_MS = DAY_MS;
const RELEARNING_MAX_SCHEDULE_MS = 2 * DAY_MS;
const MAX_UPCOMING_HOURS = 24 * 365 * 20;

function safeReadUnknown(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safeReadString(read: () => unknown, fallback = ''): string {
  try {
    const value = read();
    return typeof value === 'string' ? value : fallback;
  } catch {
    return fallback;
  }
}

function parseTimeOrRepairPriority(iso: string): number {
  const parsed = parseTimeOrNaN(iso);
  // Invalid timeline anchors should be prioritized for immediate repair.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function parseDueTimeForSort(iso: string): number {
  const parsed = parseTimeOrNaN(iso);
  // Invalid schedules are actionable repair targets, so keep them at the front of due queues.
  return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
}

function normalizeCardIdForSort(id: unknown): string {
  if (typeof id !== 'string') {
    return '';
  }
  return id.trim();
}

function isValidCardId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

function normalizeCardIdInput(id: unknown): string | null {
  if (!isValidCardId(id)) {
    return null;
  }
  return id.trim();
}

function normalizeCardIdForMatch(id: unknown): string | null {
  return normalizeCardIdInput(id);
}

function normalizeCardIdForMerge(id: unknown): string | null {
  return normalizeCardIdInput(id);
}

function isRuntimeCard(value: unknown): value is Card {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Card>;
  const id = safeReadUnknown(() => candidate.id);
  const createdAt = safeReadUnknown(() => candidate.createdAt);
  const updatedAt = safeReadUnknown(() => candidate.updatedAt);
  const dueAt = safeReadUnknown(() => candidate.dueAt);
  return (
    typeof id === 'string' &&
    typeof createdAt === 'string' &&
    typeof updatedAt === 'string' &&
    typeof dueAt === 'string'
  );
}

function parseTimeOrNaN(iso: string): number {
  if (!isIsoDateTime(iso)) {
    return Number.NaN;
  }
  return Date.parse(iso);
}

function safeNowMs(): number {
  const runtimeNow = Date.now();
  return Number.isFinite(runtimeNow) ? runtimeNow : Number.NaN;
}

function toSafeIso(ms: number): string {
  const safeMs = Number.isFinite(ms)
    ? Math.min(MAX_DATE_MS, Math.max(MIN_DATE_MS, ms))
    : FALLBACK_NOW_MS;
  return new Date(safeMs).toISOString();
}

function parseDueAtOrNaN(dueAt: unknown): number {
  if (typeof dueAt !== 'string') {
    return Number.NaN;
  }
  return parseTimeOrNaN(dueAt);
}

function parseRuntimeFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNonNegativeCounter(value: unknown): number | null {
  if (value === Number.POSITIVE_INFINITY) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'infinity' || trimmed === '+infinity') {
      return Number.MAX_SAFE_INTEGER;
    }
    if (trimmed === '-infinity') {
      return null;
    }
  }
  const parsed = parseRuntimeFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 0) {
    return null;
  }
  return parsed;
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

function normalizedReviewStabilityDays(stability: unknown): number | null {
  const parsed = parseRuntimeFiniteNumber(stability);
  if (parsed === null || parsed <= 0) {
    return null;
  }
  return clamp(parsed, STABILITY_MIN, STABILITY_MAX);
}

function maxScheduleMsBeforeRepair(state: Card['state'], stability: unknown): number {
  if (state === 'learning') {
    return LEARNING_MAX_SCHEDULE_MS;
  }
  if (state === 'relearning') {
    return RELEARNING_MAX_SCHEDULE_MS;
  }

  const normalizedStabilityDays = normalizedReviewStabilityDays(stability);
  if (normalizedStabilityDays === null) {
    // Unknown review stability should be repaired conservatively instead of
    // allowing long hidden intervals that may never be reviewed.
    return REVIEW_INVALID_DUE_STABILITY_FALLBACK_MAX_DAYS * DAY_MS;
  }
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
  card: Pick<Card, 'dueAt' | 'updatedAt' | 'state'> & Partial<Pick<Card, 'stability' | 'reps' | 'lapses'>>,
): boolean {
  const dueAt = safeReadString(() => card.dueAt);
  const updatedAt = safeReadString(() => card.updatedAt);
  const stateValue = safeReadUnknown(() => card.state);
  const stabilityValue = safeReadUnknown(() => card.stability);
  const repsValue = safeReadUnknown(() => card.reps);
  const lapsesValue = safeReadUnknown(() => card.lapses);
  const dueMs = parseTimeOrNaN(dueAt);
  const updatedMs = parseTimeOrNaN(updatedAt);
  const wallClockMs = safeNowMs();
  const state = normalizeReviewState(stateValue);
  if (!Number.isFinite(dueMs) || !Number.isFinite(updatedMs)) {
    return true;
  }
  if (!state) {
    return true;
  }
  if (Number.isFinite(wallClockMs)) {
    // `dueAt` can legitimately be far in the future for mature review cards.
    // Only treat timeline anchors as corrupted when `updatedAt` itself is future-skewed.
    if (updatedMs - wallClockMs > MAX_CLOCK_SKEW_MS) {
      return true;
    }
  }
  if (dueMs < updatedMs) {
    return true;
  }
  if (dueMs > updatedMs) {
    const scheduleMs = dueMs - updatedMs;
    if (scheduleMs < minScheduleMsForState(state)) {
      return true;
    }
    if (scheduleMs > maxScheduleMsBeforeRepair(state, stabilityValue)) {
      return true;
    }
    const reps = normalizeNonNegativeCounter(repsValue);
    if (state === 'learning' && reps !== null && reps > 0 && scheduleMs >= REVIEW_MIN_SCHEDULE_MS) {
      // Learning steps with review history should remain short; day-like intervals indicate
      // persisted phase drift and should be repaired before queueing.
      return true;
    }
    return false;
  }
  // Brand-new learning cards are legitimately due at creation time; persisted learning cards should move forward.
  if (state !== 'learning') {
    return true;
  }
  const reps = normalizeNonNegativeCounter(repsValue);
  const lapsesRawMissing = lapsesValue === undefined || lapsesValue === null;
  const lapses = lapsesRawMissing ? 0 : normalizeNonNegativeCounter(lapsesValue);
  if (reps === null) {
    return true;
  }
  if (lapses === null) {
    return true;
  }
  return reps > 0 || lapses > 0;
}

function isReviewReadyCard(card: Pick<Card, 'dueAt' | 'updatedAt' | 'state'> & Partial<Pick<Card, 'stability' | 'reps'>>, currentIso: string): boolean {
  if (hasScheduleRepairNeed(card)) {
    return true;
  }
  if (typeof card.dueAt !== 'string') {
    return true;
  }
  const dueMs = parseTimeOrNaN(card.dueAt);
  if (!Number.isFinite(dueMs)) {
    return true;
  }
  return isDue(card.dueAt, currentIso);
}

function parseTimeOrMin(iso?: string): number {
  if (!iso || !isIsoDateTime(iso)) {
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
  return isIsoDateTime(value);
}

function toCanonicalIso(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function resolveActionClock(currentIso: string, runtimeNowIso: string): string {
  if (!isValidIso(currentIso)) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  const currentMs = Date.parse(currentIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();
  const canonicalCurrentIso = toCanonicalIso(currentIso);
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? toCanonicalIso(runtimeNowIso) : undefined;
  const currentTooFarFromRuntime =
    Number.isFinite(runtimeMs) && Math.abs(currentMs - runtimeMs) > MAX_CLOCK_SKEW_MS;
  const currentTooFarFromWall =
    Number.isFinite(wallClockMs) && Math.abs(currentMs - wallClockMs) > MAX_CLOCK_SKEW_MS;

  if (currentTooFarFromRuntime || currentTooFarFromWall) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  if (Number.isFinite(runtimeMs)) {
    const runtimeAheadMs = runtimeMs - currentMs;
    if (runtimeAheadMs > MAX_UI_FUTURE_SKEW_MS) {
      // If the rendered clock trails materially, use runtime so reviews are not rejected as stale.
      return canonicalRuntimeIso ?? canonicalCurrentIso;
    }
    if (runtimeAheadMs < 0) {
      // Never allow action clocks to move ahead of runtime time; this prevents early reviews.
      return canonicalRuntimeIso ?? canonicalCurrentIso;
    }
    // Keep near-boundary review actions deterministic while rendered and runtime clocks are close.
    return canonicalCurrentIso;
  }

  return canonicalCurrentIso;
}

function resolveQueueClock(currentIso: string, runtimeNowIso: string): string {
  if (!isValidIso(currentIso)) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  const currentMs = Date.parse(currentIso);
  const runtimeMs = parseTimeOrNaN(runtimeNowIso);
  const wallClockMs = safeNowMs();
  const canonicalCurrentIso = toCanonicalIso(currentIso);
  const canonicalRuntimeIso = Number.isFinite(runtimeMs) ? toCanonicalIso(runtimeNowIso) : undefined;
  const currentTooFarFromRuntime =
    Number.isFinite(runtimeMs) && Math.abs(currentMs - runtimeMs) > MAX_CLOCK_SKEW_MS;
  const currentTooFarFromWall =
    Number.isFinite(wallClockMs) && Math.abs(currentMs - wallClockMs) > MAX_CLOCK_SKEW_MS;

  if (currentTooFarFromRuntime || currentTooFarFromWall) {
    return resolveReviewClock(currentIso, runtimeNowIso);
  }

  if (Number.isFinite(runtimeMs)) {
    // Queue visibility should track runtime closely so due cards surface immediately.
    return canonicalRuntimeIso ?? canonicalCurrentIso;
  }

  return canonicalCurrentIso;
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
  const nowMs = parseTimeOrNaN(currentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  if (hours === Number.POSITIVE_INFINITY) {
    hours = MAX_UPCOMING_HOURS;
  }
  if (!Number.isFinite(hours)) {
    return 0;
  }
  if (hours <= 0) {
    return 0;
  }
  const safeHours = Math.min(hours, MAX_UPCOMING_HOURS);
  const windowMs = safeHours * 60 * 60 * 1000;
  const cutoffMs = Number.isFinite(windowMs) ? nowMs + windowMs : Number.POSITIVE_INFINITY;

  return cards.filter((card) => {
    if (!isRuntimeCard(card)) {
      return false;
    }
    if (hasScheduleRepairNeed(card)) {
      return false;
    }
    const dueMs = parseDueAtOrNaN(safeReadString(() => card.dueAt));
    // "Upcoming" should represent future workload, excluding cards already due now.
    return Number.isFinite(dueMs) && dueMs > nowMs && dueMs <= cutoffMs;
  }).length;
}

export function countOverdueCards(cards: Card[], currentIso: string): number {
  const nowMs = parseTimeOrNaN(currentIso);
  if (!Number.isFinite(nowMs)) {
    return 0;
  }
  const overdueCutoff = nowMs - OVERDUE_GRACE_MS;

  return cards.filter((card) => {
    if (!isRuntimeCard(card)) {
      return false;
    }
    const dueMs = parseDueAtOrNaN(card.dueAt);
    if (!Number.isFinite(dueMs)) {
      // Keep malformed schedules visible in overdue metrics so repair work stays prominent.
      return true;
    }
    return dueMs <= overdueCutoff;
  }).length;
}

export function countScheduleRepairCards(cards: Card[]): number {
  return cards.filter((card) => !isRuntimeCard(card) || hasScheduleRepairNeed(card)).length;
}

export function compareDueCards(a: Card, b: Card): number {
  const aDueAt = safeReadString(() => a?.dueAt);
  const bDueAt = safeReadString(() => b?.dueAt);
  const aUpdatedAt = safeReadString(() => a?.updatedAt);
  const bUpdatedAt = safeReadString(() => b?.updatedAt);
  const aCreatedAt = safeReadString(() => a?.createdAt);
  const bCreatedAt = safeReadString(() => b?.createdAt);
  const dueDelta = parseDueTimeForSort(aDueAt) - parseDueTimeForSort(bDueAt);
  if (dueDelta !== 0) {
    return dueDelta;
  }
  const updatedDelta = parseTimeOrRepairPriority(aUpdatedAt) - parseTimeOrRepairPriority(bUpdatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  const createdDelta = parseTimeOrRepairPriority(aCreatedAt) - parseTimeOrRepairPriority(bCreatedAt);
  if (createdDelta !== 0) {
    return createdDelta;
  }
  const aId = safeReadUnknown(() => a?.id);
  const bId = safeReadUnknown(() => b?.id);
  return normalizeCardIdForSort(aId).localeCompare(normalizeCardIdForSort(bId));
}

export function collectDueCards(cards: Card[], currentIso: string, runtimeNowIso: string): Card[] {
  const effectiveCurrentIso = resolveQueueClock(currentIso, runtimeNowIso);
  return cards
    .filter((card): card is Card => isRuntimeCard(card) && isReviewReadyCard(card, effectiveCurrentIso))
    .sort(compareDueCards);
}

export function mergeDeckCards(existingCards: Card[], loadedCards: Card[]): Card[] {
  if (existingCards.length === 0 && loadedCards.length === 0) {
    return [];
  }

  const mergedById = new Map<string, Card>();
  const order: string[] = [];
  let fallbackMergeSequence = 0;
  const fallbackMergeKey = (source: 'existing' | 'loaded'): string => {
    fallbackMergeSequence += 1;
    return `__merge_${source}_${fallbackMergeSequence}`;
  };

  for (const existing of existingCards) {
    if (!isRuntimeCard(existing)) {
      continue;
    }
    const mergeKey = normalizeCardIdForMerge(existing.id) ?? fallbackMergeKey('existing');
    const current = mergedById.get(mergeKey);
    if (!current) {
      mergedById.set(mergeKey, existing);
      order.push(mergeKey);
      continue;
    }
    mergedById.set(mergeKey, pickFreshestCard(current, existing));
  }

  for (const loaded of loadedCards) {
    if (!isRuntimeCard(loaded)) {
      continue;
    }
    const mergeKey = normalizeCardIdForMerge(loaded.id) ?? fallbackMergeKey('loaded');
    const current = mergedById.get(mergeKey);
    if (!current) {
      mergedById.set(mergeKey, loaded);
      order.push(mergeKey);
      continue;
    }
    mergedById.set(mergeKey, pickFreshestCard(current, loaded));
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
  runtimeNowIso = nowIso(),
): { cards: Card[]; reviewed: boolean; reviewedAt?: string } {
  const normalizedCardId = normalizeCardIdInput(cardId);
  if (!normalizedCardId) {
    return { cards, reviewed: false };
  }
  const effectiveCurrentIso = resolveActionClock(currentIso, runtimeNowIso);
  const candidateIndices: number[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const candidate = cards[index];
    if (!isRuntimeCard(candidate)) {
      continue;
    }
    const candidateId = normalizeCardIdForMatch(candidate.id);
    if (candidateId !== normalizedCardId || !isReviewReadyCard(candidate, effectiveCurrentIso)) {
      continue;
    }
    candidateIndices.push(index);
  }
  if (candidateIndices.length === 0) {
    return { cards, reviewed: false };
  }
  candidateIndices.sort((a, b) => compareDueCards(cards[a], cards[b]));

  for (const targetIndex of candidateIndices) {
    const targetCard = cards[targetIndex];
    if (!isRuntimeCard(targetCard)) {
      continue;
    }

    try {
      const reviewed = reviewCard(targetCard, rating, effectiveCurrentIso).card;
      const nextCards = [...cards];
      nextCards[targetIndex] = reviewed;
      return { cards: nextCards, reviewed: true, reviewedAt: reviewed.updatedAt };
    } catch {
      // Keep trying lower-priority due duplicates when one runtime-corrupted entry throws.
    }
  }

  // Keep the queue stable when all runtime-corrupted candidates throw during scheduling.
  return { cards, reviewed: false };
}

export function applyReviewToDeckState(
  deckState: { cards: Card[]; lastReviewedAt?: string },
  cardId: string,
  rating: Rating,
  currentIso: string,
  runtimeNowIso = nowIso(),
): { deckState: { cards: Card[]; lastReviewedAt?: string }; reviewed: boolean } {
  const next = applyDueReview(deckState.cards, cardId, rating, currentIso, runtimeNowIso);
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

export function hasDueCard(cards: Card[], cardId: string, currentIso: string, runtimeNowIso = nowIso()): boolean {
  const normalizedCardId = normalizeCardIdInput(cardId);
  if (!normalizedCardId) {
    return false;
  }
  const effectiveCurrentIso = resolveActionClock(currentIso, runtimeNowIso);
  return cards.some(
    (card) =>
      isRuntimeCard(card) &&
      normalizeCardIdForMatch(card.id) === normalizedCardId &&
      isReviewReadyCard(card, effectiveCurrentIso),
  );
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
    if (renderedMs - runtimeMs > MAX_UI_FUTURE_SKEW_MS) {
      // Keep due queues aligned to runtime time once rendered UI drift exceeds tolerance.
      return canonicalRuntimeIso ?? wallClockIso;
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

export function resolveAddCardClock(renderedClockIso: string, runtimeNowIso: string): string {
  return resolveNextUiClock(renderedClockIso, runtimeNowIso);
}

export function resolveDeckClockTick(previousClockIso: string, runtimeNowIso: string): string {
  return resolveNextUiClock(previousClockIso, runtimeNowIso);
}

export function alignDueNowStatWithQueue(stats: DeckStats, dueCards: Card[]): DeckStats {
  if (stats.dueNow === dueCards.length) {
    return stats;
  }
  return {
    ...stats,
    dueNow: dueCards.length,
  };
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
    const runtimeNow = nowIso();
    // Use the rendered UI clock plus runtime clock so queue visibility never runs ahead of submit eligibility.
    return collectDueCards(deckState.cards, clockIso, runtimeNow);
  }, [clockIso, deckState.cards]);

  const addCard = useCallback((word: string, meaning: string, notes?: string) => {
    const normalizedWord = normalizeBoundedText(word, WORD_MAX_LENGTH);
    const normalizedMeaning = normalizeBoundedText(meaning, MEANING_MAX_LENGTH);
    const normalizedNotes = normalizeBoundedText(notes, NOTES_MAX_LENGTH);
    if (!normalizedWord || !normalizedMeaning) {
      return;
    }
    const current = resolveAddCardClock(clockIso, nowIso());
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
    const runtimeNow = nowIso();
    const current = resolveReviewClock(clockIso, runtimeNow);
    const next = applyReviewToDeckState(deckStateRef.current, cardId, rating, current, runtimeNow);
    if (!next.reviewed) {
      return false;
    }

    setDeckState(next.deckState);
    deckStateRef.current = next.deckState;
    setClockIso(resolveNextUiClock(current, next.deckState.lastReviewedAt));
    setCanPersist(true);
    return true;
  }, [clockIso]);

  const stats = useMemo(
    () => alignDueNowStatWithQueue(computeDeckStats(deckState.cards, effectiveClockIso), dueCards),
    [deckState.cards, dueCards, effectiveClockIso],
  );

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
