import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeDeckStats, loadDeck, saveDeck } from './deckRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

const mockedStorage = AsyncStorage as unknown as {
  getItem: jest.Mock<Promise<string | null>, [string]>;
  setItem: jest.Mock<Promise<void>, [string, string]>;
};

describe('deck repository', () => {
  beforeEach(() => {
    mockedStorage.getItem.mockReset();
    mockedStorage.setItem.mockReset();
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

  it('trims oversized persisted text fields to app limits', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'oversized',
            word: ` ${'w'.repeat(120)} `,
            meaning: ` ${'m'.repeat(220)} `,
            notes: ` ${'n'.repeat(320)} `,
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].word).toHaveLength(80);
    expect(deck.cards[0].meaning).toHaveLength(180);
    expect(deck.cards[0].notes).toHaveLength(240);
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

  it('caps extremely large counters to Number.MAX_SAFE_INTEGER', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'huge-counter',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: Number.MAX_VALUE,
            lapses: Number.MAX_SAFE_INTEGER + 1000,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(deck.cards[0].lapses).toBe(Number.MAX_SAFE_INTEGER);
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

  it('normalizes valid lastReviewedAt into canonical ISO format while loading', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [],
        lastReviewedAt: '2026-02-23T12:00:00Z',
      }),
    );

    const deck = await loadDeck();
    expect(deck.lastReviewedAt).toBe('2026-02-23T12:00:00.000Z');
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

  it('normalizes createdAt into canonical ISO format while loading', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'canonical-created-at',
            word: 'eta-canonical',
            meaning: 'letter',
            dueAt: '2026-02-21T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00Z',
            updatedAt: '2026-02-21T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].createdAt).toBe('2026-02-20T00:00:00.000Z');
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

  it('repairs learning cards with dueAt at or before updatedAt to a short fallback interval', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'learning-due-repair',
            word: 'eta-learning',
            meaning: 'letter',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-24T00:00:00.000Z',
            state: 'learning',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:01:00.000Z');
  });

  it('repairs relearning cards with dueAt before updatedAt to a short fallback interval', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'relearning-due-repair',
            word: 'eta-relearning',
            meaning: 'letter',
            dueAt: '2026-02-23T23:59:59.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-24T00:00:00.000Z',
            state: 'relearning',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:10:00.000Z');
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

  it('prefers higher reps over later dueAt when duplicate updatedAt values tie', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'dup-reps-priority',
            word: 'alpha',
            meaning: 'lower-reps',
            dueAt: '2026-02-27T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 2,
            lapses: 0,
          },
          {
            id: 'dup-reps-priority',
            word: 'beta',
            meaning: 'higher-reps',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-21T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 5,
            lapses: 0,
          },
        ],
      }),
    );

    const deck = await loadDeck();

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('dup-reps-priority');
    expect(deck.cards[0].meaning).toBe('higher-reps');
    expect(deck.cards[0].reps).toBe(5);
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('prefers earlier dueAt when duplicate cards are otherwise tied', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'dup-due-priority',
            word: 'alpha',
            meaning: 'later-due',
            dueAt: '2026-02-27T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 5,
            lapses: 1,
          },
          {
            id: 'dup-due-priority',
            word: 'beta',
            meaning: 'earlier-due',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-21T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 5,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('dup-due-priority');
    expect(deck.cards[0].meaning).toBe('earlier-due');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
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

  it('drops cards that only provide a pathologically-future dueAt anchor', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-23T12:00:00.000Z'));
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'future-due-only',
            word: 'beta',
            meaning: 'second',
            dueAt: '2099-01-01T00:00:00.000Z',
            createdAt: 'bad-created-at',
            updatedAt: 'bad-updated-at',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    nowSpy.mockRestore();

    expect(deck.cards).toHaveLength(0);
  });

  it('repairs pathologically-future learning dueAt values to a short learning interval', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'learning-future-due',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'learning',
          },
        ],
      }),
    );

    const deck = await loadDeck();

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-22T00:01:00.000Z');
  });

  it('repairs pathologically-future relearning dueAt values to a short relearning interval', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'relearning-future-due',
            word: 'beta',
            meaning: 'second',
            dueAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'relearning',
          },
        ],
      }),
    );

    const deck = await loadDeck();

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-22T00:10:00.000Z');
  });

  it('caps pathologically-future review dueAt values to the max supported review schedule', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'review-future-due',
            word: 'gamma',
            meaning: 'third',
            dueAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    const scheduleDays =
      (Date.parse(deck.cards[0].dueAt) - Date.parse(deck.cards[0].updatedAt)) / (24 * 60 * 60 * 1000);

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(scheduleDays).toBe(36500);
  });

  it('sanitizes and deduplicates cards before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: '  dup  ',
          word: ' beta ',
          meaning: ' second ',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'learning',
          reps: 1,
          lapses: 0,
          stability: 1,
          difficulty: 5,
        },
        {
          id: 'dup',
          word: 'beta',
          meaning: 'freshest',
          dueAt: '2026-02-24T00:00:00.000Z',
          createdAt: '2026-02-21T00:00:00.000Z',
          updatedAt: '2026-02-23T00:00:00.000Z',
          state: 'review',
          reps: 2,
          lapses: 1,
          stability: Number.POSITIVE_INFINITY,
          difficulty: Number.NaN,
        },
        {
          id: 'invalid',
          word: ' ',
          meaning: 'dropped',
          dueAt: '2026-02-24T00:00:00.000Z',
          createdAt: '2026-02-21T00:00:00.000Z',
          updatedAt: '2026-02-23T00:00:00.000Z',
          state: 'review',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
      ],
      lastReviewedAt: 'bad-time',
    });

    expect(mockedStorage.setItem).toHaveBeenCalledTimes(1);
    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as {
      cards: Array<{ id: string; meaning: string; stability: number; difficulty: number }>;
      lastReviewedAt?: string;
    };
    expect(savedDeck.cards).toHaveLength(1);
    expect(savedDeck.cards[0].id).toBe('dup');
    expect(savedDeck.cards[0].meaning).toBe('freshest');
    expect(savedDeck.cards[0].stability).toBe(0.5);
    expect(savedDeck.cards[0].difficulty).toBe(5);
    expect(savedDeck.lastReviewedAt).toBeUndefined();
  });

  it('keeps only valid lastReviewedAt when persisting', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [],
      lastReviewedAt: '2026-02-23T12:00:00.000Z',
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as { lastReviewedAt?: string };
    expect(savedDeck.lastReviewedAt).toBe('2026-02-23T12:00:00.000Z');
  });

  it('normalizes lastReviewedAt into canonical ISO format when persisting', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [],
      lastReviewedAt: '2026-02-23T12:00:00Z',
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as { lastReviewedAt?: string };
    expect(savedDeck.lastReviewedAt).toBe('2026-02-23T12:00:00.000Z');
  });

  it('trims oversized text fields before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'oversized-save',
          word: 'w'.repeat(140),
          meaning: 'm'.repeat(260),
          notes: 'n'.repeat(360),
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
      ],
      lastReviewedAt: undefined,
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as {
      cards: Array<{ word: string; meaning: string; notes?: string }>;
    };
    expect(savedDeck.cards[0].word).toHaveLength(80);
    expect(savedDeck.cards[0].meaning).toHaveLength(180);
    expect(savedDeck.cards[0].notes).toHaveLength(240);
  });

  it('caps pathologically-future review dueAt values before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'review-future-save',
          word: 'delta',
          meaning: 'fourth',
          dueAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 3,
          lapses: 1,
          stability: 120,
          difficulty: 5,
        },
      ],
      lastReviewedAt: '2026-02-23T00:00:00.000Z',
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as {
      cards: Array<{ dueAt: string; updatedAt: string }>;
    };
    const savedCard = savedDeck.cards[0];
    const scheduleDays = (Date.parse(savedCard.dueAt) - Date.parse(savedCard.updatedAt)) / (24 * 60 * 60 * 1000);

    expect(scheduleDays).toBe(36500);
  });
});
