import {
  alignDueNowStatWithQueue,
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
  resolveAddCardClock,
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

  it('skips malformed runtime deck entries and still reviews the matching due card', () => {
    const due = createNewCard('apply-due-malformed-runtime', 'safe', NOW);
    const malformedCards = [null, { dueAt: NOW }, due] as unknown as Card[];

    const result = applyDueReview(malformedCards, due.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[2]).not.toBe(due);
    expect(result.cards[2].reps).toBe(due.reps + 1);
  });

  it('does not crash when a due card throws during scheduler normalization', () => {
    const throwingCard = createNewCard('throwing-difficulty', 'safe', NOW);
    Object.defineProperty(throwingCard, 'difficulty', {
      get() {
        throw new Error('bad runtime difficulty');
      },
    });
    const cards = [throwingCard];

    const result = applyDueReview(cards, throwingCard.id, 3, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
    expect(result.cards[0]).toBe(throwingCard);
  });

  it('falls through to the next due duplicate when the highest-priority candidate throws', () => {
    const validCandidate = {
      ...createNewCard('valid-duplicate-review', 'safe', NOW),
      id: 'duplicate-fallback-review',
      dueAt: '2026-02-23T12:10:00.000Z',
      updatedAt: '2026-02-23T11:40:00.000Z',
      state: 'review' as const,
    };
    const throwingCandidate = {
      ...createNewCard('throwing-duplicate-review', 'safe', NOW),
      id: 'duplicate-fallback-review',
      dueAt: '2026-02-23T12:00:00.000Z',
      updatedAt: '2026-02-23T11:30:00.000Z',
      state: 'review' as const,
    };
    Object.defineProperty(throwingCandidate, 'difficulty', {
      get() {
        throw new Error('bad runtime difficulty');
      },
    });

    const result = applyDueReview([throwingCandidate, validCandidate], 'duplicate-fallback-review', 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).toBe(throwingCandidate);
    expect(result.cards[1]).not.toBe(validCandidate);
    expect(result.cards[1].reps).toBe(validCandidate.reps + 1);
  });

  it('returns not reviewed when all due duplicates throw during scheduler normalization', () => {
    const firstThrowing = createNewCard('throwing-duplicate-first', 'safe', NOW);
    const secondThrowing = {
      ...createNewCard('throwing-duplicate-second', 'safe', NOW),
      id: firstThrowing.id,
    };
    Object.defineProperty(firstThrowing, 'difficulty', {
      get() {
        throw new Error('bad runtime difficulty first');
      },
    });
    Object.defineProperty(secondThrowing, 'difficulty', {
      get() {
        throw new Error('bad runtime difficulty second');
      },
    });

    const cards = [firstThrowing, secondThrowing];
    const result = applyDueReview(cards, firstThrowing.id, 3, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
    expect(result.cards[0]).toBe(firstThrowing);
    expect(result.cards[1]).toBe(secondThrowing);
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

  it('reviews pathologically future timelines to recover corrupted schedules', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const futureCorrupted = {
        ...createNewCard('gamma-future-corrupted', 'third', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-24T12:00:01.000Z',
        dueAt: '2026-02-25T12:00:01.000Z',
      };

      const result = applyDueReview([futureCorrupted], futureCorrupted.id, 3, NOW);

      expect(result.reviewed).toBe(true);
      expect(result.cards[0]).not.toBe(futureCorrupted);
      expect(result.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(Date.parse(result.cards[0].dueAt)).toBeGreaterThan(Date.parse(result.cards[0].updatedAt));
    } finally {
      jest.useRealTimers();
    }
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

  it('trims surrounding whitespace in target card IDs before matching', () => {
    const due = createNewCard('trimmed-id-target', 'safe', NOW);

    const result = applyDueReview([due], ` ${due.id} `, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(due);
    expect(result.cards[0].reps).toBe(due.reps + 1);
  });

  it('matches due cards when stored card IDs include surrounding whitespace', () => {
    const due = {
      ...createNewCard('trimmed-stored-id', 'safe', NOW),
      id: '  whitespace-stored-id  ',
    };

    const result = applyDueReview([due], 'whitespace-stored-id', 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(due);
    expect(result.cards[0].reps).toBe(due.reps + 1);
  });

  it('does nothing when the target card ID is malformed', () => {
    const due = {
      ...createNewCard('invalid-target-id', 'eighth', NOW),
      id: undefined as unknown as string,
    };
    const cards = [due];

    const result = applyDueReview(cards, undefined as unknown as string, 3, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
    expect(result.cards[0]).toBe(due);
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

  it('normalizes reviewedAt into canonical ISO format for valid review clocks', () => {
    const due = createNewCard('canonical-reviewed-at', 'safe', NOW);
    const cards = [due];

    const result = applyDueReview(cards, due.id, 3, '2026-02-23T12:00:00Z');

    expect(result.reviewed).toBe(true);
    expect(result.reviewedAt).toBe('2026-02-23T12:00:00.000Z');
    expect(result.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
  });

  it('keeps valid provided review clocks deterministic instead of advancing to runtime', () => {
    const nearBoundary = {
      ...createNewCard('deterministic-valid-review-clock', 'safe', NOW),
      dueAt: '2026-02-23T12:00:20.000Z',
    };

    const result = applyDueReview(
      [nearBoundary],
      nearBoundary.id,
      3,
      '2026-02-23T12:00:00.000Z',
      '2026-02-23T12:00:30.000Z',
    );

    expect(result.reviewed).toBe(false);
    expect(result.cards[0]).toBe(nearBoundary);
  });

  it('uses runtime clock when rendered review clock is stale beyond tolerance', () => {
    const staleClockDue = {
      ...createNewCard('stale-render-clock-review', 'safe', NOW),
      dueAt: '2026-02-23T12:01:00.000Z',
      updatedAt: NOW,
      state: 'review' as const,
    };

    const result = applyDueReview(
      [staleClockDue],
      staleClockDue.id,
      3,
      '2026-02-23T12:00:00.000Z',
      '2026-02-23T12:02:30.000Z',
    );

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(staleClockDue);
    expect(result.cards[0].updatedAt).toBe('2026-02-23T12:02:30.000Z');
    expect(result.reviewedAt).toBe('2026-02-23T12:02:30.000Z');
  });

  it('keeps rendered review clock when runtime is ahead exactly at tolerance boundary', () => {
    const toleranceBoundary = {
      ...createNewCard('review-clock-tolerance-boundary', 'safe', NOW),
      dueAt: '2026-02-23T12:00:50.000Z',
      updatedAt: NOW,
      state: 'review' as const,
    };

    const result = applyDueReview(
      [toleranceBoundary],
      toleranceBoundary.id,
      3,
      '2026-02-23T12:00:00.000Z',
      '2026-02-23T12:01:00.000Z',
    );

    expect(result.reviewed).toBe(false);
    expect(result.cards[0]).toBe(toleranceBoundary);
  });

  it('does not review early when rendered clock is ahead of runtime', () => {
    const nearBoundary = {
      ...createNewCard('no-early-review-clock', 'safe', NOW),
      dueAt: '2026-02-23T12:00:30.000Z',
    };

    const result = applyDueReview(
      [nearBoundary],
      nearBoundary.id,
      3,
      '2026-02-23T12:01:00.000Z',
      '2026-02-23T12:00:00.000Z',
    );

    expect(result.reviewed).toBe(false);
    expect(result.cards[0]).toBe(nearBoundary);
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

  it('treats loose non-ISO dueAt values as malformed for queue repair priority', () => {
    const base = createNewCard('queue-repair-loose-iso', 'ordering', NOW);
    const looseDue = {
      ...base,
      id: 'loose-due',
      dueAt: '2026-02-23 11:30:00Z',
      updatedAt: '2026-02-23T11:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };
    const valid = {
      ...base,
      id: 'valid-due',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const orderedIds = [valid, looseDue].sort(compareDueCards).map((card) => card.id);

    expect(orderedIds).toEqual(['loose-due', 'valid-due']);
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

  it('does not throw when malformed ids are encountered during tie-break sorting', () => {
    const base = createNewCard('queue-id-repair', 'ordering', NOW);
    const malformed = {
      ...base,
      id: null as unknown as string,
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };
    const valid = {
      ...base,
      id: 'valid-id',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    expect(() => [valid, malformed].sort(compareDueCards)).not.toThrow();
  });

  it('does not throw when dueAt/updatedAt accessors throw during sort', () => {
    const base = createNewCard('queue-getter-throw', 'ordering', NOW);
    const throwing = { ...base, id: 'throwing-getter' };
    Object.defineProperty(throwing, 'dueAt', {
      get() {
        throw new Error('bad runtime dueAt getter');
      },
    });
    Object.defineProperty(throwing, 'updatedAt', {
      get() {
        throw new Error('bad runtime updatedAt getter');
      },
    });
    const valid = {
      ...base,
      id: 'valid-getter',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    expect(() => [valid, throwing].sort(compareDueCards)).not.toThrow();
  });

  it('normalizes whitespace around ids before id tie-break sorting', () => {
    const base = createNewCard('queue-id-trim', 'ordering', NOW);
    const spaced = {
      ...base,
      id: '  z-last  ',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };
    const plain = {
      ...base,
      id: 'a-first',
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const orderedIds = [spaced, plain].sort(compareDueCards).map((card) => card.id);

    expect(orderedIds).toEqual(['a-first', '  z-last  ']);
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

  it('keeps loose non-ISO dueAt cards in front for immediate repair', () => {
    const looseDue = {
      ...createNewCard('loose-iso-queue', 'repair', NOW),
      dueAt: '2026-02-23 11:30:00Z',
      updatedAt: '2026-02-23T11:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
      state: 'review' as const,
    };
    const valid = {
      ...createNewCard('valid-iso-queue', 'repair', NOW),
      dueAt: '2026-02-23T11:30:00.000Z',
      updatedAt: '2026-02-23T10:00:00.000Z',
      createdAt: '2026-02-20T00:00:00.000Z',
    };

    const dueCards = collectDueCards([valid, looseDue], NOW, NOW);

    expect(dueCards).toHaveLength(2);
    expect(dueCards[0].id).toBe(looseDue.id);
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

  it('uses runtime time when rendered clock trails slightly so due cards are not delayed', () => {
    const nearFuture = {
      ...createNewCard('runtime-ahead-queue', 'clock', NOW),
      dueAt: '2026-02-23T12:00:20.000Z',
    };

    const dueCards = collectDueCards(
      [nearFuture],
      '2026-02-23T12:00:00.000Z',
      '2026-02-23T12:00:21.000Z',
    );

    expect(dueCards).toHaveLength(1);
    expect(dueCards[0].id).toBe(nearFuture.id);
  });

  it('does not surface cards early when rendered clock is materially ahead of runtime', () => {
    const dueSoon = {
      ...createNewCard('queue-material-future-render', 'clock', NOW),
      dueAt: '2026-02-23T12:03:00.000Z',
    };

    const dueCards = collectDueCards(
      [dueSoon],
      '2026-02-23T12:05:00.000Z',
      '2026-02-23T12:00:00.000Z',
    );

    expect(dueCards).toHaveLength(0);
  });

  it('does not surface cards early when rendered clock is only slightly ahead of runtime', () => {
    const dueSoon = {
      ...createNewCard('queue-slight-future-render', 'clock', NOW),
      dueAt: '2026-02-23T12:00:30.000Z',
    };

    const dueCards = collectDueCards(
      [dueSoon],
      '2026-02-23T12:00:30.000Z',
      '2026-02-23T12:00:00.000Z',
    );

    expect(dueCards).toHaveLength(0);
  });

  it('collects due cards even when malformed ids are present', () => {
    const malformedIdDue = {
      ...createNewCard('malformed-id-due', 'repair', NOW),
      id: undefined as unknown as string,
      dueAt: NOW,
    };
    const validDue = {
      ...createNewCard('valid-id-due', 'repair', NOW),
      dueAt: NOW,
    };

    const dueCards = collectDueCards([validDue, malformedIdDue], NOW, NOW);

    expect(dueCards).toHaveLength(2);
  });

  it('ignores non-card runtime entries instead of throwing during queue collection', () => {
    const due = createNewCard('collect-due-malformed-runtime', 'repair', NOW);
    const dueCards = collectDueCards([undefined, due, 42] as unknown as Card[], NOW, NOW);

    expect(dueCards).toHaveLength(1);
    expect(dueCards[0].id).toBe(due.id);
  });

  it('keeps pathologically future timelines in the due queue for immediate repair', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const futureCorrupted = {
        ...createNewCard('future-corrupted-queue', 'repair', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-24T12:00:01.000Z',
        dueAt: '2026-02-25T12:00:01.000Z',
      };

      const dueCards = collectDueCards([futureCorrupted], NOW, NOW);

      expect(dueCards).toHaveLength(1);
      expect(dueCards[0].id).toBe(futureCorrupted.id);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not force legitimately future review schedules into the due queue', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const stableFutureReview = {
        ...createNewCard('future-review-not-due', 'queue', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-23T12:00:00.000Z',
        dueAt: '2026-02-26T12:00:00.000Z',
        stability: 6,
      };

      const dueCards = collectDueCards([stableFutureReview], NOW, NOW);

      expect(dueCards).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
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

  it('does not treat loose non-ISO updatedAt values as fresher duplicates', () => {
    const local = {
      ...createNewCard('strict-iso-local', 'keep-local', NOW),
      id: 'strict-iso-dup',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
    };
    const loadedLooseIso = {
      ...createNewCard('strict-iso-loaded', 'drop-loose-updated', NOW),
      id: 'strict-iso-dup',
      updatedAt: '2026-02-23 11:00:00Z',
      dueAt: '2026-02-24T11:00:00.000Z',
      reps: 9,
    };

    const merged = mergeDeckCards([local], [loadedLooseIso]);

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('keep-local');
    expect(merged[0].updatedAt).toBe('2026-02-23T10:00:00.000Z');
    expect(merged[0].reps).toBe(2);
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

  it('deduplicates loaded cards when IDs differ only by surrounding whitespace', () => {
    const local = {
      ...createNewCard('trim-merge-local', 'local', NOW),
      id: 'trim-merge-id',
      updatedAt: '2026-02-23T10:00:00.000Z',
      dueAt: '2026-02-24T10:00:00.000Z',
      reps: 2,
    };
    const loaded = {
      ...createNewCard('trim-merge-loaded', 'loaded', NOW),
      id: '  trim-merge-id  ',
      updatedAt: '2026-02-23T11:00:00.000Z',
      dueAt: '2026-02-24T11:00:00.000Z',
      reps: 3,
    };

    const merged = mergeDeckCards([local], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('  trim-merge-id  ');
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].updatedAt).toBe('2026-02-23T11:00:00.000Z');
  });

  it('keeps malformed blank IDs distinct so unrelated cards are not merged together', () => {
    const malformedA = {
      ...createNewCard('blank-id-a', 'alpha', NOW),
      id: '   ',
      word: 'A',
    };
    const malformedB = {
      ...createNewCard('blank-id-b', 'beta', NOW),
      id: '\t',
      word: 'B',
    };

    const merged = mergeDeckCards([malformedA], [malformedB]);

    expect(merged).toHaveLength(2);
    expect(merged[0].word).toBe('A');
    expect(merged[1].word).toBe('B');
  });

  it('ignores malformed non-card entries while merging deck cards', () => {
    const valid = {
      ...createNewCard('merge-valid', 'safe', NOW),
      id: 'merge-valid-id',
    };

    const merged = mergeDeckCards(
      [null as unknown as Card, valid],
      [{ random: true } as unknown as Card, undefined as unknown as Card],
    );

    expect(merged).toEqual([valid]);
  });

  it('still merges valid duplicates when malformed entries are interleaved', () => {
    const local = {
      ...createNewCard('merge-valid-local', 'local', NOW),
      id: 'merge-interleaved-id',
      updatedAt: '2026-02-23T10:00:00.000Z',
      reps: 1,
    };
    const loaded = {
      ...createNewCard('merge-valid-loaded', 'loaded', NOW),
      id: ' merge-interleaved-id ',
      updatedAt: '2026-02-23T11:00:00.000Z',
      reps: 3,
    };

    const merged = mergeDeckCards(
      [local, {} as unknown as Card],
      [null as unknown as Card, loaded],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].meaning).toBe('loaded');
    expect(merged[0].updatedAt).toBe('2026-02-23T11:00:00.000Z');
    expect(merged[0].reps).toBe(3);
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

  it('returns false when the requested card id is malformed', () => {
    const malformed = {
      ...createNewCard('broken-has-due-id', 'recover', NOW),
      id: undefined as unknown as string,
      dueAt: 'bad-due-at',
    };

    expect(hasDueCard([malformed], undefined as unknown as string, NOW)).toBe(false);
  });

  it('matches due cards when card ID input has surrounding whitespace', () => {
    const due = createNewCard('due-whitespace-id', 'safe', NOW);

    expect(hasDueCard([due], ` ${due.id} `, NOW)).toBe(true);
  });

  it('matches due cards when stored card IDs have surrounding whitespace', () => {
    const due = {
      ...createNewCard('due-whitespace-stored-id', 'safe', NOW),
      id: '  due-stored-id  ',
    };

    expect(hasDueCard([due], 'due-stored-id', NOW)).toBe(true);
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

  it('keeps valid provided clocks deterministic for due checks instead of advancing to runtime', () => {
    const nearBoundary = {
      ...createNewCard('deterministic-valid-due-clock', 'safe', NOW),
      dueAt: '2026-02-23T12:00:20.000Z',
    };

    expect(hasDueCard([nearBoundary], nearBoundary.id, '2026-02-23T12:00:00.000Z', '2026-02-23T12:00:30.000Z')).toBe(
      false,
    );
  });

  it('does not treat cards as due early when rendered clock is ahead of runtime', () => {
    const nearBoundary = {
      ...createNewCard('deterministic-no-early-due-clock', 'safe', NOW),
      dueAt: '2026-02-23T12:00:30.000Z',
    };

    expect(hasDueCard([nearBoundary], nearBoundary.id, '2026-02-23T12:01:00.000Z', '2026-02-23T12:00:00.000Z')).toBe(
      false,
    );
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

  it('ignores non-card runtime entries during due checks', () => {
    const due = createNewCard('has-due-malformed-runtime', 'safe', NOW);
    const cards = [undefined, due, { id: due.id }] as unknown as Card[];

    expect(hasDueCard(cards, due.id, NOW)).toBe(true);
    expect(hasDueCard(cards, 'missing-id', NOW)).toBe(false);
  });

  it('treats pathologically future timelines as due so they can be repaired', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const futureCorrupted = {
        ...createNewCard('future-corrupted-has-due', 'repair', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-24T12:00:01.000Z',
        dueAt: '2026-02-25T12:00:01.000Z',
      };

      expect(hasDueCard([futureCorrupted], futureCorrupted.id, NOW)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('countUpcomingDueCards', () => {
  it('counts only future cards within the upcoming window', () => {
    const now = NOW;
    const dueNow = createNewCard('due-now', 'now', now);
    const overdue = { ...createNewCard('overdue', 'past', now), dueAt: '2026-02-23T11:00:00.000Z' };
    const upcoming = { ...createNewCard('upcoming', 'soon', now), dueAt: '2026-02-23T18:00:00.000Z' };
    const tooFar = { ...createNewCard('too-far', 'later', now), dueAt: '2026-02-24T12:00:01.000Z' };

    expect(countUpcomingDueCards([dueNow, overdue, upcoming, tooFar], now)).toBe(1);
  });

  it('includes cards exactly at the upcoming window cutoff', () => {
    const withinCutoff = { ...createNewCard('within-cutoff', 'nearby', NOW), dueAt: '2026-02-24T12:00:00.000Z' };

    expect(countUpcomingDueCards([withinCutoff], NOW)).toBe(1);
  });

  it('returns zero for invalid runtime clocks', () => {
    const card = createNewCard('invalid-clock-upcoming', 'test', NOW);
    expect(countUpcomingDueCards([card], 'bad-clock')).toBe(0);
  });

  it('returns zero for loose non-ISO runtime clocks', () => {
    const upcoming = { ...createNewCard('upcoming-loose-clock', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };
    expect(countUpcomingDueCards([upcoming], '2026-02-23 12:00:00Z')).toBe(0);
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

  it('returns zero when the requested upcoming window is non-finite NaN', () => {
    const upcoming = { ...createNewCard('upcoming-window-2', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, Number.NaN)).toBe(0);
  });

  it('treats infinite upcoming windows as capped windows instead of dropping matches', () => {
    const upcoming = { ...createNewCard('upcoming-window-infinity', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, Number.POSITIVE_INFINITY)).toBe(1);
    expect(countUpcomingDueCards([upcoming], NOW, Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('caps pathologically large upcoming windows instead of dropping all matches', () => {
    const upcoming = { ...createNewCard('upcoming-window-3', 'test', NOW), dueAt: '2026-02-23T18:00:00.000Z' };

    expect(countUpcomingDueCards([upcoming], NOW, Number.MAX_VALUE)).toBe(1);
  });

  it('excludes cards that are flagged for schedule repair from upcoming workload counts', () => {
    const malformedSchedule = {
      ...createNewCard('upcoming-repair-needed', 'test', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: '2026-02-23T18:00:00.000Z',
      stability: 0.2,
    };

    expect(countUpcomingDueCards([malformedSchedule], NOW)).toBe(0);
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

  it('returns zero for loose non-ISO runtime clocks', () => {
    const overdue = { ...createNewCard('overdue-loose-clock', 'test', NOW), dueAt: '2026-02-23T10:00:00.000Z' };
    expect(countOverdueCards([overdue], '2026-02-23 12:00:00Z')).toBe(0);
  });

  it('counts malformed dueAt values so schedule repairs stay visible', () => {
    const malformed = { ...createNewCard('malformed-overdue', 'test', NOW), dueAt: null } as unknown as Card;

    expect(countOverdueCards([malformed], NOW)).toBe(1);
  });

  it('ignores non-card runtime entries in overdue metrics', () => {
    const malformedRuntimeEntry = { dueAt: NOW } as unknown as Card;
    const overdue = { ...createNewCard('overdue-real-card', 'test', NOW), dueAt: '2026-02-23T10:00:00.000Z' };

    expect(countOverdueCards([malformedRuntimeEntry, overdue], NOW)).toBe(1);
  });
});

describe('hasScheduleRepairNeed', () => {
  it('flags cards with malformed dueAt or updatedAt values', () => {
    const malformedDue = { ...createNewCard('repair-bad-due', 'test', NOW), dueAt: 'bad-due' };
    const malformedUpdated = { ...createNewCard('repair-bad-updated', 'test', NOW), updatedAt: 'bad-updated' };

    expect(hasScheduleRepairNeed(malformedDue)).toBe(true);
    expect(hasScheduleRepairNeed(malformedUpdated)).toBe(true);
  });

  it('flags cards with loose non-ISO dueAt timestamps for scheduler repair', () => {
    const looseDue = {
      ...createNewCard('repair-loose-due', 'test', NOW),
      dueAt: '2026-02-23 12:05:00Z',
      updatedAt: NOW,
      state: 'review' as const,
      stability: 2,
    };

    expect(hasScheduleRepairNeed(looseDue)).toBe(true);
  });

  it('flags cards with pathologically future timeline anchors', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const futureCorrupted = {
        ...createNewCard('repair-future-corrupted', 'test', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-24T12:00:01.000Z',
        dueAt: '2026-02-25T12:00:01.000Z',
      };

      expect(hasScheduleRepairNeed(futureCorrupted)).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not flag healthy review cards only because dueAt is days ahead', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
    try {
      const healthyFutureReview = {
        ...createNewCard('repair-future-healthy', 'test', NOW),
        state: 'review' as const,
        updatedAt: '2026-02-23T12:00:00.000Z',
        dueAt: '2026-02-26T12:00:00.000Z',
        stability: 6,
      };

      expect(hasScheduleRepairNeed(healthyFutureReview)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
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

  it('flags previously reviewed learning cards due exactly at updatedAt', () => {
    const staleLearningDueNow = {
      ...createNewCard('repair-learning-due-now-stale', 'test', NOW),
      state: 'learning' as const,
      reps: 3,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(staleLearningDueNow)).toBe(true);
  });

  it('flags learning cards due exactly at updatedAt when lapses indicate review history', () => {
    const lapsedLearningDueNow = {
      ...createNewCard('repair-learning-due-now-lapsed', 'test', NOW),
      state: 'learning' as const,
      reps: 0,
      lapses: 2,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(lapsedLearningDueNow)).toBe(true);
  });

  it('flags learning cards due exactly at updatedAt when reps are malformed', () => {
    const malformedCounterDueNow = {
      ...createNewCard('repair-learning-due-now-bad-counter', 'test', NOW),
      state: 'learning' as const,
      reps: Number.NaN,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(malformedCounterDueNow)).toBe(true);
  });

  it('flags learning cards due exactly at updatedAt when reps are non-integer', () => {
    const fractionalCounterDueNow = {
      ...createNewCard('repair-learning-due-now-fractional-counter', 'test', NOW),
      state: 'learning' as const,
      reps: 0.5,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(fractionalCounterDueNow)).toBe(true);
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

  it('does not flag valid review schedules only because counters have fractional runtime drift', () => {
    const reviewWithFractionalCounters = {
      ...createNewCard('repair-review-fractional-counter-drift', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T12:00:00.000Z',
      stability: 3,
      reps: 2.8,
      lapses: 1.2,
    };

    expect(hasScheduleRepairNeed(reviewWithFractionalCounters)).toBe(false);
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

  it('flags relearning cards with day-like schedules for phase normalization repair', () => {
    const relearningDayLike = {
      ...createNewCard('repair-relearning-daylike-drift', 'test', NOW),
      state: 'relearning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(relearningDayLike)).toBe(true);
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

  it('flags learning cards with review history when intervals drift into day-like windows', () => {
    const driftedLearning = {
      ...createNewCard('repair-learning-drifted-daylike', 'test', NOW),
      state: 'learning' as const,
      reps: 3,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(driftedLearning)).toBe(true);
  });

  it('flags learning cards with lapse history when intervals drift into day-like windows', () => {
    const driftedLearningWithLapses = {
      ...createNewCard('repair-learning-drifted-daylike-lapses', 'test', NOW),
      state: 'learning' as const,
      reps: 0,
      lapses: 2,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(driftedLearningWithLapses)).toBe(true);
  });

  it('flags learning cards with malformed reps when intervals drift into day-like windows', () => {
    const driftedLearningWithMalformedReps = {
      ...createNewCard('repair-learning-drifted-daylike-bad-reps', 'test', NOW),
      state: 'learning' as const,
      reps: Number.NaN,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(driftedLearningWithMalformedReps)).toBe(true);
  });

  it('flags learning cards with malformed lapses when intervals drift into day-like windows', () => {
    const driftedLearningWithMalformedLapses = {
      ...createNewCard('repair-learning-drifted-daylike-bad-lapses', 'test', NOW),
      state: 'learning' as const,
      reps: 0,
      lapses: Number.NaN,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(driftedLearningWithMalformedLapses)).toBe(true);
  });

  it('keeps zero-history learning cards with sub-day schedules outside repair flow', () => {
    const freshLearning = {
      ...createNewCard('repair-learning-fresh-subday', 'test', NOW),
      state: 'learning' as const,
      reps: 0,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T00:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(freshLearning)).toBe(false);
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

  it('accepts punctuation-corrupted review state aliases when schedule is otherwise healthy', () => {
    const punctuationReview = {
      ...createNewCard('repair-punctuation-review', 'test', NOW),
      state: ' review. ' as unknown as Card['state'],
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T12:00:00.000Z',
      stability: 4,
    };

    expect(hasScheduleRepairNeed(punctuationReview)).toBe(false);
  });

  it('does not flag healthy schedules', () => {
    const healthy = {
      ...createNewCard('repair-healthy', 'test', NOW),
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:10:00.000Z',
    };

    expect(hasScheduleRepairNeed(healthy)).toBe(false);
  });

  it('flags learning schedules that exceed the one-day ceiling', () => {
    const overlongLearning = {
      ...createNewCard('repair-learning-overlong', 'test', NOW),
      state: 'learning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-25T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(overlongLearning)).toBe(true);
  });

  it('flags review schedules that exceed the stability outlier window', () => {
    const overlongReview = {
      ...createNewCard('repair-review-overlong', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-09-01T12:00:00.000Z',
      stability: 1,
    };

    expect(hasScheduleRepairNeed(overlongReview)).toBe(true);
  });

  it('keeps plausible long review schedules that stay within the stability outlier window', () => {
    const plausibleReview = {
      ...createNewCard('repair-review-plausible-long', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-06-03T12:00:00.000Z',
      stability: 12,
    };

    expect(hasScheduleRepairNeed(plausibleReview)).toBe(false);
  });

  it('flags long review schedules when stability is malformed', () => {
    const malformedStabilityReview = {
      ...createNewCard('repair-review-malformed-stability-long', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-03-05T12:00:00.000Z',
      stability: Number.NaN,
    };

    expect(hasScheduleRepairNeed(malformedStabilityReview)).toBe(true);
  });

  it('keeps short review schedules with malformed stability within conservative fallback window', () => {
    const shortMalformedStabilityReview = {
      ...createNewCard('repair-review-malformed-stability-short', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-03-01T12:00:00.000Z',
      stability: Number.NaN,
    };

    expect(hasScheduleRepairNeed(shortMalformedStabilityReview)).toBe(false);
  });

  it('accepts numeric-string stability values when evaluating review schedule windows', () => {
    const stringStabilityReview = {
      ...createNewCard('repair-review-string-stability', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-06-03T12:00:00.000Z',
      stability: '12' as unknown as number,
    };

    expect(hasScheduleRepairNeed(stringStabilityReview)).toBe(false);
  });

  it('accepts numeric-string reps for learning cards due exactly at updatedAt', () => {
    const stringRepsLearningDueNow = {
      ...createNewCard('repair-learning-string-reps-now', 'test', NOW),
      state: 'learning' as const,
      reps: '0' as unknown as number,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
    };

    expect(hasScheduleRepairNeed(stringRepsLearningDueNow)).toBe(false);
  });

  it('accepts scientific-notation numeric strings for runtime schedule fields', () => {
    const scientificReview = {
      ...createNewCard('repair-review-scientific-fields', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-06-03T12:00:00.000Z',
      stability: '1.2e1' as unknown as number,
      reps: '1e1' as unknown as number,
    };

    expect(hasScheduleRepairNeed(scientificReview)).toBe(false);
  });

  it('treats Infinity-like reps strings as valid non-negative counters', () => {
    const infiniteRepsReview = {
      ...createNewCard('repair-review-infinity-reps', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-24T12:00:00.000Z',
      reps: 'Infinity' as unknown as number,
      stability: 2,
    };

    expect(hasScheduleRepairNeed(infiniteRepsReview)).toBe(false);
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

  it('counts overlong schedules that should be repaired', () => {
    const overlongLearning = {
      ...createNewCard('repair-count-learning-overlong', 'test', NOW),
      state: 'learning' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-25T12:00:00.000Z',
    };
    const overlongReview = {
      ...createNewCard('repair-count-review-overlong', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-09-01T12:00:00.000Z',
      stability: 1,
    };
    const healthyReview = {
      ...createNewCard('repair-count-review-healthy', 'test', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-03-05T12:00:00.000Z',
      stability: 6,
    };

    expect(countScheduleRepairCards([overlongLearning, overlongReview, healthyReview])).toBe(2);
  });

  it('counts non-card runtime entries as repair-needed to keep corruption visible', () => {
    const healthy = createNewCard('repair-count-malformed-runtime', 'test', NOW);
    const cards = [healthy, null, { id: 'partial' }] as unknown as Card[];

    expect(countScheduleRepairCards(cards)).toBe(2);
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

  it('rejects loose non-ISO timestamp strings', () => {
    expect(selectLatestReviewedAt('2026-02-23 12:00:00Z', '2026-02-23T11:59:59.000Z')).toBe(
      '2026-02-23T11:59:59.000Z',
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

  it('falls back to runtime clock when rendered clock is materially ahead', () => {
    expect(resolveReviewClock('2026-02-23T12:05:00.000Z', '2026-02-23T12:00:00.000Z')).toBe(
      '2026-02-23T12:00:00.000Z',
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

describe('resolveAddCardClock', () => {
  it('uses runtime now when rendered clock is slightly future-skewed so new cards are immediately due', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const resolved = resolveAddCardClock('2026-02-23T12:00:30.000Z', '2026-02-23T12:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });

  it('falls back to runtime now when rendered clock is materially future-skewed', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    const resolved = resolveAddCardClock('2026-02-23T12:20:00.000Z', '2026-02-23T12:00:00.000Z');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:00:00.000Z');
  });

  it('falls back to wall clock when both add-card clock candidates are invalid', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:34:56.000Z'));
    const resolved = resolveAddCardClock('bad-current-time', 'bad-runtime-time');
    nowSpy.mockRestore();

    expect(resolved).toBe('2026-02-23T12:34:56.000Z');
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

describe('alignDueNowStatWithQueue', () => {
  it('keeps dueNow aligned with the actual due queue length', () => {
    const stats = {
      total: 4,
      dueNow: 1,
      learning: 1,
      review: 2,
      relearning: 1,
    };
    const dueCards = [
      createNewCard('due-a', 'a', NOW),
      createNewCard('due-b', 'b', NOW),
      createNewCard('due-c', 'c', NOW),
    ];

    const aligned = alignDueNowStatWithQueue(stats, dueCards);

    expect(aligned).toEqual({
      ...stats,
      dueNow: 3,
    });
  });

  it('reuses the original stats object when dueNow is already aligned', () => {
    const stats = {
      total: 2,
      dueNow: 2,
      learning: 1,
      review: 1,
      relearning: 0,
    };
    const dueCards = [
      createNewCard('due-x', 'x', NOW),
      createNewCard('due-y', 'y', NOW),
    ];

    const aligned = alignDueNowStatWithQueue(stats, dueCards);

    expect(aligned).toBe(stats);
  });
});
