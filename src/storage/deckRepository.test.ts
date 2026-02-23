import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeDeckStats, loadDeck } from './deckRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock<Promise<string | null>, [string]>;
};

describe('deck repository', () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
  });

  it('normalizes persisted cards and clamps scheduling values', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: '1',
            word: '  alpha ',
            meaning: ' first ',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: 1,
            lapses: 0,
            stability: 999999,
            difficulty: -10,
          },
          {
            id: '2',
            word: '   ',
            meaning: 'invalid',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].word).toBe('alpha');
    expect(deck.cards[0].meaning).toBe('first');
    expect(deck.cards[0].stability).toBe(36500);
    expect(deck.cards[0].difficulty).toBe(1);
  });

  it('computes due and state counts', () => {
    const stats = computeDeckStats(
      [
        {
          id: '1',
          word: 'alpha',
          meaning: 'first',
          dueAt: '2026-02-22T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'learning',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
        {
          id: '2',
          word: 'beta',
          meaning: 'second',
          dueAt: '2026-02-25T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'relearning',
          reps: 3,
          lapses: 1,
          stability: 1.1,
          difficulty: 6,
        },
      ],
      '2026-02-23T00:00:00.000Z',
    );

    expect(stats).toEqual({
      total: 2,
      dueNow: 1,
      learning: 1,
      review: 0,
      relearning: 1,
    });
  });

  it('recovers cards when one of the persisted timestamps is invalid', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'ok',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
          {
            id: 'missing-due',
            word: 'beta',
            meaning: 'second',
            dueAt: 'not-a-date',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0].id).toBe('ok');
    expect(deck.cards[1].id).toBe('missing-due');
    expect(deck.cards[1].dueAt).toBe('2026-02-22T00:00:00.000Z');
  });

  it('drops cards when all timestamps are invalid', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'broken-time',
            word: 'beta',
            meaning: 'second',
            dueAt: 'not-a-date',
            createdAt: 'also-bad',
            updatedAt: 'still-bad',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(0);
  });

  it('ignores non-array cards payloads safely', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: { id: 'broken-shape' },
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toEqual([]);
  });

  it('trims valid string IDs and drops cards with blank IDs', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: '  trimmed-id  ',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
          {
            id: '   ',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('trimmed-id');
  });

  it('falls back to defaults for non-finite scheduling numbers', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'weird',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: Number.NaN,
            lapses: Number.POSITIVE_INFINITY,
            stability: Number.NaN,
            difficulty: Number.POSITIVE_INFINITY,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(0);
    expect(deck.cards[0].lapses).toBe(0);
    expect(deck.cards[0].stability).toBe(0.5);
    expect(deck.cards[0].difficulty).toBe(5);
  });

  it('sanitizes invalid lastReviewedAt and sorts by createdAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: '2',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-25T00:00:00.000Z',
            createdAt: '2026-02-21T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
          {
            id: '1',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
        ],
        lastReviewedAt: 'not-a-date',
      }),
    );

    const deck = await loadDeck();
    expect(deck.lastReviewedAt).toBeUndefined();
    expect(deck.cards.map((card) => card.id)).toEqual(['1', '2']);
  });

  it('normalizes timestamp ordering to keep updated/due at or after createdAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'time-order',
            word: 'zeta',
            meaning: 'letter',
            dueAt: '2026-02-18T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-19T00:00:00.000Z',
            state: 'learning',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards[0].updatedAt).toBe('2026-02-20T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-20T00:00:00.000Z');
  });

  it('normalizes dueAt to never precede updatedAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'due-after-update',
            word: 'eta',
            meaning: 'letter',
            dueAt: '2026-02-21T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-24T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('keeps freshest card data when duplicate IDs are persisted', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'dup',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
            reps: 1,
            lapses: 0,
          },
          {
            id: 'dup',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-21T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 3,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('dup');
    expect(deck.cards[0].word).toBe('beta');
    expect(deck.cards[0].updatedAt).toBe('2026-02-23T00:00:00.000Z');
    expect(deck.cards[0].reps).toBe(3);
  });

  it('keeps valid cards when malformed field types are present in the same payload', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'valid',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
          {
            id: 'bad-word-type',
            word: { nested: true },
            meaning: 'broken',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('valid');
  });

  it('drops non-string notes safely instead of failing deck load', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'valid-notes',
            word: 'beta',
            meaning: 'second',
            notes: 1234,
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('valid-notes');
    expect(deck.cards[0].notes).toBeUndefined();
  });
});
