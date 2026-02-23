import { applyDueReview, compareDueCards, hasDueCard, mergeDeckCards, selectLatestReviewedAt } from './hooks';
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
});
