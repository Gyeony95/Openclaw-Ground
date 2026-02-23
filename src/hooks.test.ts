import {
  applyReviewToDeckState,
  applyDueReview,
  compareDueCards,
  countOverdueCards,
  countUpcomingDueCards,
  hasDueCard,
  mergeDeckCards,
  resolveNextUiClock,
  resolveReviewClock,
  selectLatestReviewedAt,
} from './hooks';
import { createNewCard } from './scheduler/fsrs';

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

  it('returns a new card object only for the reviewed target', () => {
    const due = createNewCard('delta', 'fourth', NOW);
    const secondDue = createNewCard('epsilon', 'fifth', NOW);

    const result = applyDueReview([due, secondDue], due.id, 4, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(due);
    expect(result.cards[1]).toBe(secondDue);
  });

  it('reviews only the first due card when duplicate IDs exist', () => {
    const first = createNewCard('zeta', 'sixth', NOW);
    const second = { ...createNewCard('eta', 'seventh', NOW), id: first.id };

    const result = applyDueReview([first, second], first.id, 3, NOW);

    expect(result.reviewed).toBe(true);
    expect(result.cards[0]).not.toBe(first);
    expect(result.cards[0].reps).toBe(first.reps + 1);
    expect(result.cards[1]).toBe(second);
    expect(result.cards[1].reps).toBe(second.reps);
  });

  it('does nothing when the target card ID does not exist', () => {
    const due = createNewCard('theta', 'eighth', NOW);
    const cards = [due];

    const result = applyDueReview(cards, 'missing-id', 3, NOW);

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
  });

  it('does nothing when review clock is invalid', () => {
    const due = createNewCard('iota', 'ninth', NOW);
    const cards = [due];

    const result = applyDueReview(cards, due.id, 3, 'bad-clock');

    expect(result.reviewed).toBe(false);
    expect(result.cards).toBe(cards);
    expect(result.cards[0]).toBe(due);
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
});

describe('hasDueCard', () => {
  it('returns true only when a matching card is due at the provided clock', () => {
    const due = createNewCard('due', 'ready', NOW);
    const future = { ...createNewCard('future', 'later', NOW), dueAt: '2026-02-24T12:00:00.000Z' };

    expect(hasDueCard([due, future], due.id, NOW)).toBe(true);
    expect(hasDueCard([due, future], future.id, NOW)).toBe(false);
  });

  it('returns false for invalid runtime clocks', () => {
    const due = createNewCard('invalid-clock', 'test', NOW);
    expect(hasDueCard([due], due.id, 'bad-clock')).toBe(false);
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
});
