import {
  applyReviewToDeckState,
  applyDueReview,
  collectDueCards,
  compareDueCards,
  countOverdueCards,
  countScheduleRepairCards,
  countUpcomingDueCards,
  hasScheduleRepairNeed,
  hasDueCard,
  mergeDeckCards,
  resolveDeckClockTick,
  resolveNextUiClock,
  resolveReviewClock,
  selectLatestReviewedAt,
} from './hooks';
import { createNewCard } from './scheduler/fsrs';
import { addDaysIso } from './utils/time';
import type { Card, Rating } from './types';

const NOW = '2026-02-23T12:00:00.000Z';

describe('applyDueReview', () => {
  it('reviews only the target due card', () => {
    const due = createNewCard('alpha', 'first', NOW);
    const notDue = {
      ...createNewCard('beta', 'second', NOW),
      dueAt: '2026-02-24T12:00:00.000Z',
    };

    const result = applyDueReview([due, notDue], due.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0].reps).toBe(due.reps + 1);
    expect(result.cards[1]).toEqual(notDue);
  });

  it('does nothing when the target card is not due', () => {
    const card = {
      ...createNewCard('gamma', 'third', NOW),
      dueAt: '2026-02-24T12:00:00.000Z',
    };
    const cards = [card];

    const result = applyDueReview(cards, card.id, 4, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBeInstanceOf(Array);
    expect(result.cards).toBe(cards);
    expect(result.cards[0]).toEqual(card);
    expect(result.cards[0]).toBe(card);
  });

  it('reviews cards with malformed dueAt to recover corrupted schedules', () => {
    const malformed = {
      ...createNewCard('gamma-broken-due', 'third', NOW),
      dueAt: 'not-a-date',
      state: 'review' as const,
      updatedAt: NOW,
    };

    const result = applyDueReview([malformed], malformed.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(malformed);
    expect(Date.parse(result.cards[0].dueAt)).toBeGreaterThan(Date.parse(result.cards[0].updatedAt));
  });

  it('prioritizes malformed dueAt duplicates for immediate schedule repair', () => {
    const validDue = {
      ...createNewCard('valid-duplicate-due', 'first', NOW),
      id: 'duplicate-corrupted',
      dueAt: '2026-02-23T12:30:00.000Z',
    };
    const malformedDue = {
      ...createNewCard('broken-duplicate-due', 'second', NOW),
      id: 'duplicate-corrupted',
      dueAt: 'not-a-date',
      state: 'review' as const,
      updatedAt: NOW,
    };

    const result = applyDueReview([validDue, malformedDue], validDue.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).toBe(validDue);
    expect(result.cards[1]).not.toBe(malformedDue);
    expect(result.cards[1].updatedAt).toBe(NOW);
    expect(Number.isFinite(Date.parse(result.cards[1].dueAt))).toBe(true);
  });

  it('returns a new card object only for the reviewed target', () => {
    const due = createNewCard('delta', 'fourth', NOW);
    const secondDue = createNewCard('epsilon', 'fifth', NOW);

    const result = applyDueReview([due, secondDue], due.id, 4, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(due);
    expect(result.cards[1]).toBe(secondDue);
  });

  it('reviews the earliest due card when duplicate IDs exist', () => {
    const first = {
      ...createNewCard('zeta', 'sixth', NOW),
      dueAt: '2026-02-23T12:30:00.000Z',
    };
    const second = {
      ...createNewCard('eta', 'seventh', NOW),
      id: first.id,
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    const result = applyDueReview([first, second], first.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).toBe(first);
    expect(result.cards[0].reps).toBe(first.reps);
    expect(result.cards[1]).not.toBe(second);
    expect(result.cards[1].reps).toBe(second.reps + 1);
  });

  it('breaks due-time ties with older updatedAt when duplicate IDs exist', () => {
    const first = {
      ...createNewCard('zeta-tie', 'sixth', NOW),
      dueAt: '2026-02-23T12:00:00.000Z',
      updatedAt: '2026-02-23T11:00:00.000Z',
    };
    const second = {
      ...createNewCard('eta-tie', 'seventh', NOW),
      id: first.id,
      dueAt: '2026-02-23T12:00:00.000Z',
      updatedAt: '2026-02-23T11:10:00.000Z',
    };

    const result = applyDueReview([first, second], first.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(first);
    expect(result.cards[0].reps).toBe(first.reps + 1);
    expect(result.cards[1]).toBe(second);
  });

  it('prioritizes duplicate cards with malformed updatedAt for immediate timeline repair', () => {
    const valid = {
      ...createNewCard('zeta-malformed-updated', 'sixth', NOW),
      dueAt: '2026-02-23T12:00:00.000Z',
      updatedAt: '2026-02-23T11:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
      state: 'review' as const,
    };
    const malformed = {
      ...createNewCard('eta-malformed-updated', 'seventh', NOW),
      id: valid.id,
      dueAt: '2026-02-23T12:00:00.000Z',
      updatedAt: 'bad-updated-time',
      createdAt: 'bad-created-time',
      state: 'review' as const,
    };

    const result = applyDueReview([valid, malformed], valid.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).toBe(valid);
    expect(result.cards[1]).not.toBe(malformed);
    expect(result.cards[1].updatedAt).toBe(NOW);
    expect(Number.isFinite(Date.parse(result.cards[1].dueAt))).toBe(true);
  });

  it('does nothing when the target card ID does not exist', () => {
    const due = createNewCard('theta', 'eighth', NOW);
    const cards = [due];

    const result = applyDueReview(cards, 'missing-id', 3, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
  });

  it('falls back to runtime clock when review clock is invalid', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    try {
      const due = createNewCard('iota', 'ninth', NOW);
      const cards = [due];

      const result = applyDueReview(cards, due.id, 3, 'bad-clock');

      expect(result.reviewed).toBe(true);
      expect(result.cards[0]).not.toBe(due);
      expect(result.cards[0].reps).toBe(due.reps + 1);
      expect(result.reviewedAt).toBe('2026-02-23T12:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses runtime wall-safe clock when provided review clock is pathologically far future', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    try {
      const due = createNewCard('future-clock-review', 'safe', NOW);
      const cards = [due];

      const result = applyDueReview(cards, due.id, 3, '2099-01-01T00:00:00.000Z');

      expect(result.reviewed).toBe(true);
      expect(result.cards[0]).not.toBe(due);
      expect(result.cards[0].reps).toBe(due.reps + 1);
      expect(result.reviewedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(result.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps rendered clock when runtime would move review time pathologically backward', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:30:00.000Z'));
    try {
      const due = {
        ...createNewCard('backward-clock-review', 'safe', NOW),
        updatedAt: '2026-02-23T12:00:00.000Z',
        dueAt: '2026-02-23T12:00:00.000Z',
        state: 'review' as const,
      };

      const result = applyDueReview([due], due.id, 3, '2026-02-22T00:00:00.000Z');

      expect(result.reviewed).toBe(true);
      expect(result.reviewedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(result.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps non-due cards unchanged when review clock is invalid', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    try {
      const future = {
        ...createNewCard('iota-future', 'ninth', NOW),
        dueAt: addDaysIso(NOW, 1),
      };

      const result = applyDueReview([future], future.id, 3, 'bad-clock');

      expect(result.reviewed).toBe(false);
      expect(result.cards[0]).toBe(future);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns reviewedAt from scheduler when card timeline is ahead of runtime clock', () => {
    const due = {
      ...createNewCard('clock-skewed', 'test', NOW),
      updatedAt: '2026-02-23T12:10:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
      state: 'review' as const,
    };

    const result = applyDueReview([due], due.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.reviewedAt).toBe('2026-02-23T12:10:00.000Z');
    expect(result.cards[0].updatedAt).toBe('2026-02-23T12:10:00.000Z');
  });

  it('handles malformed ratings defensively without forcing a lapse', () => {
    const due = {
      ...createNewCard('invalid-rating-hook', 'safe', NOW),
      state: 'review' as const,
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 3,
      lapses: 1,
      stability: 2,
      difficulty: 5,
    };
    const reviewAt = addDaysIso(NOW, 1);

    const result = applyDueReview([due], due.id, Number.NaN as Rating, reviewAt);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0].state).toBe('review');
    expect(result.cards[0].lapses).toBe(1);
    expect(Date.parse(result.cards[0].dueAt)).toBeGreaterThan(Date.parse(result.cards[0].updatedAt));
  });

  it('treats malformed ratings as Again for learning cards to avoid accidental promotion', () => {
    const due = createNewCard('invalid-rating-learning', 'safe', NOW);
    const result = applyDueReview([due], due.id, Number.NaN as Rating, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0].state).toBe('learning');
    expect(result.cards[0].lapses).toBe(0);
    expect(result.cards[0].reps).toBe(1);
  });

  it('treats out-of-range review ratings as neutral instead of Easy promotions', () => {
    const due = {
      ...createNewCard('invalid-range-review-hook', 'safe', NOW),
      state: 'review' as const,
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 3,
      lapses: 1,
      stability: 2,
      difficulty: 5,
    };
    const reviewAt = addDaysIso(NOW, 1);

    const result = applyDueReview([due], due.id, 99 as Rating, reviewAt);
    const neutral = applyDueReview([due], due.id, 3, reviewAt);

    expect(result.reviewed).toBe(true);
    expect(neutral.reviewed).toBe(true);
    expect(result.cards[0].state).toBe('review');
    expect(result.cards[0].lapses).toBe(due.lapses);
    expect(result.cards[0].dueAt).toBe(neutral.cards[0].dueAt);
  });

  it('treats out-of-range learning ratings as Again to avoid accidental promotion', () => {
    const due = createNewCard('invalid-range-learning-hook', 'safe', NOW);
    const result = applyDueReview([due], due.id, 99 as Rating, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0].state).toBe('learning');
    expect(result.cards[0].lapses).toBe(0);
    expect(result.cards[0].reps).toBe(1);
  });

  it('treats fractional learning ratings as Again to avoid accidental promotion', () => {
    const due = createNewCard('invalid-fractional-learning-hook', 'safe', NOW);
    const result = applyDueReview([due], due.id, 2.8 as Rating, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0].state).toBe('learning');
    expect(result.cards[0].lapses).toBe(0);
    expect(result.cards[0].reps).toBe(1);
  });
});

describe('applyReviewToDeckState', () => {
  it('updates cards and lastReviewedAt when the target due card is reviewed', () => {
    const due = createNewCard('state-review', 'apply', NOW);
    const future = { ...createNewCard('state-future', 'keep', NOW), dueAt: '2026-02-24T12:00:00.000Z' };

    const result = applyReviewToDeckState(
      { cards: [due, future], lastReviewedAt: '2026-02-23T11:59:59.000Z' },
      due.id,
      3,
      NOW,
    );

    expect(result.reviewed).toBe(true);
    expect(result.deckState.cards[0].reps).toBe(due.reps + 1);
    expect(result.deckState.cards[1]).toBe(future);
    expect(result.deckState.lastReviewedAt).toBe(result.deckState.cards[0].updatedAt);
  });

  it('returns the original state object when no due review was applied', () => {
    const notDue = { ...createNewCard('state-not-due', 'skip', NOW), dueAt: '2026-02-24T12:00:00.000Z' };
    const state = { cards: [notDue], lastReviewedAt: '2026-02-23T12:00:00.000Z' };

    const result = applyReviewToDeckState(state, notDue.id, 4, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.deckState).toBe(state);
  });

  it('uses scheduler reviewedAt when card timeline is ahead of the provided clock', () => {
    const skewedDue = {
      ...createNewCard('state-clock', 'fallback', NOW),
      updatedAt: '2026-02-23T12:10:00.000Z',
      dueAt: NOW,
      state: 'review' as const,
    };
    const reviewClock = '2026-02-23T12:00:00.000Z';

    const result = applyReviewToDeckState({ cards: [skewedDue] }, skewedDue.id, 3, reviewClock);

    expect(result.reviewed).toBe(true);
    expect(result.deckState.lastReviewedAt).toBe('2026-02-23T12:10:00.000Z');
  });

  it('keeps lastReviewedAt monotonic when provided review clock is older', () => {
    const due = createNewCard('state-monotonic', 'clock', NOW);
    const result = applyReviewToDeckState(
      { cards: [due], lastReviewedAt: '2026-02-23T13:00:00.000Z' },
      due.id,
      3,
      NOW,
    );

    expect(result.reviewed).toBe(true);
    expect(result.deckState.lastReviewedAt).toBe('2026-02-23T13:00:00.000Z');
  });

  it('normalizes newer scheduler reviewedAt values into canonical ISO format', () => {
    const skewedDue = {
      ...createNewCard('state-monotonic-canonical', 'clock', NOW),
      updatedAt: '2026-02-23T12:10:00Z',
      dueAt: NOW,
      state: 'review' as const,
    };

    const result = applyReviewToDeckState(
      { cards: [skewedDue], lastReviewedAt: '2026-02-23T12:00:00.000Z' },
      skewedDue.id,
      3,
      NOW,
    );

    expect(result.reviewed).toBe(true);
    expect(result.deckState.lastReviewedAt).toBe('2026-02-23T12:10:00.000Z');
  });
});

describe('compareDueCards', () => {
  it('orders by dueAt, then updatedAt, then createdAt, then id', () => {
    const base = createNewCard('kappa', 'letter', NOW);
    const cards = [
      {
        ...base,
        id: 'c',
        dueAt: '2026-02-24T00:00:00.000Z',
        updatedAt: '2026-02-23T05:00:00.000Z',
        createdAt: '2026-02-20T00:00:00.000Z',
      },
      {
        ...base,
        id: 'b',
        dueAt: '2026-02-24T00:00:00.000Z',
        updatedAt: '2026-02-23T04:00:00.000Z',
        createdAt: '2026-02-20T00:00:00.000Z',
      },
      {
        ...base,
        id: 'a',
        dueAt: '2026-02-23T23:00:00.000Z',
        updatedAt: '2026-02-23T07:00:00.000Z',
        createdAt: '2026-02-21T00:00:00.000Z',
      },
      {
        ...base,
        id: 'd',
        dueAt: '2026-02-24T00:00:00.000Z',
        updatedAt: '2026-02-23T04:00:00.000Z',
        createdAt: '2026-02-19T00:00:00.000Z',
      },
    ];

    const orderedIds = [...cards].sort(compareDueCards).map((card) => card.id);

    expect(orderedIds).toEqual(['a', 'd', 'b', 'c']);
  });

  it('sorts malformed dueAt cards ahead of valid due cards for queue repair', () => {
    const base = createNewCard('queue-repair', 'ordering', NOW);
    const malformed = {
      ...base,
      id: 'malformed',
      dueAt: 'bad-due',
      updatedAt: '2026-02-23T11:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };
    const valid = {
      ...base,
      id: 'valid',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const orderedIds = [valid, malformed].sort(compareDueCards).map((card) => card.id);

    expect(orderedIds).toEqual(['malformed', 'valid']);
  });

  it('sorts malformed updatedAt/createdAt cards first when dueAt ties to prioritize repair', () => {
    const base = createNewCard('queue-repair-tie', 'ordering', NOW);
    const malformedTimeline = {
      ...base,
      id: 'malformed-timeline',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: 'bad-updated',
      createdAt: 'bad-created',
    };
    const validTimeline = {
      ...base,
      id: 'valid-timeline',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const orderedIds = [validTimeline, malformedTimeline].sort(compareDueCards).map((card) => card.id);

    expect(orderedIds).toEqual(['malformed-timeline', 'valid-timeline']);
  });
});

describe('collectDueCards', () => {
  it('filters due cards using the same wall-safe review clock used for submissions', () => {
    const dueIfFutureClock = {
      ...createNewCard('future-queue-guard', 'clock', NOW),
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    const dueCards = collectDueCards(
      [dueIfFutureClock],
      '2099-01-01T00:00:00.000Z',
      '2026-02-23T12:00:00.000Z',
    );

    expect(dueCards).toHaveLength(0);
  });

  it('keeps malformed dueAt cards in front for immediate repair', () => {
    const malformed = {
      ...createNewCard('malformed-queue', 'repair', NOW),
      dueAt: 'bad-due',
      updatedAt: '2026-02-23T11:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };
    const valid = {
      ...createNewCard('valid-queue', 'repair', NOW),
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const dueCards = collectDueCards([valid, malformed], NOW, NOW);

    expect(dueCards).toHaveLength(2);
    expect(dueCards[0].id).toBe(malformed.id);
    expect(dueCards[1].id).toBe(valid.id);
  });

  it('uses the provided effective clock deterministically for near-boundary due cards', () => {
    const nearFuture = {
      ...createNewCard('near-boundary', 'queue', NOW),
      dueAt: '2026-02-23T12:00:30.000Z',
    };

    const notYetDue = collectDueCards([nearFuture], '2026-02-23T12:00:00.000Z', '2026-02-23T12:00:00.000Z');
    const nowDue = collectDueCards([nearFuture], '2026-02-23T12:00:31.000Z', '2026-02-23T12:00:31.000Z');

    expect(notYetDue).toHaveLength(0);
    expect(nowDue).toHaveLength(1);
    expect(nowDue[0].id).toBe(nearFuture.id);
  });
});

describe('mergeDeckCards', () => {
  it('keeps in-memory cards first and appends unique loaded cards', () => {
    const local = createNewCard('local', 'memory', NOW);
    const shared = createNewCard('shared-local', 'memory', NOW);
    const loadedShared = { ...shared, word: 'shared-loaded' };
    const loadedUnique = createNewCard('loaded', 'storage', NOW);

    const merged = mergeDeckCards([local, shared], [loadedShared, loadedUnique]);

    expect(merged.map((card) => card.id)).toEqual([local.id, shared.id, loadedUnique.id]);
    expect(merged[1].word).toBe('shared-local');
  });

  it('returns original references when one side is empty', () => {
    const local = createNewCard('only-local', 'memory', NOW);
    const loaded = createNewCard('only-loaded', 'storage', NOW);

    expect(mergeDeckCards([local], [])).toEqual([local]);
    expect(mergeDeckCards([], [loaded])).toEqual([loaded]);
  });

  it('prefers fresher loaded duplicates when updatedAt is newer', () => {
    const local = {
      ...createNewCard('shared', 'old-local', NOW),
      id: 'shared-id',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
    };
    const loaded = {
      ...createNewCard('shared', 'new-loaded', NOW),
      id: 'shared-id',
      updatedAt: '2026-02-23T11:00:00.000Z',
      dueAt: '2026-02-24T11:00:00.000Z',
      reps: 3,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('new-loaded');
    expect(merged[0].updatedAt).toBe('2026-02-23T11:00:00.000Z');
    expect(merged[0].reps).toBe(3);
  });

  it('keeps in-memory duplicate when timestamps are tied', () => {
    const local = {
      ...createNewCard('tie', 'local', NOW),
      id: 'tie-id',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
      lapses: 1,
    };
    const loaded = {
      ...createNewCard('tie', 'loaded', NOW),
      id: 'tie-id',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
      lapses: 1,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged[0].meaning).toBe('local');
  });

  it('deduplicates duplicate IDs that already exist in memory', () => {
    const older = {
      ...createNewCard('dup-memory-older', 'older', NOW),
      id: 'dup-memory',
      updatedAt: '2026-02-23T09:00:00.000Z',
      dueAt: '2026-02-24T09:00:00.000Z',
      reps: 1,
    };
    const newer = {
      ...createNewCard('dup-memory-newer', 'newer', NOW),
      id: 'dup-memory',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
    };

    const merged = mergeDeckCards([older, newer], []);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('dup-memory');
    expect(merged[0].meaning).toBe('newer');
    expect(merged[0].updatedAt).toBe('2026-02-23T10:00:00.000Z');
    expect(merged[0].reps).toBe(2);
  });

  it('deduplicates duplicate IDs coming from loaded cards', () => {
    const loadedOlder = {
      ...createNewCard('dup-loaded-older', 'older', NOW),
      id: 'dup-loaded',
      updatedAt: '2026-02-23T09:00:00.000Z',
      dueAt: '2026-02-24T09:00:00.000Z',
      reps: 1,
    };
    const loadedNewer = {
      ...createNewCard('dup-loaded-newer', 'newer', NOW),
      id: 'dup-loaded',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
    };

    const merged = mergeDeckCards([], [loadedOlder, loadedNewer]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('dup-loaded');
    expect(merged[0].meaning).toBe('newer');
    expect(merged[0].updatedAt).toBe('2026-02-23T10:00:00.000Z');
    expect(merged[0].reps).toBe(2);
  });

  it('prefers higher reps over later dueAt when updatedAt ties', () => {
    const local = {
      ...createNewCard('tie-reps-local', 'local', NOW),
      id: 'tie-reps',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-27T10:00:00.000Z',
      reps: 2,
      lapses: 0,
    };
    const loaded = {
      ...createNewCard('tie-reps-loaded', 'loaded', NOW),
      id: 'tie-reps',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 4,
      lapses: 0,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].reps).toBe(4);
    expect(merged[0].dueAt).toBe('2026-02-24T10:00:00.000Z');
  });

  it('prefers earlier dueAt when merge candidates are otherwise tied', () => {
    const local = {
      ...createNewCard('tie-due-local', 'local', NOW),
      id: 'tie-due',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-27T10:00:00.000Z',
      reps: 3,
      lapses: 1,
    };
    const loaded = {
      ...createNewCard('tie-due-loaded', 'loaded', NOW),
      id: 'tie-due',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 3,
      lapses: 1,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].dueAt).toBe('2026-02-24T10:00:00.000Z');
  });

  it('prefers earlier createdAt when merge candidates are otherwise tied', () => {
    const local = {
      ...createNewCard('tie-created-local', 'local', NOW),
      id: 'tie-created',
      createdAt: '2026-02-23T10:30:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 3,
      lapses: 1,
    };
    const loaded = {
      ...createNewCard('tie-created-loaded', 'loaded', NOW),
      id: 'tie-created',
      createdAt: '2026-02-23T09:30:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 3,
      lapses: 1,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].createdAt).toBe('2026-02-23T09:30:00.000Z');
  });

  it('prefers finite counters when duplicate cards tie on timestamps and due dates', () => {
    const local = {
      ...createNewCard('tie-counter-local', 'local', NOW),
      id: 'tie-counter',
      createdAt: '2026-02-23T10:00:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: Number.NaN,
      lapses: Number.NaN,
    };
    const loaded = {
      ...createNewCard('tie-counter-loaded', 'loaded', NOW),
      id: 'tie-counter',
      createdAt: '2026-02-23T10:00:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 4,
      lapses: 1,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].reps).toBe(4);
    expect(merged[0].lapses).toBe(1);
  });

  it('ignores negative and fractional counters when merge candidates tie', () => {
    const local = {
      ...createNewCard('tie-counter-local-sanitized', 'local', NOW),
      id: 'tie-counter-sanitized',
      createdAt: '2026-02-23T10:00:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 1.9,
      lapses: -2,
    };
    const loaded = {
      ...createNewCard('tie-counter-loaded-sanitized', 'loaded', NOW),
      id: 'tie-counter-sanitized',
      createdAt: '2026-02-23T10:00:00.000Z',
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 1,
      lapses: 0,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].reps).toBe(1);
    expect(merged[0].lapses).toBe(0);
  });
});

describe('hasDueCard', () => {
  it('returns true only when a matching card is due at the provided clock', () => {
    const due = createNewCard('due', 'ready', NOW);
    const future = { ...createNewCard('future', 'later', NOW), dueAt: '2026-02-24T12:00:00.000Z' };

    expect(hasDueCard([due, future], due.id, NOW)).toBe(true);
    expect(hasDueCard([due, future], future.id, NOW)).toBe(false);
  });

  it('falls back to runtime wall clock when the provided clock is invalid', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const due = createNewCard('invalid-clock', 'test', NOW);
      expect(hasDueCard([due], due.id, 'bad-clock')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores pathologically future rendered clocks and falls back to runtime for due checks', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const future = { ...createNewCard('future-clock', 'test', NOW), dueAt: '2026-02-24T12:00:00.000Z' };
      expect(hasDueCard([future], future.id, '2099-01-01T00:00:00.000Z')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats malformed dueAt as review-ready so broken cards can be repaired', () => {
    const malformed = {
      ...createNewCard('broken-has-due', 'recover', NOW),
      dueAt: 'bad-due-at',
    };

    expect(hasDueCard([malformed], malformed.id, NOW)).toBe(true);
  });
});

describe('countUpcomingDueCards', () => {
  it('counts only cards due after now and within the upcoming window', () => {
    const now = NOW;
    const dueNow = createNewCard('due-now', 'now', now);
    const overdue = { ...createNewCard('overdue', 'past', now), dueAt: '2026-02-23T11:00:00.000Z' };
    const upcoming = { ...createNewCard('upcoming', 'soon', now), dueAt: '2026-02-23T18:00:00.000Z' };
    const tooFar = { ...createNewCard('too-far', 'later', now), dueAt: '2026-02-24T12:00:01.000Z' };

    expect(countUpcomingDueCards([dueNow, overdue, upcoming, tooFar], now)).toBe(1);
  });

  it('returns zero for invalid runtime clocks', () => {
    const card = createNewCard('invalid-clock-upcoming', 'test', NOW);
    expect(countUpcomingDueCards([card], 'bad-clock')).toBe(0);
  });

  it('ignores cards with malformed dueAt values at runtime', () => {
    const malformed = { ...createNewCard('malformed-upcoming', 'test', NOW), dueAt: null } as unknown as Card;

    expect(countUpcomingDueCards([malformed], NOW)).toBe(0);
  });

  it('returns zero when the requested upcoming window is non-positive', () => {
    const upcoming = { ...createNewCard('upcoming-window', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, 0)).toBe(0);
    expect(countUpcomingDueCards([upcoming], NOW, -5)).toBe(0);
  });

  it('returns zero when the requested upcoming window is non-finite', () => {
    const upcoming = { ...createNewCard('upcoming-window-2', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, Number.NaN)).toBe(0);
  });

  it('returns zero when hours overflow the millisecond window math', () => {
    const upcoming = { ...createNewCard('upcoming-window-3', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, Number.MAX_VALUE)).toBe(0);
  });
});

describe('countOverdueCards', () => {
  it('counts only cards that are meaningfully overdue', () => {
    const overdue = { ...createNewCard('overdue-count', 'test', NOW), dueAt: '2026-02-23T10:00:00.000Z' };
    const dueNow = { ...createNewCard('due-now-count', 'test', NOW), dueAt: '2026-02-23T12:00:30.000Z' };
    const future = { ...createNewCard('future-count', 'test', NOW), dueAt: '2026-02-23T13:00:00.000Z' };

    expect(countOverdueCards([overdue, dueNow, future], NOW)).toBe(1);
  });

  it('counts cards that are exactly at the overdue grace cutoff', () => {
    const atGraceCutoff = {
      ...createNewCard('overdue-grace-cutoff', 'test', NOW),
      dueAt: '2026-02-23T11:59:00.000Z',
    };

    expect(countOverdueCards([atGraceCutoff], NOW)).toBe(1);
  });

  it('returns zero for invalid runtime clocks', () => {
    const overdue = { ...createNewCard('overdue-invalid-clock', 'test', NOW), dueAt: '2026-02-23T10:00:00.000Z' };
    expect(countOverdueCards([overdue], 'bad-clock')).toBe(0);
  });

  it('counts malformed dueAt values so schedule repairs stay visible', () => {
    const malformed = { ...createNewCard('malformed-overdue', 'test', NOW), dueAt: null } as unknown as Card;

    expect(countOverdueCards([malformed], NOW)).toBe(1);
  });
});

describe('hasScheduleRepairNeed', () => {
  it('flags cards with malformed dueAt or updatedAt values', () => {
    const malformedDue = { ...createNewCard('repair-bad-due', 'test', NOW), dueAt: 'bad-due' };
    const malformedUpdated = { ...createNewCard('repair-bad-updated', 'test', NOW), updatedAt: 'bad-updated' };

    expect(hasScheduleRepairNeed(malformedDue)).toBe(true);
    expect(hasScheduleRepairNeed(malformedUpdated)).toBe(true);
  });

  it('flags cards with dueAt before updatedAt', () => {
    const broken = {
      ...createNewCard('repair-due-before-updated', 'test', NOW),
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T11:59:59.000Z',
    };

    expect(hasScheduleRepairNeed(broken)).toBe(true);
  });

  it('does not flag learning cards due exactly at updatedAt', () => {
    const learningDueNow = {
      ...createNewCard('repair-learning-due-now', 'test', NOW),
      state: 'learning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(learningDueNow)).toBe(false);
  });

  it('flags review cards due exactly at updatedAt', () => {
    const reviewDueNow = {
      ...createNewCard('repair-review-due-now', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(reviewDueNow)).toBe(true);
  });

  it('flags review cards scheduled below the half-day review floor', () => {
    const reviewTooSoon = {
      ...createNewCard('repair-review-too-soon', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(hasScheduleRepairNeed(reviewTooSoon)).toBe(true);
  });

  it('flags relearning cards scheduled below the 10-minute relearning floor', () => {
    const relearningTooSoon = {
      ...createNewCard('repair-relearning-too-soon', 'test', NOW),
      state: 'relearning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:05:00.000Z',
    };

    expect(hasScheduleRepairNeed(relearningTooSoon)).toBe(true);
  });

  it('does not flag learning cards scheduled at the one-minute learning floor', () => {
    const learningAtFloor = {
      ...createNewCard('repair-learning-floor', 'test', NOW),
      state: 'learning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:01:00.000Z',
    };

    expect(hasScheduleRepairNeed(learningAtFloor)).toBe(false);
  });

  it('flags cards with unknown state values for scheduler repair', () => {
    const unknownState = {
      ...createNewCard('repair-unknown-state', 'test', NOW),
      state: 'archived' as unknown as Card['state'],
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(hasScheduleRepairNeed(unknownState)).toBe(true);
  });

  it('accepts folded relearning state aliases at the minimum relearning floor', () => {
    const foldedRelearning = {
      ...createNewCard('repair-folded-relearning', 'test', NOW),
      state: 're-learning' as unknown as Card['state'],
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(hasScheduleRepairNeed(foldedRelearning)).toBe(false);
  });

  it('does not flag healthy schedules', () => {
    const healthy = {
      ...createNewCard('repair-healthy', 'test', NOW),
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(hasScheduleRepairNeed(healthy)).toBe(false);
  });
});

describe('countScheduleRepairCards', () => {
  it('counts malformed and timeline-broken schedules', () => {
    const malformedDue = { ...createNewCard('repair-count-bad-due', 'test', NOW), dueAt: 'bad-due' };
    const malformedUpdated = { ...createNewCard('repair-count-bad-updated', 'test', NOW), updatedAt: 'bad-updated' };
    const dueBeforeUpdated = {
      ...createNewCard('repair-count-due-before-updated', 'test', NOW),
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T11:59:59.000Z',
    };
    const healthy = {
      ...createNewCard('repair-count-healthy', 'test', NOW),
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(countScheduleRepairCards([malformedDue, malformedUpdated, dueBeforeUpdated, healthy])).toBe(3);
  });

  it('does not count learning cards that are due immediately at creation', () => {
    const learningDueNow = {
      ...createNewCard('repair-count-learning-now', 'test', NOW),
      state: 'learning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };
    const reviewDueNow = {
      ...createNewCard('repair-count-review-now', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(countScheduleRepairCards([learningDueNow, reviewDueNow])).toBe(1);
  });
});

describe('selectLatestReviewedAt', () => {
  it('prefers the latest valid timestamp', () => {
    expect(selectLatestReviewedAt('2026-02-23T10:00:00.000Z', '2026-02-23T11:00:00.000Z')).toBe(
      '2026-02-23T11:00:00.000Z',
    );
    expect(selectLatestReviewedAt('2026-02-23T11:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(
      '2026-02-23T11:00:00.000Z',
    );
  });

  it('ignores invalid incoming values', () => {
    expect(selectLatestReviewedAt('2026-02-23T11:00:00.000Z', 'bad-time')).toBe('2026-02-23T11:00:00.000Z');
    expect(selectLatestReviewedAt(undefined, 'bad-time')).toBeUndefined();
  });

  it('drops invalid current values and keeps valid incoming ones', () => {
    expect(selectLatestReviewedAt('bad-time', '2026-02-23T12:00:00.000Z')).toBe('2026-02-23T12:00:00.000Z');
    expect(selectLatestReviewedAt('bad-time', 'also-bad')).toBeUndefined();
  });

  it('returns canonical ISO timestamps for valid values', () => {
    expect(selectLatestReviewedAt('2026-02-23T12:00:00Z', undefined)).toBe('2026-02-23T12:00:00.000Z');
    expect(selectLatestReviewedAt('2026-02-23T11:00:00Z', '2026-02-23T12:00:00Z')).toBe(
      '2026-02-23T12:00:00.000Z',
    );
  });
});

describe('resolveReviewClock', () => {
  it('uses runtime clock when it is current or ahead of the rendered clock', () => {
    expect(resolveReviewClock('2026-02-23T12:00:00.000Z', '2026-02-23T12:00:10.000Z')).toBe(
      '2026-02-23T12:00:10.000Z',
    );
  });

  it('returns canonical timestamps when inputs are valid but non-canonical', () => {
    expect(resolveReviewClock('2026-02-23T12:00:00Z', '2026-02-23T12:00:10Z')).toBe('2026-02-23T12:00:10.000Z');
  });

  it('keeps rendered clock when runtime clock moves backward', () => {
    expect(resolveReviewClock('2026-02-23T12:00:10.000Z', '2026-02-23T12:00:00.000Z')).toBe(
      '2026-02-23T12:00:10.000Z',
    );
  });

  it('falls back to the valid timestamp when one clock value is invalid', () => {
    expect(resolveReviewClock('bad-time', '2026-02-23T12:00:00.000Z')).toBe('2026-02-23T12:00:00.000Z');
    expect(resolveReviewClock('2026-02-23T12:00:00.000Z', 'bad-time')).toBe('2026-02-23T12:00:00.000Z');
  });

  it('prefers runtime clock when rendered clock is pathologically far ahead', () => {
    expect(resolveReviewClock('2099-01-01T00:00:00.000Z', '2026-02-23T12:00:00.000Z')).toBe(
      '2026-02-23T12:00:00.000Z',
    );
  });

  it('keeps rendered clock when runtime clock has a large backward skew but rendered time is wall-safe', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:30:00.000Z'));
    const resolved = resolveReviewClock('2026-02-23T12:00:00.000Z', '2026-02-22T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });

  it('keeps rendered clock when runtime clock is pathologically far ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const resolved = resolveReviewClock('2026-02-23T12:00:00.000Z', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });

  it('falls back to wall clock when runtime is pathologically ahead and rendered time is pathologically stale', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const resolved = resolveReviewClock('2026-02-20T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });

  it('falls back to wall clock when both rendered and runtime clocks are pathologically far ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveReviewClock('2099-01-01T00:00:00.000Z', '2099-01-01T01:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
  });

  it('still prefers wall-safe time when rendered clock is far ahead of an already-pathological runtime clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveReviewClock('2099-01-03T00:00:00.000Z', '2099-01-01T01:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to wall clock when only rendered clock is valid but pathologically far ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const reviewedAt = resolveReviewClock('2099-01-01T00:00:00.000Z', 'bad-time');
    nowSpy.mockRestore();

    expect(Date.parse(reviewedAt)).toBe(Date.parse('2026-02-23T12:00:00.000Z'));
  });

  it('falls back to wall clock when only rendered clock is valid but pathologically far behind', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const reviewedAt = resolveReviewClock('2026-02-20T00:00:00.000Z', 'bad-time');
    nowSpy.mockRestore();

    expect(Date.parse(reviewedAt)).toBe(Date.parse('2026-02-23T12:00:00.000Z'));
  });

  it('falls back to wall clock when both rendered and runtime clocks are invalid', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const reviewedAt = resolveReviewClock('bad-rendered-time', 'bad-runtime-time');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to wall clock when only runtime clock is valid but pathologically far ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const reviewedAt = resolveReviewClock('bad-rendered-time', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to wall clock when only runtime clock is valid but pathologically far behind', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const reviewedAt = resolveReviewClock('bad-rendered-time', '2026-02-20T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to wall clock when runtime is pathologically behind and rendered time is pathologically stale', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const reviewedAt = resolveReviewClock('2026-02-20T00:00:00.000Z', '2026-02-19T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to epoch when wall clock is non-finite and both inputs are invalid', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const reviewedAt = resolveReviewClock('bad-rendered-time', 'bad-runtime-time');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps valid review timestamps when wall clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const reviewedAt = resolveReviewClock('2026-02-23T12:00:00.000Z', '2026-02-23T12:05:00.000Z');
    nowSpy.mockRestore();

    expect(reviewedAt).toBe('2026-02-23T12:05:00.000Z');
  });
});

describe('resolveNextUiClock', () => {
  it('keeps the current clock when reviewedAt is missing', () => {
    expect(resolveNextUiClock('2026-02-23T12:00:00.000Z')).toBe('2026-02-23T12:00:00.000Z');
  });

  it('advances to reviewedAt when scheduler review time is newer', () => {
    expect(resolveNextUiClock('2026-02-23T12:00:00.000Z', '2026-02-23T12:10:00.000Z')).toBe(
      '2026-02-23T12:10:00.000Z',
    );
  });

  it('keeps current clock when reviewedAt is older or invalid', () => {
    expect(resolveNextUiClock('2026-02-23T12:10:00.000Z', '2026-02-23T12:00:00.000Z')).toBe(
      '2026-02-23T12:10:00.000Z',
    );
    expect(resolveNextUiClock('2026-02-23T12:10:00.000Z', 'bad-time')).toBe('2026-02-23T12:10:00.000Z');
  });

  it('falls back to wall clock when both current and reviewed clock values are invalid', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('bad-current-time', 'bad-reviewed-time');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
  });

  it('keeps the current clock when reviewedAt is pathologically far in the future', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2026-02-23T12:10:00.000Z', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:10:00.000Z');
  });

  it('falls back to wall clock when current and reviewed values are both pathologically skewed', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2026-02-20T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
  });

  it('prefers wall-safe reviewedAt when current clock is pathologically ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2099-01-01T00:00:00.000Z', '2026-02-23T12:10:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:10:00.000Z');
  });

  it('prefers wall-safe reviewedAt when current clock is pathologically behind', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2026-02-20T00:00:00.000Z', '2026-02-23T12:10:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:10:00.000Z');
  });

  it('ignores reviewedAt values that are materially ahead of wall clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2026-02-23T12:34:30.000Z', '2026-02-23T12:40:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:30.000Z');
  });

  it('falls back to wall clock when both UI clock candidates are ahead of wall clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveNextUiClock('2026-02-23T12:40:00.000Z', '2026-02-23T12:42:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
  });

  it('falls back to epoch when wall clock is non-finite and inputs are invalid', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const resolved = resolveNextUiClock('bad-current-time', 'bad-reviewed-time');
    nowSpy.mockRestore();

    expect(resolved).toBe('1970-01-01T00:00:00.000Z');
  });

  it('keeps valid UI clocks when wall clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const resolved = resolveNextUiClock('2026-02-23T12:10:00.000Z', '2026-02-23T12:15:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:15:00.000Z');
  });
});

describe('resolveDeckClockTick', () => {
  it('advances UI clock with wall-safe runtime ticks', () => {
    expect(resolveDeckClockTick('2026-02-23T12:00:00.000Z', '2026-02-23T12:00:10.000Z')).toBe(
      '2026-02-23T12:00:10.000Z',
    );
  });

  it('ignores pathologically future runtime ticks and keeps the previous UI clock', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:05.000Z'));
    const resolved = resolveDeckClockTick('2026-02-23T12:00:00.000Z', '2099-01-01T00:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });
});
