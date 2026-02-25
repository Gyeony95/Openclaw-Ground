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

  it('coerces numeric-string scheduler fields when loading persisted cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'string-numbers',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: '5',
            lapses: '2',
            stability: '3.5',
            difficulty: '7.2',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(5);
    expect(deck.cards[0].lapses).toBe(2);
    expect(deck.cards[0].stability).toBe(3.5);
    expect(deck.cards[0].difficulty).toBe(7.2);
  });

  it('coerces scientific-notation scheduler fields when loading persisted cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'scientific-numbers',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: '5e0',
            lapses: '2e0',
            stability: '3.5e0',
            difficulty: '7.2e0',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(5);
    expect(deck.cards[0].lapses).toBe(2);
    expect(deck.cards[0].stability).toBe(3.5);
    expect(deck.cards[0].difficulty).toBe(7.2);
  });

  it('treats Infinity-like scheduler strings as saturated numeric values when loading cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'infinite-numbers',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: 'Infinity',
            lapses: '0',
            stability: 'Infinity',
            difficulty: 'Infinity',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(deck.cards[0].lapses).toBe(0);
    expect(deck.cards[0].stability).toBe(36500);
    expect(deck.cards[0].difficulty).toBe(10);
  });

  it('treats inf aliases as saturated numeric values when loading cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'infinite-alias-numbers',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: '+inf',
            lapses: '-inf',
            stability: 'inf',
            difficulty: '+inf',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(deck.cards[0].lapses).toBe(0);
    expect(deck.cards[0].stability).toBe(36500);
    expect(deck.cards[0].difficulty).toBe(10);
  });

  it('treats overflow scientific-notation scheduler strings as saturated numeric values when loading cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'overflow-scientific-numbers',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            reps: '1e309',
            lapses: '-1e309',
            stability: '1e309',
            difficulty: '-1e309',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(deck.cards[0].lapses).toBe(0);
    expect(deck.cards[0].stability).toBe(36500);
    expect(deck.cards[0].difficulty).toBe(1);
  });

  it('repairs persisted far-future review due dates using card stability', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'review-future',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2028-04-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 1.5,
            difficulty: 5,
            reps: 12,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].dueAt).toBe('2026-02-23T12:00:00.000Z');
    expect(deck.cards[0].stability).toBe(1.5);
    expect(deck.cards[0].state).toBe('review');
  });

  it('caps repaired far-future review due dates to a safe fallback window for extreme stability values', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'review-future-capped',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2036-04-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 200,
            difficulty: 5,
            reps: 30,
            lapses: 2,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-03-01T00:00:00.000Z');
    expect(deck.cards[0].stability).toBe(200);
    expect(deck.cards[0].state).toBe('review');
  });

  it('keeps repaired review schedules at or above the half-day floor for low-stability cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'review-floor-low-stability',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2028-04-01T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 0.1,
            difficulty: 5,
            reps: 12,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-22T12:00:00.000Z');
    expect(deck.cards[0].state).toBe('review');
  });

  it('keeps plausible long review schedules that remain within the stability outlier window', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'review-plausible-long-window',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-06-12T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 12,
            difficulty: 5,
            reps: 18,
            lapses: 2,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].dueAt).toBe('2026-06-12T00:00:00.000Z');
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].stability).toBe(12);
    expect(deck.cards[0].state).toBe('review');
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

  it('collapses internal whitespace in persisted word and meaning fields', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'collapsed-spacing',
            word: '  new    york ',
            meaning: ' very   large   city ',
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
    expect(deck.cards[0].word).toBe('new york');
    expect(deck.cards[0].meaning).toBe('very large city');
  });

  it('collapses internal whitespace in persisted notes fields', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'collapsed-notes',
            word: 'alpha',
            meaning: 'first letter',
            notes: '  line   one \n\t line   two  ',
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
    expect(deck.cards[0].notes).toBe('line one line two');
  });

  it('normalizes relearn aliases in persisted state', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'state-alias-relearn',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' ReLearn ',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].state).toBe('relearning');
  });

  it('normalizes folded persisted state aliases with separators', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'state-alias-re-learning',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' re_learning ',
          },
          {
            id: 'state-alias-learn',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' learn ',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0].state).toBe('relearning');
    expect(deck.cards[1].state).toBe('learning');
  });

  it('normalizes persisted state aliases that include punctuation', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'state-alias-punctuation-review',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' review. ',
          },
          {
            id: 'state-alias-punctuation-relearn',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' relearn!! ',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0].state).toBe('review');
    expect(deck.cards[1].state).toBe('relearning');
  });

  it('normalizes short review aliases in persisted state', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'state-alias-short-review',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' rev ',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].state).toBe('review');
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

  it('counts malformed dueAt values as due-now so corrupted cards remain actionable', () => {
    const stats = computeDeckStats(
      [
        {
          id: 'broken-due',
          word: 'alpha',
          meaning: 'first',
          dueAt: 'not-a-date',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 3,
          lapses: 1,
          stability: 1.2,
          difficulty: 6,
        },
      ],
      '2026-02-23T00:00:00.000Z',
    );

    expect(stats).toEqual({
      total: 1,
      dueNow: 1,
      learning: 0,
      review: 1,
      relearning: 0,
    });
  });

  it('ignores malformed runtime deck entries while still counting valid cards', () => {
    const stats = computeDeckStats(
      [
        null,
        { id: 'missing-fields' },
        {
          id: 'valid',
          word: 'alpha',
          meaning: 'first',
          dueAt: '2026-02-22T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 2,
          lapses: 0,
          stability: 2,
          difficulty: 5,
        },
      ] as unknown as any[],
      '2026-02-23T00:00:00.000Z',
    );

    expect(stats).toEqual({
      total: 1,
      dueNow: 1,
      learning: 0,
      review: 1,
      relearning: 0,
    });
  });

  it('skips runtime entries when due/state accessors throw', () => {
    const throwingCard = {
      id: 'throwing-card',
      word: 'alpha',
      meaning: 'first',
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-22T00:00:00.000Z',
      reps: 2,
      lapses: 0,
      stability: 2,
      difficulty: 5,
    } as Partial<{
      dueAt: string;
      state: string;
    }>;
    Object.defineProperty(throwingCard, 'dueAt', {
      get() {
        throw new Error('bad runtime dueAt');
      },
    });
    Object.defineProperty(throwingCard, 'state', {
      get() {
        throw new Error('bad runtime state');
      },
    });

    const stats = computeDeckStats([throwingCard as any], '2026-02-23T00:00:00.000Z');

    expect(stats).toEqual({
      total: 0,
      dueNow: 0,
      learning: 0,
      review: 0,
      relearning: 0,
    });
  });

  it('treats loose non-ISO dueAt values as due-now so malformed schedules remain visible', () => {
    const stats = computeDeckStats(
      [
        {
          id: 'loose-due',
          word: 'alpha',
          meaning: 'first',
          dueAt: '2026-02-22 00:00:00Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 3,
          lapses: 1,
          stability: 1.2,
          difficulty: 6,
        },
      ],
      '2026-02-23T00:00:00.000Z',
    );

    expect(stats).toEqual({
      total: 1,
      dueNow: 1,
      learning: 0,
      review: 1,
      relearning: 0,
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
    expect(deck.cards[1].dueAt).toBe('2026-02-22T12:00:00.000Z');
  });

  it('uses stability fallback for review cards with invalid dueAt when stability is still young', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'missing-due-young-review',
            word: 'beta',
            meaning: 'second',
            dueAt: 'not-a-date',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 2,
            difficulty: 5,
            reps: 12,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('uses stability fallback for review cards whose dueAt collapses to updatedAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'collapsed-due-review',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-22T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 2,
            difficulty: 5,
            reps: 12,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('repairs minute-scale review schedules to a stable review floor while loading', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'subfloor-due-review',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-22T00:10:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 2,
            difficulty: 5,
            reps: 12,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('uses capped stability fallback when a mature review card is missing dueAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'missing-due-mature-review',
            word: 'gamma',
            meaning: 'third',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 120,
            difficulty: 5,
            reps: 30,
            lapses: 3,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('uses capped stability fallback when a mature review card has malformed dueAt', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'malformed-due-mature-review',
            word: 'delta',
            meaning: 'fourth',
            dueAt: 'not-a-time',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'review',
            stability: 120,
            difficulty: 5,
            reps: 30,
            lapses: 3,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-03-01T00:00:00.000Z');
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

  it('preserves valid historical timestamps while loading persisted cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'historical-card',
            word: 'archive',
            meaning: 'old entry',
            dueAt: '2020-01-05T00:00:00.000Z',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-02T00:00:00.000Z',
            state: 'review',
            stability: 3,
            difficulty: 5,
            reps: 20,
            lapses: 2,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(deck.cards[0].updatedAt).toBe('2020-01-02T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2020-01-05T00:00:00.000Z');
  });

  it('uses historical dueAt as a valid anchor when createdAt and updatedAt are missing', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'historical-due-anchor',
            word: 'anchor',
            meaning: 'fallback source',
            dueAt: '2020-01-05T00:00:00.000Z',
            state: 'learning',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].createdAt).toBe('2020-01-05T00:00:00.000Z');
    expect(deck.cards[0].updatedAt).toBe('2020-01-05T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2020-01-05T00:01:00.000Z');
  });

  it('uses near-future dueAt as a valid anchor when createdAt and updatedAt are missing', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'future-due-anchor',
              word: 'anchor',
              meaning: 'future fallback source',
              dueAt: '2026-02-24T00:00:00.000Z',
              state: 'learning',
            },
          ],
        }),
      );

      const deck = await loadDeck();

      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].createdAt).toBe('2026-02-24T00:00:00.000Z');
      expect(deck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
      expect(deck.cards[0].dueAt).toBe('2026-02-24T00:01:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('clamps persisted future-skewed updatedAt to wall clock to keep cards reviewable', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'future-updated-at',
              word: 'alpha',
              meaning: 'first',
              dueAt: '2030-01-02T00:00:00.000Z',
              createdAt: '2026-02-20T00:00:00.000Z',
              updatedAt: '2030-01-01T00:00:00.000Z',
              state: 'review',
              stability: 2,
              difficulty: 5,
            },
          ],
        }),
      );

      const deck = await loadDeck();

      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(Date.parse(deck.cards[0].dueAt)).toBeGreaterThan(Date.parse(deck.cards[0].updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('clamps persisted past-skewed updatedAt to wall clock to keep cards reviewable', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'past-updated-at',
              word: 'alpha',
              meaning: 'first',
              dueAt: '2000-01-02T00:00:00.000Z',
              createdAt: '2000-01-01T00:00:00.000Z',
              updatedAt: '2000-01-01T00:00:00.000Z',
              state: 'review',
              stability: 2,
              difficulty: 5,
            },
          ],
        }),
      );

      const deck = await loadDeck();

      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].updatedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(Date.parse(deck.cards[0].dueAt)).toBeGreaterThan(Date.parse(deck.cards[0].updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves historical timestamps that are old but still within the supported import window', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'historical-supported-window',
              word: 'archive',
              meaning: 'imported',
              dueAt: '2010-01-03T00:00:00.000Z',
              createdAt: '2010-01-01T00:00:00.000Z',
              updatedAt: '2010-01-02T00:00:00.000Z',
              state: 'review',
              stability: 3,
              difficulty: 5,
            },
          ],
        }),
      );

      const deck = await loadDeck();

      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].createdAt).toBe('2010-01-01T00:00:00.000Z');
      expect(deck.cards[0].updatedAt).toBe('2010-01-02T00:00:00.000Z');
      expect(deck.cards[0].dueAt).toBe('2010-01-03T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('preserves historical timestamps at the 20-year boundary including leap-day drift tolerance', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'historical-leap-window',
              word: 'archive',
              meaning: 'imported',
              dueAt: '2006-02-26T00:00:00.000Z',
              createdAt: '2006-02-24T00:00:00.000Z',
              updatedAt: '2006-02-25T00:00:00.000Z',
              state: 'review',
              stability: 3,
              difficulty: 5,
            },
          ],
        }),
      );

      const deck = await loadDeck();

      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].createdAt).toBe('2006-02-24T00:00:00.000Z');
      expect(deck.cards[0].updatedAt).toBe('2006-02-25T00:00:00.000Z');
      expect(deck.cards[0].dueAt).toBe('2006-02-26T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
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

  it('normalizes malformed persisted states to learning instead of dropping cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'state-recover-1',
            word: 'alpha',
            meaning: 'first',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: ' REVIEW ',
          },
          {
            id: 'state-recover-2',
            word: 'beta',
            meaning: 'second',
            dueAt: '2026-02-23T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-22T00:00:00.000Z',
            state: 'unsupported',
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0].state).toBe('review');
    expect(deck.cards[1].state).toBe('learning');
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
            reps: Number.POSITIVE_INFINITY,
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

  it('rejects loose non-ISO lastReviewedAt while loading', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [],
        lastReviewedAt: '2026-02-23 12:00:00Z',
      }),
    );

    const deck = await loadDeck();
    expect(deck.lastReviewedAt).toBeUndefined();
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

  it('keeps fresh learning cards immediately due when createdAt, updatedAt, and dueAt are aligned', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'learning-fresh-immediate-load',
            word: 'eta-learning-fresh',
            meaning: 'letter',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-24T00:00:00.000Z',
            updatedAt: '2026-02-24T00:00:00.000Z',
            state: 'learning',
            reps: 0,
            lapses: 0,
          },
        ],
      }),
    );

    const deck = await loadDeck();
    expect(deck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
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

  it('repairs relearning cards with sub-floor dueAt values to the 10-minute floor', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'relearning-subfloor-due-repair',
            word: 'eta-relearning-subfloor',
            meaning: 'letter',
            dueAt: '2026-02-24T00:05:00.000Z',
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

  it('ignores loose non-ISO updatedAt when deduplicating persisted cards', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'dup-loose-updated',
            word: 'alpha',
            meaning: 'keep-valid-updated',
            dueAt: '2026-02-24T00:00:00.000Z',
            createdAt: '2026-02-20T00:00:00.000Z',
            updatedAt: '2026-02-23T00:00:00.000Z',
            state: 'review',
            reps: 2,
            lapses: 0,
          },
          {
            id: 'dup-loose-updated',
            word: 'beta',
            meaning: 'drop-loose-updated',
            dueAt: '2026-02-25T00:00:00.000Z',
            createdAt: '2026-02-21T00:00:00.000Z',
            updatedAt: '2026-02-23 01:00:00Z',
            state: 'review',
            reps: 8,
            lapses: 1,
          },
        ],
      }),
    );

    const deck = await loadDeck();

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].id).toBe('dup-loose-updated');
    expect(deck.cards[0].meaning).toBe('keep-valid-updated');
    expect(deck.cards[0].updatedAt).toBe('2026-02-23T00:00:00.000Z');
    expect(deck.cards[0].reps).toBe(2);
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

  it('clamps mildly far learning dueAt schedules to one day instead of collapsing to immediate retries', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'learning-mild-outlier',
            word: 'lambda-learning',
            meaning: 'mild outlier',
            dueAt: '2026-02-23T04:48:00.000Z',
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
    expect(deck.cards[0].dueAt).toBe('2026-02-23T00:00:00.000Z');
  });

  it('clamps mildly far relearning dueAt schedules to two days instead of collapsing to immediate retries', async () => {
    mockedStorage.getItem.mockResolvedValueOnce(
      JSON.stringify({
        cards: [
          {
            id: 'relearning-mild-outlier',
            word: 'lambda-relearning',
            meaning: 'mild outlier',
            dueAt: '2026-02-24T04:48:00.000Z',
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
    expect(deck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
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

  it('repairs pathologically-future review dueAt values to a conservative review interval', async () => {
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
    expect(scheduleDays).toBe(0.5);
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

  it('normalizes persisted review cards to a half-day floor when low stability and dueAt are corrupted', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'review-floor-save',
          word: 'theta',
          meaning: 'letter',
          dueAt: '2099-01-01T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: 4,
          lapses: 1,
          stability: 0.1,
          difficulty: 5,
        },
      ],
    });

    expect(mockedStorage.setItem).toHaveBeenCalledTimes(1);
    const [, serialized] = mockedStorage.setItem.mock.calls[0];
    const persisted = JSON.parse(serialized) as { cards: Array<{ dueAt: string; updatedAt: string; state: string }> };
    expect(persisted.cards).toHaveLength(1);
    expect(persisted.cards[0].state).toBe('review');
    expect(persisted.cards[0].updatedAt).toBe('2026-02-22T00:00:00.000Z');
    expect(persisted.cards[0].dueAt).toBe('2026-02-22T12:00:00.000Z');
  });

  it('saturates positive infinite counters before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'counter-saturation-save',
          word: 'epsilon',
          meaning: 'fifth',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: Number.POSITIVE_INFINITY,
          lapses: Number.POSITIVE_INFINITY,
          stability: 1.5,
          difficulty: 5,
        },
      ],
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as { cards: Array<{ reps: number; lapses: number }> };
    expect(savedDeck.cards).toHaveLength(1);
    expect(savedDeck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(savedDeck.cards[0].lapses).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('saturates inf-alias counter strings before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'counter-saturation-save-alias',
          word: 'epsilon',
          meaning: 'fifth',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: '+inf' as unknown as number,
          lapses: 'inf' as unknown as number,
          stability: 1.5,
          difficulty: 5,
        },
      ],
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as { cards: Array<{ reps: number; lapses: number }> };
    expect(savedDeck.cards).toHaveLength(1);
    expect(savedDeck.cards[0].reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(savedDeck.cards[0].lapses).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('normalizes boxed numeric scheduler fields before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'boxed-numbers-save',
          word: 'zeta',
          meaning: 'sixth',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'review',
          reps: new Number(8) as unknown as number,
          lapses: new Number(3) as unknown as number,
          stability: new Number(2.75) as unknown as number,
          difficulty: new Number(6.25) as unknown as number,
        },
      ],
    });

    expect(mockedStorage.setItem).toHaveBeenCalledTimes(1);
    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as {
      cards: Array<{ reps: number; lapses: number; stability: number; difficulty: number }>;
    };
    expect(savedDeck.cards).toHaveLength(1);
    expect(savedDeck.cards[0].reps).toBe(8);
    expect(savedDeck.cards[0].lapses).toBe(3);
    expect(savedDeck.cards[0].stability).toBe(2.75);
    expect(savedDeck.cards[0].difficulty).toBe(6.25);
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

  it('drops loose non-ISO lastReviewedAt when persisting', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [],
      lastReviewedAt: '2026-02-23 12:00:00Z',
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as { lastReviewedAt?: string };
    expect(savedDeck.lastReviewedAt).toBeUndefined();
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

  it('collapses internal whitespace in notes before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'notes-save-collapse',
          word: 'alpha',
          meaning: 'first',
          notes: '  keep   this \n\t compact  ',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'learning',
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
      cards: Array<{ notes?: string }>;
    };
    expect(savedDeck.cards[0].notes).toBe('keep this compact');
  });

  it('normalizes malformed card states before persisting deck data', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'state-save-1',
          word: 'alpha',
          meaning: 'first',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: ' REVIEW ' as unknown as 'review',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
        {
          id: 'state-save-2',
          word: 'beta',
          meaning: 'second',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: 'not-a-state' as unknown as 'review',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
        {
          id: 'state-save-3',
          word: 'gamma',
          meaning: 'third',
          dueAt: '2026-02-23T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-22T00:00:00.000Z',
          state: ' relearn!! ' as unknown as 'review',
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
      cards: Array<{ id: string; state: string }>;
    };
    expect(savedDeck.cards).toHaveLength(3);
    expect(savedDeck.cards.find((card) => card.id === 'state-save-1')?.state).toBe('review');
    expect(savedDeck.cards.find((card) => card.id === 'state-save-2')?.state).toBe('learning');
    expect(savedDeck.cards.find((card) => card.id === 'state-save-3')?.state).toBe('relearning');
  });

  it('keeps fresh learning cards immediately due when persisting aligned timestamps', async () => {
    mockedStorage.setItem.mockResolvedValueOnce();

    await saveDeck({
      cards: [
        {
          id: 'learning-fresh-immediate-save',
          word: 'alpha',
          meaning: 'first',
          dueAt: '2026-02-24T00:00:00.000Z',
          createdAt: '2026-02-24T00:00:00.000Z',
          updatedAt: '2026-02-24T00:00:00.000Z',
          state: 'learning',
          reps: 0,
          lapses: 0,
          stability: 0.5,
          difficulty: 5,
        },
      ],
    });

    const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
    const savedDeck = JSON.parse(rawSavedDeck) as {
      cards: Array<{ dueAt: string; updatedAt: string }>;
    };
    expect(savedDeck.cards).toHaveLength(1);
    expect(savedDeck.cards[0].updatedAt).toBe('2026-02-24T00:00:00.000Z');
    expect(savedDeck.cards[0].dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('repairs pathologically-future review dueAt values before persisting deck data', async () => {
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

    expect(scheduleDays).toBe(120);
  });

  it('clamps overflowed repaired dueAt timestamps when loading cards near the max supported date', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('+275760-09-13T00:00:00.000Z'));
    try {
      mockedStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({
          cards: [
            {
              id: 'max-date-load-clamp',
              word: 'omega',
              meaning: 'last',
              dueAt: '+275760-09-13T00:00:00.000Z',
              createdAt: '+275760-09-13T00:00:00.000Z',
              updatedAt: '+275760-09-13T00:00:00.000Z',
              state: 'learning',
              reps: 2,
              lapses: 0,
              stability: 1,
              difficulty: 5,
            },
          ],
        }),
      );

      const deck = await loadDeck();
      expect(deck.cards).toHaveLength(1);
      expect(deck.cards[0].updatedAt).toBe('+275760-09-13T00:00:00.000Z');
      expect(deck.cards[0].dueAt).toBe('+275760-09-13T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('clamps overflowed repaired dueAt timestamps when saving cards near the max supported date', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('+275760-09-13T00:00:00.000Z'));
    mockedStorage.setItem.mockResolvedValueOnce();
    try {
      await saveDeck({
        cards: [
          {
            id: 'max-date-save-clamp',
            word: 'omega',
            meaning: 'last',
            dueAt: '+275760-09-13T00:00:00.000Z',
            createdAt: '+275760-09-13T00:00:00.000Z',
            updatedAt: '+275760-09-13T00:00:00.000Z',
            state: 'learning',
            reps: 2,
            lapses: 0,
            stability: 1,
            difficulty: 5,
          },
        ],
      });

      const [, rawSavedDeck] = mockedStorage.setItem.mock.calls[0];
      const savedDeck = JSON.parse(rawSavedDeck) as { cards: Array<{ updatedAt: string; dueAt: string }> };
      expect(savedDeck.cards).toHaveLength(1);
      expect(savedDeck.cards[0].updatedAt).toBe('+275760-09-13T00:00:00.000Z');
      expect(savedDeck.cards[0].dueAt).toBe('+275760-09-13T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });
});
