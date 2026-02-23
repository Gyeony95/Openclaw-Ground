import { createNewCard, previewIntervals, reviewCard } from './fsrs';
import { Rating } from '../types';

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
    expect(review.card.lapses).toBe(1);
    expect(review.scheduledDays).toBeLessThan(0.002);
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

  it('does not reset relearning graduates to initial stability', () => {
    const card = createNewCard('mu', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-25T12:00:00.000Z').card;
    const relearned = reviewCard(failed, 3, '2026-02-25T12:30:00.000Z');

    expect(relearned.card.state).toBe('review');
    expect(relearned.card.stability).toBeLessThanOrEqual(failed.stability + 0.2);
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

  it('reduces stability more when failing overdue review cards', () => {
    const card = createNewCard('lambda', 'letter', NOW);
    const first = reviewCard(card, 4, NOW).card;

    const onTimeFail = reviewCard(first, 1, first.dueAt);
    const overdueFail = reviewCard(first, 1, '2026-02-27T12:00:00.000Z');

    expect(overdueFail.card.stability).toBeLessThan(onTimeFail.card.stability);
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

  it('uses card updatedAt when review timestamp is invalid', () => {
    const card = createNewCard('pi', 'letter', NOW);
    const result = reviewCard(card, 3, 'invalid-iso-value');

    expect(result.card.updatedAt).toBe(card.updatedAt);
    expect(result.card.dueAt).toBe('2026-02-24T00:00:00.000Z');
  });

  it('keeps review timestamps monotonic when request time is older than updatedAt', () => {
    const card = createNewCard('sigma', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2026-02-24T11:59:00.000Z');

    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
    expect(skewed.card.dueAt).toBe('2026-02-26T12:00:00.000Z');
  });

  it('falls back to the current clock for invalid create timestamps', () => {
    const card = createNewCard('tau', 'letter', 'bad-timestamp');

    expect(Number.isFinite(Date.parse(card.createdAt))).toBe(true);
    expect(card.updatedAt).toBe(card.createdAt);
    expect(card.dueAt).toBe(card.createdAt);
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

  it('treats invalid runtime rating values as nearest supported rating', () => {
    const base = createNewCard('eta', 'letter', NOW);
    const reviewed = reviewCard(base, 9 as unknown as Rating, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('normalizes non-finite counters during review updates', () => {
    const base = createNewCard('theta-2', 'letter', NOW);
    const corrupted = {
      ...base,
      reps: -4,
      lapses: Number.NaN,
    };
    const reviewed = reviewCard(corrupted, 1, NOW);

    expect(reviewed.card.reps).toBe(1);
    expect(reviewed.card.lapses).toBe(1);
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

  it('uses a one-day schedule floor for corrupted review cards', () => {
    const base = createNewCard('upsilon', 'letter', NOW);
    const graduated = reviewCard(base, 4, NOW).card;
    const corrupted = {
      ...graduated,
      state: 'review' as const,
      updatedAt: '2026-02-24T12:00:00.000Z',
      dueAt: '2026-02-24T12:00:00.000Z',
    };
    const reviewed = reviewCard(corrupted, 3, '2026-02-25T12:00:00.000Z');

    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(reviewed.card.state).toBe('review');
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

  it('computes ordered interval previews per rating', () => {
    const card = createNewCard('chi', 'letter', NOW);
    const base = reviewCard(card, 4, NOW).card;
    const preview = previewIntervals(base, '2026-02-26T12:00:00.000Z');

    expect(preview[1]).toBeLessThanOrEqual(preview[2]);
    expect(preview[2]).toBeLessThanOrEqual(preview[3]);
    expect(preview[3]).toBeLessThanOrEqual(preview[4]);
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

  it('keeps overdue relearning graduation growth bounded', () => {
    const card = createNewCard('omega', 'letter', NOW);
    const graduated = reviewCard(card, 4, NOW).card;
    const failed = reviewCard(graduated, 1, '2026-02-24T12:00:00.000Z').card;

    const onTime = reviewCard(failed, 3, failed.dueAt);
    const overdue = reviewCard(failed, 3, '2026-02-26T12:00:00.000Z');

    expect(overdue.scheduledDays).toBeLessThanOrEqual(onTime.scheduledDays * 2);
    expect(overdue.card.stability).toBeLessThanOrEqual(onTime.card.stability * 2);
  });
});
