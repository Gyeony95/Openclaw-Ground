import { createNewCard, previewIntervals, reviewCard } from './fsrs';
import { Rating } from '../types';
import { addDaysIso } from '../utils/time';
import { STABILITY_MAX } from './constants';

const NOW = '2026-02-23T12:00:00.000Z';

describe('fsrs scheduler', () => {
  it('creates new cards with trimmed fields', () => {
    const card = createNewCard('  alpha ', ' first letter  ', NOW, '  note ');

    expect(card.word).toBe('alpha');
    expect(card.meaning).toBe('first letter');
    expect(card.notes).toBe('note');
    expect(card.state).toBe('learning');
    expect(card.reps).toBe(0);
  });

  it('repairs whitespace-only word and meaning values when creating cards', () => {
    const card = createNewCard('   ', '   ', NOW, '  note ');

    expect(card.word).toBe('[invalid word]');
    expect(card.meaning).toBe('[invalid meaning]');
    expect(card.notes).toBe('note');
  });

  it('repairs zero-width-only word and meaning values when creating cards', () => {
    const card = createNewCard('\u200B\u200C', '\u200D\uFEFF', NOW, '\u200B note \uFEFF');

    expect(card.word).toBe('[invalid word]');
    expect(card.meaning).toBe('[invalid meaning]');
    expect(card.notes).toBe('note');
  });

  it('enforces scheduler-side field length limits when creating cards', () => {
    const card = createNewCard('a'.repeat(120), 'b'.repeat(220), NOW, 'c'.repeat(320));

    expect(card.word).toHaveLength(80);
    expect(card.meaning).toHaveLength(180);
    expect(card.notes).toHaveLength(240);
  });

  it('drops whitespace-only notes while creating cards', () => {
    const card = createNewCard('alpha', 'letter', NOW, '   ');

    expect(card.notes).toBeUndefined();
  });

  it('keeps valid historical creation timestamps instead of forcing wall clock', () => {
    const historicalNow = '2020-01-01T00:00:00.000Z';
    const card = createNewCard('historical', 'timestamp', historicalNow);

    expect(card.createdAt).toBe(historicalNow);
    expect(card.updatedAt).toBe(historicalNow);
    expect(card.dueAt).toBe(historicalNow);
  });

  it('keeps historical import timestamps when they are within the allowed skew window', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
      const historicalNow = '2010-06-15T00:00:00.000Z';
      const card = createNewCard('legacy', 'imported', historicalNow);

      expect(card.createdAt).toBe(historicalNow);
      expect(card.updatedAt).toBe(historicalNow);
      expect(card.dueAt).toBe(historicalNow);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to runtime wall clock when creation timestamp is pathologically far future', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const card = createNewCard('future-now', 'timestamp', '2060-01-01T00:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.dueAt).toBe('2026-02-23T14:30:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to runtime wall clock when creation timestamp is materially future-skewed', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const card = createNewCard('future-skew', 'timestamp', '2026-02-24T14:30:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.dueAt).toBe('2026-02-23T14:30:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps near-future creation timestamps that are within monotonic skew tolerance', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const card = createNewCard('small-skew', 'timestamp', '2026-02-23T16:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T16:00:00.000Z');
      expect(card.updatedAt).toBe('2026-02-23T16:00:00.000Z');
      expect(card.dueAt).toBe('2026-02-23T16:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to runtime wall clock when creation timestamp input is invalid', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const card = createNewCard('invalid-now', 'timestamp', 'not-a-date');

      expect(card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.dueAt).toBe('2026-02-23T14:30:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to epoch timestamps when runtime clock is non-finite during card creation', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const card = createNewCard('nan-clock', 'safe', 'not-a-date');
    nowSpy.mockRestore();

    expect(card.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(card.updatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(card.dueAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('avoids NaN segments in generated card IDs when runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const card = createNewCard('nan-clock-id', 'safe', NOW);
    nowSpy.mockRestore();

    expect(card.id.includes('NaN')).toBe(false);
  });

  it('keeps explicit valid creation timestamps when runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const card = createNewCard('nan-clock-valid-now', 'safe', NOW);
    nowSpy.mockRestore();

    expect(card.createdAt).toBe(NOW);
    expect(card.updatedAt).toBe(NOW);
    expect(card.dueAt).toBe(NOW);
  });

  it('falls back to runtime wall clock when creation timestamp is pathologically far past', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const card = createNewCard('past-now', 'timestamp', '1980-01-01T00:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(card.dueAt).toBe('2026-02-23T14:30:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores pathologically old dueAt values as timeline anchors when creation fields are malformed', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const malformedTimeline = {
        ...createNewCard('old-anchor', 'timeline', NOW),
        createdAt: 'not-a-time',
        updatedAt: 'also-not-a-time',
        dueAt: '1900-01-01T00:00:00.000Z',
      };

      const reviewed = reviewCard(malformedTimeline, 3, '2026-02-23T14:30:00.000Z');

      expect(reviewed.card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let pathologically old dueAt values rewrite valid createdAt history', () => {
    const validTimeline = {
      ...createNewCard('old-due-anchor-preserve-created', 'timeline', NOW),
      createdAt: '2026-02-20T00:00:00.000Z',
      updatedAt: '2026-02-22T00:00:00.000Z',
      dueAt: '1900-01-01T00:00:00.000Z',
      state: 'review' as const,
      stability: 3,
    };

    const reviewed = reviewCard(validTimeline, 3, '2026-02-23T14:30:00.000Z');

    expect(reviewed.card.createdAt).toBe('2026-02-20T00:00:00.000Z');
    expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('falls back to runtime wall clock when review time is invalid and card timeline is future-corrupted', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const futureCorrupted = {
        ...createNewCard('future-corrupted', 'timeline', NOW),
        state: 'review' as const,
        updatedAt: '2026-04-01T00:00:00.000Z',
        dueAt: '2026-04-05T00:00:00.000Z',
      };

      const reviewed = reviewCard(futureCorrupted, 3, 'not-a-date');

      expect(Date.parse(reviewed.card.createdAt)).toBeLessThanOrEqual(Date.parse(reviewed.card.updatedAt));
      expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('resets schedule anchors when rolling back pathologically future review timelines', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const futureCorrupted = {
        ...createNewCard('future-corrupted-anchor-reset', 'timeline', NOW),
        state: 'review' as const,
        updatedAt: '2030-01-01T00:00:00.000Z',
        dueAt: '2030-05-01T00:00:00.000Z',
        stability: 120,
      };

      const reviewed = reviewCard(futureCorrupted, 3, 'not-a-date');

      expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
      expect(reviewed.scheduledDays).toBeLessThanOrEqual(2);
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps rollback schedule anchors stability-aware for hard review retries', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const futureCorrupted = {
        ...createNewCard('future-corrupted-hard-anchor', 'timeline', NOW),
        state: 'review' as const,
        updatedAt: '2030-01-01T00:00:00.000Z',
        dueAt: '2030-05-01T00:00:00.000Z',
        stability: 5,
        difficulty: 5,
      };

      const reviewed = reviewCard(futureCorrupted, 2, 'not-a-date');

      expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(reviewed.card.state).toBe('review');
      expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(reviewed.scheduledDays).toBeLessThanOrEqual(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('normalizes folded relearning state aliases before applying ratings', () => {
    const foldedRelearning = {
      ...createNewCard('folded-relearning', 'state alias', NOW),
      state: 're-learning' as unknown as 'relearning',
      dueAt: NOW,
      updatedAt: NOW,
    };

    const reviewed = reviewCard(foldedRelearning, 1, NOW);

    expect(reviewed.card.state).toBe('relearning');
  });

  it('normalizes createdAt to never exceed updatedAt when recovering from future-corrupted timelines', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T14:30:00.000Z'));
      const futureCorrupted = {
        ...createNewCard('future-corrupted-created', 'timeline', NOW),
        state: 'review' as const,
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        dueAt: '2026-04-05T00:00:00.000Z',
      };

      const reviewed = reviewCard(futureCorrupted, 3, 'not-a-date');

      expect(reviewed.card.createdAt).toBe('2026-02-23T14:30:00.000Z');
      expect(reviewed.card.updatedAt).toBe('2026-02-23T14:30:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('normalizes oversized card text fields while reviewing existing cards', () => {
    const card = {
      ...createNewCard('phi-text', 'letter', NOW),
      word: ` ${'w'.repeat(120)} `,
      meaning: ` ${'m'.repeat(220)} `,
      notes: ` ${'n'.repeat(320)} `,
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.word).toHaveLength(80);
    expect(reviewed.card.meaning).toHaveLength(180);
    expect(reviewed.card.notes).toHaveLength(240);
    expect(reviewed.card.word.startsWith(' ')).toBe(false);
    expect(reviewed.card.meaning.startsWith(' ')).toBe(false);
  });

  it('keeps explicit valid review timestamps when runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const reviewAt = addDaysIso(NOW, 1);
    const reviewed = reviewCard(
      {
        ...createNewCard('nan-review-clock', 'safe', NOW),
        state: 'review' as const,
        dueAt: addDaysIso(NOW, 1),
        updatedAt: NOW,
      },
      3,
      reviewAt,
    );
    nowSpy.mockRestore();

    expect(reviewed.card.updatedAt).toBe(reviewAt);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('ignores pathologically far-future review timestamps even when runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const baseUpdatedAt = NOW;
    const reviewed = reviewCard(
      {
        ...createNewCard('nan-review-future-clamp', 'safe', NOW),
        state: 'review' as const,
        dueAt: addDaysIso(NOW, 1),
        updatedAt: baseUpdatedAt,
      },
      3,
      '2050-01-01T00:00:00.000Z',
    );
    nowSpy.mockRestore();

    expect(reviewed.card.updatedAt).toBe(baseUpdatedAt);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('recovers pathologically stale card timelines when a wall-safe review timestamp is provided', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      const reviewed = reviewCard(
        {
          ...createNewCard('stale-timeline-recovery', 'safe', NOW),
          state: 'review' as const,
          createdAt: '1980-01-01T00:00:00.000Z',
          updatedAt: '1980-01-02T00:00:00.000Z',
          dueAt: '1980-01-03T00:00:00.000Z',
          stability: 2,
        },
        3,
        '2026-02-23T12:00:00.000Z',
      );

      expect(reviewed.card.updatedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('still ignores review timestamps that are far beyond wall clock even when stale timelines are present', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      const reviewed = reviewCard(
        {
          ...createNewCard('stale-timeline-future-review-clamp', 'safe', NOW),
          state: 'review' as const,
          createdAt: '1980-01-01T00:00:00.000Z',
          updatedAt: '1980-01-02T00:00:00.000Z',
          dueAt: '1980-01-03T00:00:00.000Z',
          stability: 2,
        },
        3,
        '2050-01-01T00:00:00.000Z',
      );

      expect(reviewed.card.updatedAt).toBe('1980-01-02T00:00:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps valid dueAt as a timeline anchor when runtime wall clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const repaired = reviewCard(
      {
        ...createNewCard('nan-timeline-anchor', 'safe', NOW),
        createdAt: 'not-a-date',
        updatedAt: 'also-not-a-date',
        dueAt: NOW,
        state: 'learning' as const,
      },
      3,
      NOW,
    );
    nowSpy.mockRestore();

    expect(repaired.card.createdAt).toBe(NOW);
    expect(repaired.card.updatedAt).toBe(NOW);
    expect(repaired.card.state).toBe('review');
  });

  it('collapses internal whitespace in word and meaning when creating cards', () => {
    const card = createNewCard('  new   york  ', '  very   large   city  ', NOW);

    expect(card.word).toBe('new york');
    expect(card.meaning).toBe('very large city');
  });

  it('collapses internal whitespace in word and meaning during review normalization', () => {
    const card = {
      ...createNewCard('phi-spacing', 'letter', NOW),
      word: '  spaced    word  ',
      meaning: '  many    spaces   here ',
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.word).toBe('spaced word');
    expect(reviewed.card.meaning).toBe('many spaces here');
  });

  it('drops whitespace-only notes while reviewing existing cards', () => {
    const card = {
      ...createNewCard('phi-notes', 'letter', NOW),
      notes: '    ',
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.notes).toBeUndefined();
  });

  it('collapses internal whitespace in notes during create and review normalization', () => {
    const created = createNewCard('phi-notes-create', 'letter', NOW, '  line   one \n\t line   two  ');
    expect(created.notes).toBe('line one line two');

    const reviewed = reviewCard(
      {
        ...created,
        notes: '  keep   this \n\t compact  ',
      },
      3,
      NOW,
    );
    expect(reviewed.card.notes).toBe('keep this compact');
  });

  it('repairs whitespace-only word and meaning values during review normalization', () => {
    const card = {
      ...createNewCard('phi-placeholders', 'letter', NOW),
      word: '   ',
      meaning: '   ',
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.word).toBe('[invalid word]');
    expect(reviewed.card.meaning).toBe('[invalid meaning]');
  });

  it('repairs zero-width-only word and meaning values during review normalization', () => {
    const card = {
      ...createNewCard('phi-placeholders-zero-width', 'letter', NOW),
      word: '\u200B\u200C',
      meaning: '\u200D\uFEFF',
      notes: '\u200B\uFEFF',
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.word).toBe('[invalid word]');
    expect(reviewed.card.meaning).toBe('[invalid meaning]');
    expect(reviewed.card.notes).toBeUndefined();
  });

  it('falls back to placeholders when runtime card text fields are malformed', () => {
    const malformed = {
      ...createNewCard('phi-malformed', 'letter', NOW),
      word: null as unknown as string,
      meaning: 42 as unknown as string,
      notes: { detail: 'bad' } as unknown as string,
    };

    const reviewed = reviewCard(malformed, 3, NOW);

    expect(reviewed.card.word).toBe('[invalid word]');
    expect(reviewed.card.meaning).toBe('[invalid meaning]');
    expect(reviewed.card.notes).toBeUndefined();
  });

  it('generates unique ids for rapid card creation at the same timestamp', () => {
    const first = createNewCard('alpha-id-1', 'first', NOW);
    const second = createNewCard('alpha-id-2', 'second', NOW);

    expect(first.id).not.toBe(second.id);
  });

  it('does not depend on Math.random for card id uniqueness', () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
    try {
      const first = createNewCard('alpha-id-deterministic-1', 'first', NOW);
      const second = createNewCard('alpha-id-deterministic-2', 'second', NOW);

      expect(first.id).not.toBe(second.id);
      expect(first.id.startsWith('1771848000000-')).toBe(true);
      expect(second.id.startsWith('1771848000000-')).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('includes a deterministic runtime salt segment in generated card IDs', () => {
    jest.useFakeTimers();
    try {
      const systemTime = '2026-02-23T12:34:56.000Z';
      jest.setSystemTime(new Date(systemTime));
      const card = createNewCard('salted-id', 'format', NOW);
      const [timestampPart, saltPart, sequencePart] = card.id.split('-');

      expect(timestampPart).toBe(String(Date.parse(NOW)));
      expect(saltPart).toBe(Date.parse(systemTime).toString(36));
      expect(sequencePart.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('schedules short relearning interval on failure', () => {
    const card = createNewCard('echo', 'sound', NOW);
    const firstReview = reviewCard(card, 3, NOW).card;
    const second = reviewCard(firstReview, 1, '2026-02-24T12:00:00.000Z');

    expect(second.card.state).toBe('relearning');
    expect(second.card.lapses).toBe(1);
    expect(second.scheduledDays).toBeLessThan(0.02);
  });

  it('keeps failed new cards in learning state', () => {
    const card = createNewCard('delta', 'change', NOW);
    const review = reviewCard(card, 1, NOW);

    expect(review.card.state).toBe('learning');
    expect(review.card.lapses).toBe(0);
    expect(review.scheduledDays).toBeLessThan(0.002);
  });

  it('treats malformed ratings as neutral reviews instead of punitive lapses', () => {
    const reviewCardBase = {
      ...createNewCard('invalid-rating-review', 'letter', NOW),
      state: 'review' as const,
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 5,
      lapses: 2,
      stability: 3,
      difficulty: 5,
    };

    const reviewed = reviewCard(reviewCardBase, Number.NaN as Rating, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.card.lapses).toBe(reviewCardBase.lapses);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('treats out-of-range review ratings as neutral reviews instead of Easy promotions', () => {
    const reviewCardBase = {
      ...createNewCard('invalid-rating-range-review', 'letter', NOW),
      state: 'review' as const,
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 5,
      lapses: 2,
      stability: 3,
      difficulty: 5,
    };

    const reviewed = reviewCard(reviewCardBase, 99 as Rating, addDaysIso(NOW, 1));
    const neutral = reviewCard(reviewCardBase, 3, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.card.lapses).toBe(reviewCardBase.lapses);
    expect(reviewed.scheduledDays).toBe(neutral.scheduledDays);
  });

  it('treats fractional review ratings as neutral reviews instead of rounding to Easy', () => {
    const reviewCardBase = {
      ...createNewCard('invalid-rating-fractional-review', 'letter', NOW),
      state: 'review' as const,
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 5,
      lapses: 2,
      stability: 3,
      difficulty: 5,
    };

    const reviewed = reviewCard(reviewCardBase, 3.6 as Rating, addDaysIso(NOW, 1));
    const neutral = reviewCard(reviewCardBase, 3, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.card.lapses).toBe(reviewCardBase.lapses);
    expect(reviewed.scheduledDays).toBe(neutral.scheduledDays);
  });

  it('treats out-of-range learning ratings as Again to avoid accidental promotion', () => {
    const learningCard = createNewCard('invalid-rating-range-learning', 'letter', NOW);
    const reviewed = reviewCard(learningCard, 99 as Rating, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.card.reps).toBe(1);
    expect(reviewed.scheduledDays).toBeCloseTo(1 / 1440, 7);
  });

  it('treats fractional learning ratings as Again to avoid accidental promotion', () => {
    const learningCard = createNewCard('invalid-rating-fractional-learning', 'letter', NOW);
    const reviewed = reviewCard(learningCard, 2.7 as Rating, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.card.reps).toBe(1);
    expect(reviewed.scheduledDays).toBeCloseTo(1 / 1440, 7);
  });

  it('normalizes whitespace-padded review state strings at runtime', () => {
    const reviewCardBase = {
      ...createNewCard('runtime-state-review', 'letter', NOW),
      state: ' REVIEW ' as unknown as 'review',
      dueAt: addDaysIso(NOW, 1),
      updatedAt: NOW,
      reps: 5,
      lapses: 2,
      stability: 3,
      difficulty: 5,
    };

    const reviewed = reviewCard(reviewCardBase, 3, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.card.lapses).toBe(reviewCardBase.lapses);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('normalizes relearn aliases to relearning at runtime', () => {
    const relearnAliasCard = {
      ...createNewCard('runtime-state-relearn', 'letter', NOW),
      state: ' ReLearn ' as unknown as 'relearning',
      dueAt: NOW,
      updatedAt: NOW,
    };

    const reviewed = reviewCard(relearnAliasCard, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
  });

  it('anchors malformed low review stability to the existing schedule for early good reviews', () => {
    const inconsistent = {
      ...createNewCard('stability-anchor-good', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 10),
      stability: 0.1,
      difficulty: 6,
      reps: 12,
      lapses: 1,
    };
    const earlyIso = addDaysIso(NOW, 5);

    const reviewed = reviewCard(inconsistent, 3, earlyIso);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(4);
  });

  it('anchors malformed low review stability to the existing schedule for early easy reviews', () => {
    const inconsistent = {
      ...createNewCard('stability-anchor-easy', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 10),
      stability: 0.1,
      difficulty: 6,
      reps: 12,
      lapses: 1,
    };
    const earlyIso = addDaysIso(NOW, 5);

    const reviewed = reviewCard(inconsistent, 4, earlyIso);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(5);
  });

  it('anchors malformed low review stability for early hard reviews to avoid collapsing mature cadence', () => {
    const inconsistent = {
      ...createNewCard('stability-anchor-hard', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 10),
      stability: 0.1,
      difficulty: 6,
      reps: 12,
      lapses: 1,
    };
    const earlyIso = addDaysIso(NOW, 5);

    const reviewed = reviewCard(inconsistent, 2, earlyIso);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(3);
  });

  it('keeps plausible long review schedules instead of over-repairing from stale low stability', () => {
    const imported = {
      ...createNewCard('stability-window-preserve', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 45),
      stability: 0.5,
      difficulty: 6,
      reps: 14,
      lapses: 1,
    };

    const reviewed = reviewCard(imported, 3, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(20);
  });

  it('still repairs pathologically long review schedules that far exceed stability expectations', () => {
    const pathological = {
      ...createNewCard('stability-window-repair', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 220),
      stability: 0.5,
      difficulty: 6,
      reps: 14,
      lapses: 1,
    };

    const reviewed = reviewCard(pathological, 3, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeLessThan(30);
  });

  it('uses an intermediate hard step before graduating learning cards', () => {
    const card = createNewCard('learning-hard-step', 'definition', NOW);
    const hard = reviewCard(card, 2, NOW);

    expect(hard.card.state).toBe('learning');
    expect(hard.scheduledDays).toBeCloseTo(5 / 1440, 7);
  });

  it('uses a short graduation interval when learning cards are first rated good', () => {
    const card = createNewCard('xi', 'letter', NOW);
    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBe(0.5);
    expect(reviewed.card.dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('keeps hard relearning cards in relearning state', () => {
    const card = createNewCard('theta', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(first, 1, '2026-02-24T12:00:00.000Z').card;
    const hard = reviewCard(failed, 2, '2026-02-24T12:10:00.000Z');

    expect(hard.card.state).toBe('relearning');
    expect(hard.scheduledDays).toBeLessThan(0.03);
  });

  it('keeps relearning hard interval in a short retry window', () => {
    const card = createNewCard('relearning-hard-step', 'definition', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const hard = reviewCard(failed, 2, '2026-02-24T12:10:00.000Z');

    expect(hard.card.state).toBe('relearning');
    expect(hard.scheduledDays).toBeCloseTo(15 / 1440, 7);
  });

  it('does not reset relearning graduates to initial stability', () => {
    const card = createNewCard('mu', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-25T12:00:00.000Z').card;
    const relearned = reviewCard(failed, 3, '2026-02-25T12:30:00.000Z');

    expect(relearned.card.state).toBe('review');
    expect(relearned.card.stability).toBeLessThanOrEqual(failed.stability + 0.2);
  });

  it('keeps learning graduation intervals short even after repeated failed attempts', () => {
    const card = createNewCard('xi-retries', 'letter', NOW);
    const firstFail = reviewCard(card, 1, NOW).card;
    const secondFail = reviewCard(firstFail, 1, '2026-02-23T12:10:00.000Z').card;
    const good = reviewCard(secondFail, 3, '2026-02-23T12:20:00.000Z');
    const easy = reviewCard(secondFail, 4, '2026-02-23T12:20:00.000Z');

    expect(good.card.state).toBe('review');
    expect(good.scheduledDays).toBe(0.5);
    expect(easy.card.state).toBe('review');
    expect(easy.scheduledDays).toBe(1);
  });

  it('does not permanently inflate difficulty from repeated failed learning steps', () => {
    const clean = reviewCard(createNewCard('upsilon-diff-clean', 'letter', NOW), 4, NOW).card;
    const retriesBase = createNewCard('upsilon-diff-retries', 'letter', NOW);
    const fail1 = reviewCard(retriesBase, 1, NOW).card;
    const fail2 = reviewCard(fail1, 1, '2026-02-23T12:10:00.000Z').card;
    const fail3 = reviewCard(fail2, 1, '2026-02-23T12:20:00.000Z').card;
    const retries = reviewCard(fail3, 4, '2026-02-23T12:30:00.000Z').card;

    expect(retries.state).toBe('review');
    expect(retries.difficulty).toBeLessThanOrEqual(clean.difficulty + 0.01);
  });

  it('keeps relearning graduation intervals bounded to sub-day or one day', () => {
    const card = createNewCard('omicron-2', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const good = reviewCard(failed, 3, '2026-02-24T12:10:00.000Z');
    const easy = reviewCard(failed, 4, '2026-02-24T12:10:00.000Z');

    expect(good.card.state).toBe('review');
    expect(easy.card.state).toBe('review');
    expect(good.scheduledDays).toBe(0.5);
    expect(easy.scheduledDays).toBe(1);
  });

  it('keeps day-like relearning graduation from shrinking below one day', () => {
    const relearning = {
      ...createNewCard('omicron-2-daylike', 'letter', NOW),
      state: 'relearning' as const,
      updatedAt: NOW,
      createdAt: NOW,
      dueAt: addDaysIso(NOW, 1.25),
      stability: 1.25,
      difficulty: 6,
      reps: 11,
      lapses: 3,
    };

    const reviewed = reviewCard(relearning, 3, relearning.dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('keeps relearning graduation stability at least as large as the graduation schedule', () => {
    const relearning = {
      ...createNewCard('relearning-grad-stability-floor', 'definition', NOW),
      state: 'relearning' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 10 / 1440),
      stability: 0.1,
      difficulty: 5,
      reps: 10,
      lapses: 3,
    };

    const graduated = reviewCard(relearning, 3, relearning.dueAt);

    expect(graduated.card.state).toBe('review');
    expect(graduated.scheduledDays).toBe(0.5);
    expect(graduated.card.stability).toBeGreaterThanOrEqual(graduated.scheduledDays);
  });

  it('grows review interval after successful reviews', () => {
    const card = createNewCard('beta', 'second letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z');

    expect(second.card.state).toBe('review');
    expect(second.scheduledDays).toBeGreaterThanOrEqual(2);
    expect(second.card.stability).toBeGreaterThan(first.stability);
  });

  it('schedules longer interval when successful review is overdue', () => {
    const card = createNewCard('iota', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;

    const onTime = reviewCard(first, 3, first.dueAt);
    const overdue = reviewCard(first, 3, '2026-02-27T12:00:00.000Z');

    expect(overdue.scheduledDays).toBeGreaterThan(onTime.scheduledDays);
    expect(overdue.card.stability).toBeGreaterThan(onTime.card.stability);
  });

  it('schedules shorter interval when reviewing early', () => {
    const card = createNewCard('kappa', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const dueTime = Date.parse(first.dueAt);
    const earlyIso = new Date(dueTime - 12 * 60 * 60 * 1000).toISOString();

    const onTime = reviewCard(first, 3, first.dueAt);
    const early = reviewCard(first, 3, earlyIso);

    expect(early.scheduledDays).toBeLessThan(onTime.scheduledDays);
  });

  it('keeps early good reviews from collapsing mature review schedules below half', () => {
    const card = {
      ...createNewCard('kappa-early-good-floor', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 20),
      stability: 0.1,
      difficulty: 10,
      reps: 20,
      lapses: 2,
    };
    const earlyGood = reviewCard(card, 3, addDaysIso(NOW, 1));

    expect(earlyGood.card.state).toBe('review');
    expect(earlyGood.scheduledDays).toBeGreaterThanOrEqual(10);
    expect(earlyGood.scheduledDays).toBeLessThan(20);
  });

  it('reduces stability more when failing overdue review cards', () => {
    const card = createNewCard('lambda', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;

    const onTimeFail = reviewCard(first, 1, first.dueAt);
    const overdueFail = reviewCard(first, 1, '2026-02-27T12:00:00.000Z');

    expect(overdueFail.card.stability).toBeLessThan(onTimeFail.card.stability);
  });

  it('caps failed mature review stability to a short relearning-safe window', () => {
    const mature = {
      ...createNewCard('lambda-mature-lapse', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 120),
      stability: 240,
      difficulty: 4.2,
      reps: 80,
      lapses: 3,
    };

    const failed = reviewCard(mature, 1, mature.dueAt);

    expect(failed.card.state).toBe('relearning');
    expect(failed.card.stability).toBeLessThanOrEqual(1);
    expect(failed.card.stability).toBeGreaterThan(0);
  });

  it('keeps repeated relearning failures capped to a short stability ceiling', () => {
    const relearning = {
      ...createNewCard('lambda-relearning-lapse', 'letter', NOW),
      state: 'relearning' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 1),
      stability: 25,
      difficulty: 6.4,
      reps: 81,
      lapses: 7,
    };

    const failed = reviewCard(relearning, 1, relearning.dueAt);

    expect(failed.card.state).toBe('relearning');
    expect(failed.card.stability).toBeLessThanOrEqual(2);
    expect(failed.card.stability).toBeGreaterThan(0);
  });

  it('keeps easy review intervals at least as long as the current schedule', () => {
    const card = createNewCard('nu', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const next = reviewCard(second, 4, second.dueAt);

    expect(next.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('keeps good review intervals at least as long as the current schedule when on time', () => {
    const card = createNewCard('nu-2', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const next = reviewCard(second, 3, second.dueAt);

    expect(next.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('keeps hard review intervals at least as long as the current schedule when on time', () => {
    const card = createNewCard('nu-hard-floor', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const next = reviewCard(second, 2, second.dueAt);

    expect(next.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('does not round down day-like imported schedules on on-time good reviews', () => {
    const card = {
      ...createNewCard('nu-good-irregular-floor', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 1.6),
      stability: 2.2,
      difficulty: 5,
      reps: 8,
      lapses: 1,
    };

    const next = reviewCard(card, 3, card.dueAt);

    expect(next.card.state).toBe('review');
    expect(next.scheduledDays).toBeGreaterThanOrEqual(2);
  });

  it('does not round down day-like imported schedules on on-time hard reviews', () => {
    const card = {
      ...createNewCard('nu-hard-irregular-floor', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 1.2),
      stability: 2.1,
      difficulty: 6,
      reps: 8,
      lapses: 1,
    };

    const next = reviewCard(card, 2, card.dueAt);

    expect(next.card.state).toBe('review');
    expect(next.scheduledDays).toBeGreaterThanOrEqual(2);
  });

  it('does not inflate on-time hard review intervals beyond the current schedule', () => {
    const card = createNewCard('nu-hard-ontime-cap', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const next = reviewCard(second, 2, second.dueAt);

    expect(next.card.state).toBe('review');
    expect(next.scheduledDays).toBe(scheduled);
  });

  it('keeps hard reviews within the current schedule when only slightly late', () => {
    const card = {
      ...createNewCard('nu-hard-slightly-late-cap', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 1),
      stability: 20,
      difficulty: 3,
      reps: 20,
      lapses: 1,
    };
    const slightLateIso = '2026-02-24T12:05:00.000Z';
    const next = reviewCard(card, 2, slightLateIso);

    expect(next.card.state).toBe('review');
    expect(next.scheduledDays).toBe(1);
  });

  it('allows early hard reviews to keep shorter intervals than the current schedule', () => {
    const card = createNewCard('nu-hard-early', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const earlyIso = new Date(Date.parse(second.updatedAt) + 12 * 60 * 60 * 1000).toISOString();
    const earlyHard = reviewCard(second, 2, earlyIso);

    expect(earlyHard.scheduledDays).toBeLessThanOrEqual(scheduled);
  });

  it('keeps early hard reviews on half-day schedules from extending to a full day', () => {
    const card = createNewCard('halfday-hard-early', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const earlyIso = '2026-02-23T18:00:00.000Z';
    const earlyHard = reviewCard(graduated, 2, earlyIso);

    expect(earlyHard.card.state).toBe('review');
    expect(earlyHard.scheduledDays).toBe(0.5);
  });

  it('keeps on-time good reviews on half-day schedules at least half-day', () => {
    const card = createNewCard('halfday-good-ontime', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const onTime = reviewCard(graduated, 3, graduated.dueAt);

    expect(onTime.card.state).toBe('review');
    expect(onTime.scheduledDays).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps on-time hard reviews on half-day schedules at half-day', () => {
    const card = createNewCard('halfday-hard-ontime', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const onTimeHard = reviewCard(graduated, 2, graduated.dueAt);

    expect(onTimeHard.card.state).toBe('review');
    expect(onTimeHard.scheduledDays).toBe(0.5);
  });

  it('keeps on-time good reviews from shrinking irregular sub-day schedules', () => {
    const card = {
      ...createNewCard('subday-good-floor', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 0.75),
      stability: 0.8,
      difficulty: 6,
      reps: 11,
      lapses: 1,
    };

    const onTimeGood = reviewCard(card, 3, card.dueAt);

    expect(onTimeGood.card.state).toBe('review');
    expect(onTimeGood.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('keeps on-time hard reviews from shrinking irregular sub-day schedules', () => {
    const card = {
      ...createNewCard('subday-hard-floor', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 0.75),
      stability: 0.8,
      difficulty: 6,
      reps: 11,
      lapses: 1,
    };

    const onTimeHard = reviewCard(card, 2, card.dueAt);

    expect(onTimeHard.card.state).toBe('review');
    expect(onTimeHard.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('promotes overdue hard reviews on half-day schedules to at least one day', () => {
    const card = createNewCard('halfday-hard-overdue-floor', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const overdueIso = addDaysIso(graduated.updatedAt, 1.5);
    const overdueHard = reviewCard(graduated, 2, overdueIso);

    expect(overdueHard.card.state).toBe('review');
    expect(overdueHard.scheduledDays).toBe(1);
  });

  it('keeps very-early good reviews on low-stability half-day schedules within sub-day cadence', () => {
    const base = createNewCard('halfday-good-cadence', 'letter', NOW);
    const subDayReview = {
      ...base,
      state: 'review' as const,
      createdAt: NOW,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 0.5),
      stability: 0.1,
      difficulty: 5,
      reps: 12,
      lapses: 1,
    };
    const veryEarlyGood = reviewCard(subDayReview, 3, NOW);

    expect(veryEarlyGood.card.state).toBe('review');
    expect(veryEarlyGood.scheduledDays).toBe(0.5);
  });

  it('does not let early hard reviews extend the current schedule', () => {
    let card = createNewCard('nu-hard-early-cap', 'letter', NOW);
    card = reviewCard(card, 4, NOW).card;
    card = reviewCard(card, 4, '2026-03-02T12:00:00.000Z').card;
    card = reviewCard(card, 4, card.dueAt).card;

    const scheduled = Math.round((Date.parse(card.dueAt) - Date.parse(card.updatedAt)) / (24 * 60 * 60 * 1000));
    const earlyIso = addDaysIso(card.updatedAt, Math.max(1, scheduled * 0.2));
    const earlyHard = reviewCard(card, 2, earlyIso);

    expect(earlyHard.scheduledDays).toBeLessThanOrEqual(scheduled);
  });

  it('keeps overdue hard review intervals at least as long as the current schedule', () => {
    const card = createNewCard('nu-hard-overdue', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const overdueIso = addDaysIso(second.dueAt, scheduled);
    const overdueHard = reviewCard(second, 2, overdueIso);

    expect(overdueHard.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('treats near-due Good reviews as on-time for schedule floor', () => {
    const card = createNewCard('nu-3', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const nearDueIso = new Date(Date.parse(second.dueAt) - 30 * 1000).toISOString();

    const next = reviewCard(second, 3, nearDueIso);

    expect(next.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('treats exactly one-minute-early Good reviews as on-time for schedule floor', () => {
    const card = createNewCard('nu-3b', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;
    const second = reviewCard(first, 4, '2026-02-26T12:00:00.000Z').card;
    const scheduled = Math.round(
      (Date.parse(second.dueAt) - Date.parse(second.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const oneMinuteEarlyIso = new Date(Date.parse(second.dueAt) - 60 * 1000).toISOString();

    const next = reviewCard(second, 3, oneMinuteEarlyIso);

    expect(next.scheduledDays).toBeGreaterThanOrEqual(scheduled);
  });

  it('does not inflate slightly-drifted one-day schedules to two days on on-time good reviews', () => {
    const reviewCardWithDrift = {
      ...createNewCard('nu-drift-good', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 1 + 5 / 1440),
      stability: 0.1,
      difficulty: 8.8,
      reps: 16,
      lapses: 2,
    };

    const reviewed = reviewCard(reviewCardWithDrift, 3, reviewCardWithDrift.dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBe(1);
  });

  it('keeps near-one-day schedule drift from dropping to half-day on on-time good reviews', () => {
    const nearDayScheduleDays = 1 - 30 / (24 * 60 * 60);
    const dueAt = addDaysIso(NOW, nearDayScheduleDays);
    const card = {
      ...createNewCard('nu-near-day-good', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt,
      stability: 0.4,
      difficulty: 8.8,
      reps: 16,
      lapses: 2,
    };

    const reviewed = reviewCard(card, 3, dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('keeps near-one-day schedule drift from dropping to half-day on on-time hard reviews', () => {
    const nearDayScheduleDays = 1 - 30 / (24 * 60 * 60);
    const dueAt = addDaysIso(NOW, nearDayScheduleDays);
    const card = {
      ...createNewCard('nu-near-day-hard', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt,
      stability: 0.4,
      difficulty: 8.8,
      reps: 16,
      lapses: 2,
    };

    const reviewed = reviewCard(card, 2, dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('keeps difficulty within bounds', () => {
    let card = createNewCard('gamma', 'third letter', NOW);

    for (let i = 0; i < 30; i += 1) {
      card = reviewCard(card, 1, `2026-03-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`).card;
    }

    expect(card.difficulty).toBeLessThanOrEqual(10);
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
  });

  it('keeps review intervals ordered by rating on the same day', () => {
    const card = createNewCard('omicron', 'letter', NOW);
    const base = reviewCard(card, 4, NOW).card;
    const reviewTime = '2026-02-26T12:00:00.000Z';
    const hard = reviewCard(base, 2, reviewTime);
    const good = reviewCard(base, 3, reviewTime);
    const easy = reviewCard(base, 4, reviewTime);

    expect(hard.card.state).toBe('review');
    expect(good.card.state).toBe('review');
    expect(easy.card.state).toBe('review');
    expect(hard.scheduledDays).toBeLessThanOrEqual(good.scheduledDays);
    expect(good.scheduledDays).toBeLessThanOrEqual(easy.scheduledDays);
  });

  it('keeps review intervals ordered by rating when overdue', () => {
    const card = createNewCard('omicron-overdue', 'letter', NOW);
    const base = reviewCard(card, 4, NOW).card;
    const reviewTime = '2026-03-01T12:00:00.000Z';
    const hard = reviewCard(base, 2, reviewTime);
    const good = reviewCard(base, 3, reviewTime);
    const easy = reviewCard(base, 4, reviewTime);

    expect(hard.scheduledDays).toBeLessThanOrEqual(good.scheduledDays);
    expect(good.scheduledDays).toBeLessThanOrEqual(easy.scheduledDays);
  });

  it('keeps overdue review intervals strictly increasing from Hard to Good to Easy on mature cards', () => {
    const mature = {
      ...createNewCard('omicron-overdue-mature', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 10),
      stability: 45,
      difficulty: 6,
      reps: 40,
      lapses: 2,
    };
    const overdueIso = addDaysIso(mature.dueAt, 20);
    const hard = reviewCard(mature, 2, overdueIso);
    const good = reviewCard(mature, 3, overdueIso);
    const easy = reviewCard(mature, 4, overdueIso);

    expect(hard.scheduledDays).toBeLessThan(good.scheduledDays);
    expect(good.scheduledDays).toBeLessThan(easy.scheduledDays);
  });

  it('keeps review intervals ordered by rating on very early reviews', () => {
    const card = createNewCard('omicron-early', 'letter', NOW);
    const base = reviewCard(card, 4, NOW).card;
    const earlyIso = '2026-02-23T18:00:00.000Z';
    const hard = reviewCard(base, 2, earlyIso);
    const good = reviewCard(base, 3, earlyIso);
    const easy = reviewCard(base, 4, earlyIso);

    expect(hard.scheduledDays).toBeLessThanOrEqual(good.scheduledDays);
    expect(good.scheduledDays).toBeLessThanOrEqual(easy.scheduledDays);
  });

  it('uses card updatedAt when review timestamp is invalid', () => {
    const card = createNewCard('pi', 'letter', NOW);
    const result = reviewCard(card, 3, 'invalid-iso-value');

    expect(result.card.updatedAt).toBe(card.updatedAt);
    expect(result.card.dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('falls back to wall clock when invalid runtime timestamp meets pathologically old updatedAt', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      const oldTimeline = {
        ...createNewCard('pi-old-updated-at', 'letter', NOW),
        state: 'review' as const,
        createdAt: '1999-01-01T00:00:00.000Z',
        updatedAt: '1999-01-02T00:00:00.000Z',
        dueAt: '1999-01-03T00:00:00.000Z',
        stability: 3,
        difficulty: 5,
      };

      const reviewed = reviewCard(oldTimeline, 3, 'invalid-iso-value');

      expect(reviewed.card.updatedAt).toBe('2026-02-23T12:00:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
      expect(reviewed.card.state).toBe('review');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps review timestamps monotonic when request time is older than updatedAt', () => {
    const card = createNewCard('sigma', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2026-02-24T11:59:00.000Z');

    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
    expect(skewed.card.dueAt).toBe('2026-02-26T12:00:00.000Z');
  });

  it('does not roll back updatedAt on large backward clock jumps for healthy timelines', () => {
    const card = createNewCard('sigma-large-skew', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2026-02-22T00:00:00.000Z');

    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
    expect(Date.parse(skewed.card.dueAt)).toBeGreaterThan(Date.parse(skewed.card.updatedAt));
    expect(skewed.card.state).toBe('review');
  });

  it('does not rewrite createdAt on large backward clock jumps for healthy timelines', () => {
    const card = createNewCard('sigma-created-stable', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2026-02-22T00:00:00.000Z');

    expect(skewed.card.createdAt).toBe(graduated.createdAt);
    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
  });

  it('keeps createdAt stable when clock jumps backward before the card timeline', () => {
    const card = {
      ...createNewCard('sigma-created-stable-2', 'letter', NOW),
      state: 'review' as const,
      createdAt: '2026-02-15T12:00:00.000Z',
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-25T12:00:00.000Z',
      stability: 4,
      difficulty: 5,
      reps: 8,
      lapses: 1,
    };

    const skewed = reviewCard(card, 3, '2026-02-10T12:00:00.000Z');

    expect(skewed.card.createdAt).toBe('2026-02-15T12:00:00.000Z');
    expect(skewed.card.updatedAt).toBe('2026-02-24T12:00:00.000Z');
  });

  it('ignores pathological future runtime clocks when timeline is healthy', () => {
    const card = createNewCard('sigma-future-now', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2099-01-01T00:00:00.000Z');

    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
    expect(skewed.card.state).toBe('review');
    expect(Date.parse(skewed.card.dueAt)).toBeGreaterThan(Date.parse(skewed.card.updatedAt));
  });

  it('keeps slight future updatedAt drift monotonic when under skew threshold', () => {
    const nearFutureUpdatedAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const card = {
      ...createNewCard('sigma-small-future', 'letter', NOW),
      state: 'review' as const,
      createdAt: NOW,
      updatedAt: nearFutureUpdatedAt,
      dueAt: addDaysIso(nearFutureUpdatedAt, 1),
    };

    const reviewed = reviewCard(card, 3, 'invalid-runtime-clock');

    expect(reviewed.card.updatedAt).toBe(nearFutureUpdatedAt);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.state).toBe('review');
  });

  it('falls back to wall clock when both updatedAt and runtime clock are pathologically future', () => {
    const card = createNewCard('sigma-double-future', 'letter', NOW);
    const corrupted = {
      ...reviewCard(card, 4, NOW).card,
      updatedAt: '2030-01-01T00:00:00.000Z',
      dueAt: '2030-01-02T00:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, '2099-01-01T00:00:00.000Z');

    expect(Date.parse(reviewed.card.updatedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(reviewed.card.updatedAt)).toBeGreaterThanOrEqual(Date.parse('2025-01-01T00:00:00.000Z'));
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.state).toBe('review');
  });

  it('recovers from pathological future updatedAt timestamps when skew is very large', () => {
    const card = createNewCard('sigma-future', 'letter', NOW);
    const corrupted = {
      ...reviewCard(card, 4, NOW).card,
      updatedAt: '2030-01-01T00:00:00.000Z',
      dueAt: '2030-01-02T00:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-26T12:00:00.000Z');

    expect(reviewed.card.updatedAt).toBe('2026-02-26T12:00:00.000Z');
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.state).toBe('review');
  });

  it('uses wall clock when recovering from future timestamps with a pathologically stale requested review time', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-24T12:00:00.000Z'));
      const card = createNewCard('sigma-future-stale-request', 'letter', NOW);
      const corrupted = {
        ...reviewCard(card, 4, NOW).card,
        updatedAt: '2030-01-01T00:00:00.000Z',
        dueAt: '2030-01-02T00:00:00.000Z',
        state: 'review' as const,
      };

      const reviewed = reviewCard(corrupted, 3, '2024-01-01T00:00:00.000Z');

      expect(reviewed.card.updatedAt).toBe('2026-02-24T12:00:00.000Z');
      expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
      expect(reviewed.card.state).toBe('review');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses wall clock fallback when runtime clock is invalid and updatedAt is pathologically future', () => {
    const card = createNewCard('sigma-future-invalid-now', 'letter', NOW);
    const corrupted = {
      ...reviewCard(card, 4, NOW).card,
      updatedAt: '2030-01-01T00:00:00.000Z',
      dueAt: '2030-01-02T00:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, 'not-a-time');

    expect(Date.parse(reviewed.card.updatedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(reviewed.card.updatedAt)).toBeGreaterThanOrEqual(Date.parse('2025-01-01T00:00:00.000Z'));
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.state).toBe('review');
  });

  it('repairs collapsed review due dates using stability rather than half-day fallback', () => {
    const mature = {
      ...createNewCard('rho-collapsed-due', 'letter', NOW),
      state: 'review' as const,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T12:00:00.000Z',
      stability: 3,
      difficulty: 5,
      reps: 18,
      lapses: 2,
    };

    const hard = reviewCard(mature, 2, mature.updatedAt);
    const good = reviewCard(mature, 3, mature.updatedAt);

    expect(hard.card.state).toBe('review');
    expect(good.card.state).toBe('review');
    expect(hard.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(good.scheduledDays).toBeGreaterThanOrEqual(2);
  });

  it('does not pin review time to slightly-future createdAt when updatedAt is current', () => {
    const card = {
      ...createNewCard('created-at-skew', 'letter', NOW),
      createdAt: '2026-02-23T18:00:00.000Z',
      updatedAt: NOW,
      dueAt: NOW,
      state: 'review' as const,
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.updatedAt).toBe(NOW);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.state).toBe('review');
  });

  it('recovers corrupted review due timestamps that are not after updatedAt', () => {
    const card = {
      ...createNewCard('due-anchor-repair', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: NOW,
      stability: 12,
      difficulty: 5,
      reps: 20,
      lapses: 2,
    };

    const reviewed = reviewCard(card, 2, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThan(1);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('repairs invalid review due timestamps to a conservative half-day review floor', () => {
    const card = {
      ...createNewCard('due-anchor-invalid-review', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: 'not-a-time',
      stability: 120,
      difficulty: 5,
      reps: 20,
      lapses: 2,
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
    expect(reviewed.scheduledDays).toBeLessThanOrEqual(2);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('treats far-future review due timestamps as outliers and repairs them toward stability windows', () => {
    const reviewAt = addDaysIso(NOW, 4);
    const baseline = {
      ...createNewCard('review-due-baseline', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 5),
      stability: 5,
      difficulty: 5,
      reps: 18,
      lapses: 1,
    };
    const outlier = {
      ...baseline,
      dueAt: addDaysIso(NOW, STABILITY_MAX * 2),
    };

    const baselineReviewed = reviewCard(baseline, 3, reviewAt);
    const outlierReviewed = reviewCard(outlier, 3, reviewAt);

    expect(outlierReviewed.card.state).toBe('review');
    expect(outlierReviewed.scheduledDays).toBeCloseTo(baselineReviewed.scheduledDays, 6);
    expect(Date.parse(outlierReviewed.card.dueAt)).toBeGreaterThan(Date.parse(outlierReviewed.card.updatedAt));
  });

  it('keeps dueAt finite when timeline anchor parsing unexpectedly fails', () => {
    const card = {
      ...createNewCard('due-anchor-parse-fallback', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: NOW,
      stability: 8,
      difficulty: 5,
      reps: 10,
      lapses: 1,
    };
    const repairAnchor = addDaysIso(NOW, 0.5);
    const nativeParse = Date.parse.bind(Date);
    const parseSpy = jest.spyOn(Date, 'parse').mockImplementation((value: string) => {
      if (value === repairAnchor) {
        return Number.NaN;
      }
      return nativeParse(value);
    });

    const reviewed = reviewCard(card, 3, NOW);
    parseSpy.mockRestore();

    expect(Number.isFinite(Date.parse(reviewed.card.dueAt))).toBe(true);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('repairs corrupted learning due timestamps that are not after updatedAt', () => {
    const card = {
      ...createNewCard('due-anchor-learning-repair', 'letter', NOW),
      state: 'learning' as const,
      updatedAt: NOW,
      dueAt: NOW,
    };

    const reviewed = reviewCard(card, 1, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.scheduledDays).toBeCloseTo(1 / 1440, 8);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('repairs corrupted relearning due timestamps that are not after updatedAt', () => {
    const card = {
      ...createNewCard('due-anchor-relearning-repair', 'letter', NOW),
      state: 'relearning' as const,
      updatedAt: NOW,
      dueAt: NOW,
      stability: 8,
      difficulty: 5,
      reps: 8,
      lapses: 1,
    };

    const reviewed = reviewCard(card, 1, NOW);

    expect(reviewed.card.state).toBe('relearning');
    expect(reviewed.scheduledDays).toBeCloseTo(10 / 1440, 8);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('falls back to the current clock for invalid create timestamps', () => {
    const card = createNewCard('tau', 'letter', 'bad-timestamp');

    expect(Number.isFinite(Date.parse(card.createdAt))).toBe(true);
    expect(card.updatedAt).toBe(card.createdAt);
    expect(card.dueAt).toBe(card.createdAt);
  });

  it('keeps card creation resilient when wall-clock ISO parsing is unexpectedly invalid', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    const nativeParse = Date.parse.bind(Date);
    const parseSpy = jest.spyOn(Date, 'parse').mockImplementation((value: string) => {
      if (value === '2026-02-24T00:00:00.000Z') {
        return Number.NaN;
      }
      return nativeParse(value);
    });
    try {
      const card = createNewCard('tau-parse-fallback', 'letter', '2026-02-23T12:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T12:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      parseSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('ignores pathological future create timestamps and falls back to wall clock time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    try {
      const card = createNewCard('tau-future-clamp', 'letter', '2099-01-01T00:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-24T00:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores pathological past create timestamps and falls back to wall clock time', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    try {
      const card = createNewCard('tau-past-clamp', 'letter', '2000-01-01T00:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-24T00:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps minor future create timestamps that are within allowed clock skew', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    try {
      const card = createNewCard('tau-future-small', 'letter', '2026-02-24T06:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-24T06:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps minor past create timestamps that are within allowed clock skew', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    try {
      const card = createNewCard('tau-past-small', 'letter', '2026-02-23T18:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-23T18:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps realistic multi-year historical create timestamps for imports', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    try {
      const card = createNewCard('tau-history-import', 'letter', '2012-07-01T00:00:00.000Z');

      expect(card.createdAt).toBe('2012-07-01T00:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps create timestamps exactly at the allowed backward skew boundary', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T12:00:00.000Z'));
    try {
      const card = createNewCard('tau-past-boundary', 'letter', '2026-02-24T00:00:00.000Z');

      expect(card.createdAt).toBe('2026-02-24T00:00:00.000Z');
      expect(card.updatedAt).toBe(card.createdAt);
      expect(card.dueAt).toBe(card.createdAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('normalizes valid create timestamps into canonical ISO format', () => {
    const card = createNewCard('tau-canonical', 'letter', '2026-02-23T12:00:00Z');

    expect(card.createdAt).toBe('2026-02-23T12:00:00.000Z');
    expect(card.updatedAt).toBe(card.createdAt);
    expect(card.dueAt).toBe(card.createdAt);
  });

  it('normalizes valid review timestamps into canonical ISO format', () => {
    const card = {
      ...createNewCard('tau-review-canonical', 'letter', NOW),
      state: 'review' as const,
      dueAt: NOW,
    };

    const reviewed = reviewCard(card, 3, '2026-02-23T12:00:00Z');

    expect(reviewed.card.updatedAt).toBe('2026-02-23T12:00:00.000Z');
  });

  it('clamps invalid stability and difficulty inputs before review math', () => {
    const base = createNewCard('rho', 'letter', NOW);
    const card = { ...base, state: 'review' as const, stability: 999999, difficulty: -20 };
    const reviewed = reviewCard(card, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.card.stability).toBeLessThanOrEqual(36500);
    expect(reviewed.card.stability).toBeGreaterThanOrEqual(0.1);
    expect(reviewed.card.difficulty).toBeGreaterThanOrEqual(1);
    expect(reviewed.card.difficulty).toBeLessThanOrEqual(10);
  });

  it('uses finite fallbacks when stability and difficulty are non-finite', () => {
    const base = createNewCard('rho-2', 'letter', NOW);
    const corrupted = {
      ...base,
      state: 'review' as const,
      stability: Number.NaN,
      difficulty: Number.POSITIVE_INFINITY,
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(Number.isFinite(reviewed.card.stability)).toBe(true);
    expect(Number.isFinite(reviewed.card.difficulty)).toBe(true);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('treats infinite review stability as long schedule context instead of half-day fallback context', () => {
    const base = {
      ...createNewCard('rho-inf-schedule-context', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: 'bad-due-value',
      difficulty: 5,
      reps: 22,
      lapses: 2,
    };
    const infiniteStability = reviewCard({ ...base, stability: Number.POSITIVE_INFINITY }, 3, NOW);
    const unknownStability = reviewCard({ ...base, stability: Number.NaN }, 3, NOW);

    expect(infiniteStability.card.state).toBe('review');
    expect(unknownStability.card.state).toBe('review');
    expect(infiniteStability.scheduledDays).toBeGreaterThan(unknownStability.scheduledDays);
  });

  it('uses the scheduled interval as fallback context when review stability is corrupted', () => {
    const mature = {
      ...createNewCard('rho-stability-fallback', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 20),
      stability: Number.NaN,
      difficulty: 5,
      reps: 35,
      lapses: 2,
    };
    const earlyIso = addDaysIso(NOW, 4);
    const reviewed = reviewCard(mature, 3, earlyIso);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(10);
  });

  it('keeps stability finite when numeric operations return non-finite values', () => {
    const powSpy = jest.spyOn(Math, 'pow').mockReturnValue(Number.NaN);
    const base = reviewCard(createNewCard('rho-nan-math', 'letter', NOW), 4, NOW).card;
    const reviewed = reviewCard(base, 3, '2026-02-25T12:00:00.000Z');
    powSpy.mockRestore();

    expect(Number.isFinite(reviewed.card.stability)).toBe(true);
    expect(reviewed.card.stability).toBeGreaterThanOrEqual(0.1);
    expect(reviewed.card.stability).toBeLessThanOrEqual(STABILITY_MAX);
  });

  it('preserves on-time review schedule when interval math becomes non-finite', () => {
    const powSpy = jest.spyOn(Math, 'pow').mockReturnValue(Number.NaN);
    const mature = {
      ...createNewCard('rho-nan-interval', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 12),
      stability: 32,
      difficulty: 5.5,
      reps: 35,
      lapses: 2,
    };
    const reviewed = reviewCard(mature, 3, mature.dueAt);
    powSpy.mockRestore();

    expect(Number.isFinite(reviewed.scheduledDays)).toBe(true);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(12);
  });

  it('treats out-of-range runtime rating values as Again during learning', () => {
    const base = createNewCard('eta', 'letter', NOW);
    const reviewed = reviewCard(base, 9 as unknown as Rating, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.scheduledDays).toBeLessThan(0.002);
  });

  it('treats runtime fractional rating values as Again during learning', () => {
    const base = createNewCard('eta-2', 'letter', NOW);
    const fractionalHard = reviewCard(base, 1.6 as unknown as Rating, NOW);
    const fractionalGood = reviewCard(base, 2.6 as unknown as Rating, NOW);

    expect(fractionalHard.card.state).toBe('learning');
    expect(fractionalHard.scheduledDays).toBeLessThan(0.002);
    expect(fractionalGood.card.state).toBe('learning');
    expect(fractionalGood.scheduledDays).toBeLessThan(0.002);
  });

  it('coerces numeric-string runtime ratings during learning', () => {
    const base = createNewCard('eta-string-learning', 'letter', NOW);
    const easy = reviewCard(base, '4' as unknown as Rating, NOW);

    expect(easy.card.state).toBe('review');
    expect(easy.scheduledDays).toBe(1);
  });

  it('coerces numeric-string runtime ratings during review', () => {
    const base = createNewCard('eta-string-review', 'letter', NOW);
    const graduated = reviewCard(base, 4, NOW).card;
    const reviewed = reviewCard(graduated, '2' as unknown as Rating, graduated.dueAt);
    const neutral = reviewCard(graduated, 3, graduated.dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeLessThanOrEqual(neutral.scheduledDays);
  });

  it('treats non-finite runtime ratings as Again to avoid accidental promotion', () => {
    const base = createNewCard('eta-3', 'letter', NOW);
    const reviewed = reviewCard(base, Number.NaN as unknown as Rating, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.scheduledDays).toBeLessThan(0.002);
  });

  it('treats non-finite runtime ratings as Again while relearning', () => {
    const base = createNewCard('eta-3-relearning', 'letter', NOW);
    const graduated = reviewCard(base, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;

    const reviewed = reviewCard(failed, Number.NaN as unknown as Rating, '2026-02-24T12:10:00.000Z');

    expect(reviewed.card.state).toBe('relearning');
    expect(reviewed.card.lapses).toBe(failed.lapses);
    expect(reviewed.scheduledDays).toBeCloseTo(10 / 1440, 8);
  });

  it('normalizes non-finite counters during review updates', () => {
    const base = createNewCard('theta-2', 'letter', NOW);
    const corrupted = {
      ...reviewCard(base, 4, NOW).card,
      reps: -4,
      lapses: Number.NaN,
    };
    const reviewed = reviewCard(corrupted, 1, '2026-02-24T12:00:00.000Z');

    expect(reviewed.card.reps).toBe(1);
    expect(reviewed.card.lapses).toBe(1);
  });

  it('saturates extremely large counters at Number.MAX_SAFE_INTEGER', () => {
    const base = createNewCard('theta-counter-cap', 'letter', NOW);
    const corrupted = {
      ...reviewCard(base, 4, NOW).card,
      reps: Number.MAX_SAFE_INTEGER,
      lapses: Number.MAX_SAFE_INTEGER,
    };
    const reviewed = reviewCard(corrupted, 1, '2026-02-24T12:00:00.000Z');

    expect(reviewed.card.reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(reviewed.card.lapses).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('saturates positive infinite counters instead of resetting review history', () => {
    const base = createNewCard('theta-counter-inf', 'letter', NOW);
    const corrupted = {
      ...reviewCard(base, 4, NOW).card,
      reps: Number.POSITIVE_INFINITY,
      lapses: Number.POSITIVE_INFINITY,
    };
    const reviewed = reviewCard(corrupted, 1, '2026-02-24T12:00:00.000Z');

    expect(reviewed.card.reps).toBe(Number.MAX_SAFE_INTEGER);
    expect(reviewed.card.lapses).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('does not double-count lapses while repeating relearning Again steps', () => {
    const card = createNewCard('lapse-step', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failedReview = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const failedRelearning = reviewCard(failedReview, 1, '2026-02-24T12:10:00.000Z').card;

    expect(failedReview.lapses).toBe(1);
    expect(failedRelearning.lapses).toBe(1);
  });

  it('keeps difficulty stable on relearning Again retries', () => {
    const card = createNewCard('relearn-difficulty', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failedReview = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const relearningRetry = reviewCard(failedReview, 1, '2026-02-24T12:10:00.000Z').card;

    expect(relearningRetry.state).toBe('relearning');
    expect(relearningRetry.difficulty).toBeCloseTo(failedReview.difficulty, 6);
  });

  it('keeps difficulty stable on learning Hard retries', () => {
    const card = createNewCard('learning-hard-difficulty', 'letter', NOW);
    const firstHard = reviewCard(card, 2, NOW).card;
    const secondHard = reviewCard(firstHard, 2, '2026-02-23T12:05:00.000Z').card;

    expect(firstHard.state).toBe('learning');
    expect(secondHard.state).toBe('learning');
    expect(secondHard.difficulty).toBeCloseTo(card.difficulty, 6);
  });

  it('keeps difficulty stable on relearning Hard retries', () => {
    const card = createNewCard('relearning-hard-difficulty', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failedReview = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const relearningHard = reviewCard(failedReview, 2, '2026-02-24T12:10:00.000Z').card;

    expect(relearningHard.state).toBe('relearning');
    expect(relearningHard.difficulty).toBeCloseTo(failedReview.difficulty, 6);
  });

  it('keeps stability flat across repeated relearning Hard retries', () => {
    const card = createNewCard('relearning-hard-stability-flat', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failedReview = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const firstHard = reviewCard(failedReview, 2, '2026-02-24T12:10:00.000Z').card;
    const secondHard = reviewCard(firstHard, 2, '2026-02-24T12:25:00.000Z').card;

    expect(firstHard.state).toBe('relearning');
    expect(secondHard.state).toBe('relearning');
    expect(secondHard.stability).toBeCloseTo(firstHard.stability, 6);
  });

  it('does not inflate relearning graduation intervals after repeated Hard retries', () => {
    const card = createNewCard('relearning-hard-graduation-control', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failedReview = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const hardOnce = reviewCard(failedReview, 2, '2026-02-24T12:10:00.000Z').card;
    const hardTwice = reviewCard(hardOnce, 2, '2026-02-24T12:25:00.000Z').card;
    const graduateAfterOneHard = reviewCard(hardOnce, 3, '2026-02-24T12:40:00.000Z');
    const graduateAfterTwoHards = reviewCard(hardTwice, 3, '2026-02-24T12:40:00.000Z');

    expect(graduateAfterOneHard.card.state).toBe('review');
    expect(graduateAfterTwoHards.card.state).toBe('review');
    expect(graduateAfterTwoHards.scheduledDays).toBeLessThanOrEqual(graduateAfterOneHard.scheduledDays);
  });

  it('falls back to learning behavior when runtime state is corrupted', () => {
    const base = createNewCard('iota-2', 'letter', NOW);
    const corrupted = {
      ...base,
      state: 'broken' as unknown as typeof base.state,
    };
    const reviewed = reviewCard(corrupted, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBe(0.5);
  });

  it('uses a half-day schedule floor for corrupted review cards', () => {
    const base = createNewCard('upsilon', 'letter', NOW);
    const graduated = reviewCard(base, 4, NOW).card;
    const corrupted = {
      ...graduated,
      state: 'review' as const,
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-24T12:00:00.000Z',
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
    expect(reviewed.card.state).toBe('review');
  });

  it('uses valid sub-day review schedules instead of inflating them to one day', () => {
    const card = createNewCard('upsilon-subday', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const inflatedSchedule = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, 1),
    };

    const validOnTime = reviewCard(graduated, 3, graduated.dueAt);
    const inflatedEarly = reviewCard(inflatedSchedule, 3, graduated.dueAt);

    expect(validOnTime.card.stability).toBeGreaterThan(inflatedEarly.card.stability);
    expect(validOnTime.card.stability - inflatedEarly.card.stability).toBeGreaterThan(1e-4);
    expect(validOnTime.scheduledDays).toBeGreaterThanOrEqual(inflatedEarly.scheduledDays);
  });

  it('treats corrupted minute-scale review schedules with a half-day review floor', () => {
    const card = createNewCard('review-floor', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const reviewAt = addDaysIso(graduated.updatedAt, 0.25);
    const normalized = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, 0.5),
    };
    const corrupted = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, 10 / 1440),
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const corruptedReview = reviewCard(corrupted, 3, reviewAt);

    expect(corruptedReview.scheduledDays).toBeLessThanOrEqual(normalizedReview.scheduledDays);
    expect(corruptedReview.card.stability).toBeLessThanOrEqual(normalizedReview.card.stability);
  });

  it('repairs minute-scale review schedules using review stability context before interval math', () => {
    const reviewAt = NOW;
    const normalized = {
      ...createNewCard('review-subfloor-normalized', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 2),
      stability: 2,
      difficulty: 5,
      reps: 12,
      lapses: 1,
    };
    const corrupted = {
      ...normalized,
      dueAt: addDaysIso(NOW, 10 / 1440),
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const corruptedReview = reviewCard(corrupted, 3, reviewAt);

    expect(corruptedReview.card.state).toBe('review');
    expect(corruptedReview.scheduledDays).toBeCloseTo(normalizedReview.scheduledDays, 6);
  });

  it('treats zero-length review schedules like the half-day review floor', () => {
    const card = createNewCard('review-zero-floor', 'letter', NOW);
    const graduated = reviewCard(card, 3, NOW).card;
    const reviewAt = addDaysIso(graduated.updatedAt, 0.25);
    const normalized = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, 0.5),
    };
    const zeroLength = {
      ...graduated,
      dueAt: graduated.updatedAt,
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const zeroLengthReview = reviewCard(zeroLength, 3, reviewAt);

    expect(zeroLengthReview.card.stability).toBeCloseTo(normalizedReview.card.stability, 6);
    expect(zeroLengthReview.scheduledDays).toBe(normalizedReview.scheduledDays);
  });

  it('uses safe timeline fallbacks when card timestamps are corrupted', () => {
    const base = createNewCard('phi', 'letter', NOW);
    const corrupted = {
      ...base,
      updatedAt: 'bad-time',
      dueAt: 'also-bad-time',
    };
    const reviewed = reviewCard(corrupted, 2, '2026-02-23T12:00:00.000Z');

    expect(reviewed.card.updatedAt).toBe('2026-02-23T12:00:00.000Z');
    expect(reviewed.card.dueAt).toBe('2026-02-23T12:10:00.000Z');
    expect(reviewed.card.state).toBe('learning');
  });

  it('normalizes invalid createdAt and enforces updatedAt/dueAt ordering at review time', () => {
    const base = createNewCard('phi-2', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: 'bad-created-at',
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-20T12:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.card.updatedAt).toBe('2026-02-25T12:00:00.000Z');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThanOrEqual(Date.parse(reviewed.card.updatedAt));
  });

  it('normalizes createdAt to canonical ISO format during review timeline repair', () => {
    const base = createNewCard('phi-canonical-created', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: '2026-02-23T12:00:00Z',
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-25T12:00:00.000Z',
      state: 'review' as const,
    };

    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.card.createdAt).toBe('2026-02-23T12:00:00.000Z');
  });

  it('keeps createdAt at or before updatedAt when createdAt drifts slightly into the future', () => {
    const base = createNewCard('phi-created-future-clamp', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: '2026-02-23T13:00:00.000Z',
      updatedAt: NOW,
      dueAt: NOW,
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, NOW);

    expect(Date.parse(reviewed.card.createdAt)).toBeLessThanOrEqual(Date.parse(reviewed.card.updatedAt));
    expect(reviewed.card.createdAt).toBe(reviewed.card.updatedAt);
  });

  it('repairs invalid createdAt using the active review timeline', () => {
    const base = createNewCard('created-at-fix', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: 'bad-created-at',
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-24T12:10:00.000Z',
      state: 'review' as const,
    };

    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.card.createdAt).toBe('2026-02-24T12:00:00.000Z');
    expect(Number.isFinite(Date.parse(reviewed.card.createdAt))).toBe(true);
  });

  it('uses updatedAt as timeline anchor when createdAt and runtime clock are invalid', () => {
    const base = createNewCard('phi-3', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: 'bad-created-at',
      updatedAt: '2026-02-20T12:00:00.000Z',
      dueAt: '2026-02-21T12:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, 'not-a-time');

    expect(reviewed.card.updatedAt).toBe('2026-02-20T12:00:00.000Z');
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('does not anchor createdAt to far-future dueAt when both createdAt and updatedAt are invalid', () => {
    const base = createNewCard('phi-future-due-anchor', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: 'bad-created-at',
      updatedAt: 'bad-updated-at',
      dueAt: '2099-01-01T00:00:00.000Z',
    };
    const reviewed = reviewCard(corrupted, 3, 'bad-runtime');

    expect(Date.parse(reviewed.card.createdAt)).toBeLessThan(Date.parse('2030-01-01T00:00:00.000Z'));
    expect(reviewed.card.updatedAt).toBe(reviewed.card.createdAt);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('sanitizes far-future createdAt values using the active timeline anchors', () => {
    const base = createNewCard('phi-future-created', 'letter', NOW);
    const corrupted = {
      ...base,
      createdAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-25T12:00:00.000Z',
      state: 'review' as const,
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.card.createdAt).toBe('2026-02-24T12:00:00.000Z');
    expect(reviewed.card.updatedAt).toBe('2026-02-25T12:00:00.000Z');
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('computes ordered interval previews per rating', () => {
    const card = createNewCard('chi', 'letter', NOW);
    const base = reviewCard(card, 4, NOW).card;
    const preview = previewIntervals(base, '2026-02-26T12:00:00.000Z');

    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThanOrEqual(preview[3]);
    expect(preview[3]).toBeLessThanOrEqual(preview[4]);
  });

  it('keeps half-day review preview intervals from inflating to one day', () => {
    const base = createNewCard('chi-halfday-preview', 'letter', NOW);
    const halfDayReviewCard = {
      ...base,
      state: 'review' as const,
      createdAt: NOW,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 0.5),
      stability: 0.1,
      difficulty: 5,
      reps: 8,
      lapses: 0,
    };
    const preview = previewIntervals(halfDayReviewCard, NOW);

    expect(preview[2]).toBe(0.5);
    expect(preview[3]).toBe(0.5);
    expect(preview[4]).toBeGreaterThanOrEqual(0.5);
  });

  it('computes finite preview intervals when runtime clock is invalid', () => {
    const card = createNewCard('chi-invalid-preview', 'letter', NOW);
    const base = {
      ...reviewCard(card, 4, NOW).card,
      updatedAt: 'not-a-time',
    };
    const preview = previewIntervals(base, 'bad-clock');

    expect(Number.isFinite(preview[1])).toBe(true);
    expect(Number.isFinite(preview[2])).toBe(true);
    expect(Number.isFinite(preview[3])).toBe(true);
    expect(Number.isFinite(preview[4])).toBe(true);
    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThanOrEqual(preview[3]);
    expect(preview[3]).toBeLessThanOrEqual(preview[4]);
  });

  it('keeps preview intervals aligned with wall-safe review clocks when preview timestamp is pathologically future', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));
      const card = createNewCard('chi-future-preview', 'letter', NOW);
      const base = reviewCard(card, 4, NOW).card;

      const previewAtWallClock = previewIntervals(base, '2026-02-23T12:00:00.000Z');
      const previewAtFutureClock = previewIntervals(base, '2099-01-01T00:00:00.000Z');

      expect(previewAtFutureClock).toEqual(previewAtWallClock);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps preview intervals ordered for corrupted relearning cards', () => {
    const card = createNewCard('chi-relearning-preview', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const corrupted = {
      ...failed,
      stability: Number.NaN,
      difficulty: Number.POSITIVE_INFINITY,
      dueAt: failed.updatedAt,
    };

    const preview = previewIntervals(corrupted, failed.updatedAt);

    expect(Number.isFinite(preview[1])).toBe(true);
    expect(Number.isFinite(preview[2])).toBe(true);
    expect(Number.isFinite(preview[3])).toBe(true);
    expect(Number.isFinite(preview[4])).toBe(true);
    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThanOrEqual(preview[3]);
    expect(preview[3]).toBeLessThanOrEqual(preview[4]);
  });

  it('keeps preview intervals within scheduler safety bounds for malformed review cards', () => {
    const malformed = {
      ...createNewCard('chi-preview-bounds', 'letter', NOW),
      state: 'review' as const,
      createdAt: 'bad-created',
      updatedAt: 'bad-updated',
      dueAt: 'bad-due',
      stability: Number.NaN,
      difficulty: Number.NaN,
      reps: Number.POSITIVE_INFINITY,
      lapses: Number.POSITIVE_INFINITY,
    };

    const preview = previewIntervals(malformed, 'bad-runtime');

    expect(preview[1]).toBeGreaterThanOrEqual(1 / 1440);
    expect(preview[2]).toBeGreaterThanOrEqual(preview[1]);
    expect(preview[3]).toBeGreaterThanOrEqual(preview[2]);
    expect(preview[4]).toBeGreaterThanOrEqual(preview[3]);
    expect(preview[1]).toBeLessThanOrEqual(STABILITY_MAX);
    expect(preview[2]).toBeLessThanOrEqual(STABILITY_MAX);
    expect(preview[3]).toBeLessThanOrEqual(STABILITY_MAX);
    expect(preview[4]).toBeLessThanOrEqual(STABILITY_MAX);
  });

  it('treats corrupted relearning schedules like the 10-minute relearning floor', () => {
    const card = createNewCard('psi', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;

    const baseTime = Date.parse(failed.updatedAt);
    const reviewAt = new Date(baseTime + 5 * 60 * 1000).toISOString();
    const normalized = {
      ...failed,
      dueAt: new Date(baseTime + 10 * 60 * 1000).toISOString(),
    };
    const corrupted = {
      ...failed,
      dueAt: failed.updatedAt,
    };

    const normalizedReview = reviewCard(normalized, 4, reviewAt);
    const corruptedReview = reviewCard(corrupted, 4, reviewAt);

    expect(corruptedReview.scheduledDays).toBe(normalizedReview.scheduledDays);
    expect(corruptedReview.card.stability).toBeCloseTo(normalizedReview.card.stability, 6);
  });

  it('treats sub-10-minute relearning schedules like the 10-minute relearning floor', () => {
    const card = createNewCard('psi-relearning-minute-floor', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const baseTime = Date.parse(failed.updatedAt);
    const reviewAt = new Date(baseTime + 5 * 60 * 1000).toISOString();
    const normalized = {
      ...failed,
      dueAt: new Date(baseTime + 10 * 60 * 1000).toISOString(),
    };
    const minuteScale = {
      ...failed,
      dueAt: new Date(baseTime + 1 * 60 * 1000).toISOString(),
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const minuteScaleReview = reviewCard(minuteScale, 3, reviewAt);

    expect(minuteScaleReview.scheduledDays).toBe(normalizedReview.scheduledDays);
    expect(minuteScaleReview.card.stability).toBeCloseTo(normalizedReview.card.stability, 6);
  });

  it('treats pathologically-future relearning schedules like the 10-minute relearning floor', () => {
    const card = createNewCard('psi-relearning-future-floor', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;
    const reviewAt = '2026-02-27T12:00:00.000Z';
    const normalized = {
      ...failed,
      dueAt: addDaysIso(failed.updatedAt, 10 / 1440),
    };
    const farFuture = {
      ...failed,
      dueAt: '2099-01-01T00:00:00.000Z',
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const farFutureReview = reviewCard(farFuture, 3, reviewAt);

    expect(farFutureReview.scheduledDays).toBe(normalizedReview.scheduledDays);
    expect(farFutureReview.card.stability).toBeCloseTo(normalizedReview.card.stability, 6);
  });

  it('treats corrupted review schedules like the one-day review floor', () => {
    const card = createNewCard('psi-review-floor', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const reviewAt = addDaysIso(graduated.updatedAt, 0.5);
    const normalized = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, 1),
    };
    const corrupted = {
      ...graduated,
      dueAt: graduated.updatedAt,
    };

    const normalizedReview = reviewCard(normalized, 3, reviewAt);
    const corruptedReview = reviewCard(corrupted, 3, reviewAt);

    expect(corruptedReview.scheduledDays).toBe(normalizedReview.scheduledDays);
    expect(corruptedReview.card.stability).toBeCloseTo(normalizedReview.card.stability, 6);
  });

  it('repairs far-future review schedules that are inconsistent with card stability', () => {
    const baseline = {
      ...createNewCard('psi-review-future-cap', 'letter', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 2),
      stability: 2,
      difficulty: 5.3,
      reps: 22,
      lapses: 2,
    };
    const corrupted = {
      ...baseline,
      dueAt: addDaysIso(NOW, 400),
    };
    const reviewAt = addDaysIso(NOW, 1);

    const baselineReview = reviewCard(baseline, 3, reviewAt);
    const corruptedReview = reviewCard(corrupted, 3, reviewAt);

    expect(corruptedReview.scheduledDays).toBe(baselineReview.scheduledDays);
    expect(corruptedReview.card.stability).toBeCloseTo(baselineReview.card.stability, 6);
    expect(corruptedReview.card.state).toBe('review');
  });

  it('keeps review interval finite when runtime schedule values are non-finite', () => {
    const base = createNewCard('upsilon-2', 'letter', NOW);
    const corrupted = {
      ...reviewCard(base, 4, NOW).card,
      stability: Number.NaN,
      difficulty: Number.NaN,
      dueAt: 'bad-time',
    };
    const reviewed = reviewCard(corrupted, 4, '2026-02-26T12:00:00.000Z');

    expect(Number.isFinite(reviewed.scheduledDays)).toBe(true);
    expect(Number.isFinite(reviewed.card.stability)).toBe(true);
    expect(Number.isFinite(reviewed.card.difficulty)).toBe(true);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('recovers invalid review dueAt using stability-derived schedule fallback', () => {
    const updatedAt = NOW;
    const valid = {
      ...createNewCard('invalid-due-recovery-valid', 'letter', NOW),
      state: 'review' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 6),
      reps: 12,
      lapses: 2,
      stability: 6,
      difficulty: 5,
    };
    const invalid = {
      ...valid,
      id: 'invalid-due-recovery',
      dueAt: 'bad-time',
    };
    const reviewAt = addDaysIso(updatedAt, 6);

    const validReview = reviewCard(valid, 3, reviewAt);
    const invalidReview = reviewCard(invalid, 3, reviewAt);

    expect(invalidReview.card.state).toBe('review');
    expect(invalidReview.card.updatedAt).toBe(validReview.card.updatedAt);
    expect(invalidReview.card.stability).toBeCloseTo(validReview.card.stability, 6);
    expect(invalidReview.scheduledDays).toBe(validReview.scheduledDays);
  });

  it('uses stability-derived fallback for missing review dueAt when expected schedule is moderate', () => {
    const updatedAt = NOW;
    const valid = {
      ...createNewCard('missing-due-recovery-valid', 'letter', NOW),
      state: 'review' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 4),
      reps: 9,
      lapses: 1,
      stability: 4,
      difficulty: 5.2,
    };
    const missingDue = {
      ...valid,
      id: 'missing-due-recovery',
      dueAt: undefined as unknown as string,
    };
    const reviewAt = addDaysIso(updatedAt, 4);

    const validReview = reviewCard(valid, 3, reviewAt);
    const missingReview = reviewCard(missingDue, 3, reviewAt);

    expect(missingReview.card.state).toBe('review');
    expect(missingReview.card.updatedAt).toBe(validReview.card.updatedAt);
    expect(missingReview.card.stability).toBeCloseTo(validReview.card.stability, 6);
    expect(missingReview.scheduledDays).toBe(validReview.scheduledDays);
  });

  it('caps missing mature review dueAt fallback to a conservative week-long schedule anchor', () => {
    const updatedAt = NOW;
    const valid = {
      ...createNewCard('missing-due-mature-valid', 'letter', NOW),
      state: 'review' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 7),
      reps: 30,
      lapses: 3,
      stability: 120,
      difficulty: 5,
    };
    const missingDue = {
      ...valid,
      id: 'missing-due-mature',
      dueAt: undefined as unknown as string,
    };
    const reviewAt = addDaysIso(updatedAt, 7);

    const validReview = reviewCard(valid, 3, reviewAt);
    const missingReview = reviewCard(missingDue, 3, reviewAt);

    expect(missingReview.card.state).toBe('review');
    expect(missingReview.card.updatedAt).toBe(validReview.card.updatedAt);
    expect(missingReview.card.stability).toBeCloseTo(validReview.card.stability, 6);
    expect(missingReview.scheduledDays).toBe(validReview.scheduledDays);
  });

  it('caps malformed mature review dueAt fallback to a conservative week-long schedule anchor', () => {
    const updatedAt = NOW;
    const valid = {
      ...createNewCard('malformed-due-mature-valid', 'letter', NOW),
      state: 'review' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 7),
      reps: 30,
      lapses: 3,
      stability: 120,
      difficulty: 5,
    };
    const malformedDue = {
      ...valid,
      id: 'malformed-due-mature',
      dueAt: 'bad-time',
    };
    const reviewAt = addDaysIso(updatedAt, 7);

    const validReview = reviewCard(valid, 3, reviewAt);
    const malformedReview = reviewCard(malformedDue, 3, reviewAt);

    expect(malformedReview.card.state).toBe('review');
    expect(malformedReview.card.updatedAt).toBe(validReview.card.updatedAt);
    expect(malformedReview.card.stability).toBeCloseTo(validReview.card.stability, 6);
    expect(malformedReview.scheduledDays).toBe(validReview.scheduledDays);
  });

  it('repairs outlier review dueAt values using a conservative short anchor even for mature stability cards', () => {
    const updatedAt = NOW;
    const conservative = {
      ...createNewCard('outlier-due-valid', 'letter', NOW),
      state: 'review' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 7),
      reps: 40,
      lapses: 4,
      stability: 5000,
      difficulty: 5,
    };
    const outlierDue = {
      ...conservative,
      id: 'outlier-due-invalid',
      dueAt: addDaysIso(updatedAt, 32000),
    };
    const reviewAt = addDaysIso(updatedAt, 7);

    const conservativeReview = reviewCard(conservative, 3, reviewAt);
    const outlierReview = reviewCard(outlierDue, 3, reviewAt);

    expect(outlierReview.card.state).toBe('review');
    expect(outlierReview.card.updatedAt).toBe(conservativeReview.card.updatedAt);
    expect(outlierReview.card.stability).toBeCloseTo(conservativeReview.card.stability, 6);
    expect(outlierReview.scheduledDays).toBe(conservativeReview.scheduledDays);
  });

  it('keeps invalid review dueAt conservative when inferred stability schedule is pathological', () => {
    const corrupted = {
      ...createNewCard('invalid-due-conservative', 'letter', NOW),
      state: 'review' as const,
      createdAt: NOW,
      updatedAt: NOW,
      dueAt: 'bad-time',
      reps: 30,
      lapses: 3,
      stability: 120,
      difficulty: 5,
    };
    const reviewed = reviewCard(corrupted, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
    expect(reviewed.scheduledDays).toBeLessThanOrEqual(2);
  });

  it('keeps overdue relearning graduation growth bounded', () => {
    const card = createNewCard('omega', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;

    const onTime = reviewCard(failed, 3, failed.dueAt);
    const overdue = reviewCard(failed, 3, '2026-02-26T12:00:00.000Z');

    expect(overdue.scheduledDays).toBeLessThanOrEqual(onTime.scheduledDays * 2);
    expect(overdue.card.stability).toBeLessThanOrEqual(onTime.card.stability * 2);
  });

  it('keeps hard review growth capped for heavily overdue reviews', () => {
    let card = createNewCard('zeta-hard-cap', 'letter', NOW);
    card = reviewCard(card, 4, NOW).card;
    card = reviewCard(card, 4, '2026-02-26T12:00:00.000Z').card;
    card = reviewCard(card, 4, card.dueAt).card;

    const scheduledDays = Math.round(
      (Date.parse(card.dueAt) - Date.parse(card.updatedAt)) / (24 * 60 * 60 * 1000),
    );
    const hardOverdue = reviewCard(card, 2, addDaysIso(card.dueAt, scheduledDays * 2));
    const goodOverdue = reviewCard(card, 3, addDaysIso(card.dueAt, scheduledDays * 2));

    expect(hardOverdue.scheduledDays).toBeLessThanOrEqual(Math.ceil(scheduledDays * 1.2));
    expect(goodOverdue.scheduledDays).toBeGreaterThanOrEqual(hardOverdue.scheduledDays);
  });

  it('caps pathological far-future review schedules before stability math', () => {
    const card = createNewCard('schedule-cap', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const cappedSchedule = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, STABILITY_MAX),
    };
    const farFutureSchedule = {
      ...graduated,
      dueAt: addDaysIso(graduated.updatedAt, STABILITY_MAX * 3),
    };
    const reviewAt = addDaysIso(graduated.updatedAt, 7);

    const capped = reviewCard(cappedSchedule, 3, reviewAt);
    const farFuture = reviewCard(farFutureSchedule, 3, reviewAt);

    expect(farFuture.card.stability).toBeCloseTo(capped.card.stability, 6);
    expect(farFuture.scheduledDays).toBe(capped.scheduledDays);
  });

  it('does not move updatedAt before createdAt when recovering corrupted future timestamps', () => {
    const base = createNewCard('created-guard', 'letter', NOW);
    const corrupted = {
      ...reviewCard(base, 4, NOW).card,
      createdAt: '2028-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      dueAt: '2030-01-02T00:00:00.000Z',
      state: 'review' as const,
    };

    const reviewed = reviewCard(corrupted, 3, '2026-02-26T12:00:00.000Z');

    expect(reviewed.card.updatedAt).toBe('2028-01-01T00:00:00.000Z');
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('repairs review cards with dueAt at-or-before updatedAt using a short fallback schedule', () => {
    const corrupted = {
      ...reviewCard(createNewCard('due-repair', 'definition', NOW), 4, NOW).card,
      updatedAt: '2026-02-23T12:00:00.000Z',
      dueAt: '2026-02-23T11:00:00.000Z',
      stability: 240,
      state: 'review' as const,
    };

    const reviewed = reviewCard(corrupted, 3, '2026-02-24T12:00:00.000Z');

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeLessThan(60);
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('keeps repaired invalid review dueAt behavior aligned with a short scheduled fallback', () => {
    const updatedAt = '2026-02-23T12:00:00.000Z';
    const base = reviewCard(createNewCard('due-repair-aligned', 'definition', NOW), 4, NOW).card;
    const repaired = {
      ...base,
      updatedAt,
      dueAt: '2026-02-23T09:00:00.000Z',
      stability: 400,
      state: 'review' as const,
    };
    const shortScheduled = {
      ...base,
      updatedAt,
      dueAt: addDaysIso(updatedAt, 0.5),
      stability: 400,
      state: 'review' as const,
    };

    const reviewedAt = '2026-02-24T12:00:00.000Z';
    const repairedResult = reviewCard(repaired, 3, reviewedAt);
    const shortScheduleResult = reviewCard(shortScheduled, 3, reviewedAt);

    expect(repairedResult.card.stability).toBeCloseTo(shortScheduleResult.card.stability, 6);
    expect(repairedResult.scheduledDays).toBe(shortScheduleResult.scheduledDays);
  });

  it('clamps mildly over-window relearning schedules to the relearning max window before review math', () => {
    const updatedAt = NOW;
    const bounded = {
      ...createNewCard('relearning-window-bounded', 'definition', NOW),
      state: 'relearning' as const,
      updatedAt,
      createdAt: NOW,
      dueAt: addDaysIso(updatedAt, 2),
      reps: 8,
      lapses: 2,
      stability: 2,
      difficulty: 6,
    };
    const mildOutlier = {
      ...bounded,
      id: 'relearning-window-outlier',
      dueAt: addDaysIso(updatedAt, 2.1),
    };
    const reviewAt = addDaysIso(updatedAt, 2);

    const boundedReview = reviewCard(bounded, 3, reviewAt);
    const outlierReview = reviewCard(mildOutlier, 3, reviewAt);

    expect(outlierReview.card.state).toBe('review');
    expect(outlierReview.card.stability).toBeCloseTo(boundedReview.card.stability, 6);
    expect(outlierReview.scheduledDays).toBe(boundedReview.scheduledDays);
  });

  it('does not round 1.x day review schedules up to two days for on-time hard reviews', () => {
    const updatedAt = '2026-02-23T12:00:00.000Z';
    const card = {
      ...reviewCard(createNewCard('daylike-floor-hard', 'definition', NOW), 4, NOW).card,
      state: 'review' as const,
      updatedAt,
      dueAt: addDaysIso(updatedAt, 1.04),
      stability: 1.04,
      difficulty: 5,
      reps: 10,
    };

    const reviewed = reviewCard(card, 2, card.dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeLessThanOrEqual(1.2);
  });

  it('normalizes malformed scheduling fields before applying review math', () => {
    const malformed = {
      ...createNewCard('normalize-baseline', 'definition', NOW),
      state: ' REVIEW ' as unknown as 'review',
      reps: Number.NaN,
      lapses: Number.POSITIVE_INFINITY,
      stability: Number.NaN,
      difficulty: Number.NaN,
      dueAt: 'not-a-time',
      updatedAt: 'not-a-time',
      createdAt: 'not-a-time',
      word: '  ',
      meaning: '\n\t',
      notes: '  ',
    };

    const reviewed = reviewCard(malformed, 3, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.card.reps).toBe(1);
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.card.word).toBe('[invalid word]');
    expect(reviewed.card.meaning).toBe('[invalid meaning]');
    expect(reviewed.card.notes).toBeUndefined();
    expect(Number.isFinite(Date.parse(reviewed.card.createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(reviewed.card.updatedAt))).toBe(true);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('keeps preview interval ordering stable for cards with malformed fields', () => {
    const malformed = {
      ...createNewCard('preview-stability', 'definition', NOW),
      state: ' REVIEW ' as unknown as 'review',
      reps: Number.NaN,
      lapses: Number.NaN,
      stability: Number.NaN,
      difficulty: Number.NaN,
      dueAt: 'not-a-time',
      updatedAt: 'not-a-time',
      createdAt: 'not-a-time',
      word: '   ',
      meaning: '   ',
      notes: '   ',
    };

    const preview = previewIntervals(malformed, NOW);

    expect(preview[1]).toBeGreaterThan(0);
    expect(preview[2]).toBeGreaterThanOrEqual(preview[1]);
    expect(preview[3]).toBeGreaterThanOrEqual(preview[2]);
    expect(preview[4]).toBeGreaterThanOrEqual(preview[3]);
  });

  it('anchors review stability to repaired schedule context when dueAt is invalid', () => {
    const repairedBaseline = {
      ...createNewCard('repaired-baseline', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: 'not-a-time',
      stability: 2,
      difficulty: 5,
      reps: 20,
    };
    const extremeStability = {
      ...repairedBaseline,
      id: 'repaired-extreme',
      stability: STABILITY_MAX,
    };
    const reviewAt = addDaysIso(NOW, 1);

    const baseline = reviewCard(repairedBaseline, 3, reviewAt);
    const repaired = reviewCard(extremeStability, 3, reviewAt);

    expect(repaired.card.state).toBe('review');
    expect(repaired.scheduledDays).toBe(baseline.scheduledDays);
    expect(repaired.card.stability).toBeCloseTo(baseline.card.stability, 6);
  });

  it('keeps repaired invalid due timelines on bounded intervals for hard reviews', () => {
    const corrupted = {
      ...createNewCard('repaired-invalid-due-hard', 'definition', NOW),
      state: 'review' as const,
      updatedAt: NOW,
      dueAt: 'not-a-time',
      stability: STABILITY_MAX,
      difficulty: 7,
      reps: 30,
    };

    const reviewed = reviewCard(corrupted, 2, addDaysIso(NOW, 1));

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(0.5);
    expect(reviewed.scheduledDays).toBeLessThanOrEqual(8);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('keeps sub-floor relearning due repairs on minute-scale instead of promoting to day-like schedules', () => {
    const relearning = {
      ...createNewCard('relearning-subfloor-repair', 'definition', NOW),
      state: 'relearning' as const,
      updatedAt: NOW,
      dueAt: addDaysIso(NOW, 5 / 1440),
      reps: 5,
      lapses: 2,
      stability: 0.8,
      difficulty: 5.5,
    };

    const reviewed = reviewCard(relearning, 3, relearning.dueAt);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBe(0.5);
    expect(Date.parse(reviewed.card.dueAt)).toBeGreaterThan(Date.parse(reviewed.card.updatedAt));
  });

  it('keeps preview floors phase-safe for review and relearning cards with malformed timeline fields', () => {
    const reviewCardWithMalformedTimeline = {
      ...createNewCard('preview-review-floor', 'definition', NOW),
      state: 'review' as const,
      updatedAt: 'not-a-time',
      dueAt: 'not-a-time',
      stability: Number.NaN,
      difficulty: Number.NaN,
    };
    const relearningCardWithMalformedTimeline = {
      ...createNewCard('preview-relearning-floor', 'definition', NOW),
      state: 'relearning' as const,
      updatedAt: 'not-a-time',
      dueAt: 'not-a-time',
      stability: Number.NaN,
      difficulty: Number.NaN,
    };

    const reviewPreview = previewIntervals(reviewCardWithMalformedTimeline, NOW);
    const relearningPreview = previewIntervals(relearningCardWithMalformedTimeline, NOW);

    expect(reviewPreview[1]).toBeGreaterThanOrEqual(10 / 1440);
    expect(reviewPreview[2]).toBeGreaterThanOrEqual(0.5);
    expect(reviewPreview[4]).toBeGreaterThanOrEqual(reviewPreview[3]);
    expect(relearningPreview[1]).toBeGreaterThanOrEqual(10 / 1440);
    expect(relearningPreview[2]).toBeGreaterThanOrEqual(15 / 1440);
    expect(relearningPreview[3]).toBeGreaterThanOrEqual(0.5);
    expect(relearningPreview[4]).toBeGreaterThanOrEqual(1);
  });
});
