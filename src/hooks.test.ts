import {
  applyDueReview,
  compareDueCards,
  countUpcomingDueCards,
  hasDueCard,
  mergeDeckCards,
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
});

describe('resolveReviewClock', () => {
  it('uses runtime clock when it is current or ahead of the rendered clock', () => {
    expect(resolveReviewClock('2026-02-23T12:00:00.000Z', '2026-02-23T12:00:10.000Z')).toBe(
      '2026-02-23T12:00:10.000Z',
    );
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
});
