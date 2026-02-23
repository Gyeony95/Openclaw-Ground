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

  it('enforces scheduler-side field length limits when creating cards', () => {
    const card = createNewCard('a'.repeat(120), 'b'.repeat(220), NOW, 'c'.repeat(320));

    expect(card.word).toHaveLength(80);
    expect(card.meaning).toHaveLength(180);
    expect(card.notes).toHaveLength(240);
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

  it('drops whitespace-only notes while reviewing existing cards', () => {
    const card = {
      ...createNewCard('phi-notes', 'letter', NOW),
      notes: '    ',
    };

    const reviewed = reviewCard(card, 3, NOW);

    expect(reviewed.card.notes).toBeUndefined();
  });

  it('generates unique ids for rapid card creation at the same timestamp', () => {
    const first = createNewCard('alpha-id-1', 'first', NOW);
    const second = createNewCard('alpha-id-2', 'second', NOW);

    expect(first.id).not.toBe(second.id);
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

  it('ignores pathological future runtime clocks when timeline is healthy', () => {
    const card = createNewCard('sigma-future-now', 'letter', NOW);
    const graduated = reviewCard(card, 4, '2026-02-24T12:00:00.000Z').card;
    const skewed = reviewCard(graduated, 3, '2099-01-01T00:00:00.000Z');

    expect(skewed.card.updatedAt).toBe(graduated.updatedAt);
    expect(skewed.card.state).toBe('review');
    expect(Date.parse(skewed.card.dueAt)).toBeGreaterThan(Date.parse(skewed.card.updatedAt));
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

  it('falls back to the current clock for invalid create timestamps', () => {
    const card = createNewCard('tau', 'letter', 'bad-timestamp');

    expect(Number.isFinite(Date.parse(card.createdAt))).toBe(true);
    expect(card.updatedAt).toBe(card.createdAt);
    expect(card.dueAt).toBe(card.createdAt);
  });

  it('normalizes valid create timestamps into canonical ISO format', () => {
    const card = createNewCard('tau-canonical', 'letter', '2026-02-23T12:00:00Z');

    expect(card.createdAt).toBe('2026-02-23T12:00:00.000Z');
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

  it('keeps stability finite when numeric operations return non-finite values', () => {
    const powSpy = jest.spyOn(Math, 'pow').mockReturnValue(Number.NaN);
    const base = reviewCard(createNewCard('rho-nan-math', 'letter', NOW), 4, NOW).card;
    const reviewed = reviewCard(base, 3, '2026-02-25T12:00:00.000Z');
    powSpy.mockRestore();

    expect(Number.isFinite(reviewed.card.stability)).toBe(true);
    expect(reviewed.card.stability).toBeGreaterThanOrEqual(0.1);
    expect(reviewed.card.stability).toBeLessThanOrEqual(STABILITY_MAX);
  });

  it('treats invalid runtime rating values as nearest supported rating', () => {
    const base = createNewCard('eta', 'letter', NOW);
    const reviewed = reviewCard(base, 9 as unknown as Rating, NOW);

    expect(reviewed.card.state).toBe('review');
    expect(reviewed.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('rounds runtime fractional rating values to the nearest valid button', () => {
    const base = createNewCard('eta-2', 'letter', NOW);
    const roundedHard = reviewCard(base, 1.6 as unknown as Rating, NOW);
    const roundedGood = reviewCard(base, 2.6 as unknown as Rating, NOW);

    expect(roundedHard.card.state).toBe('learning');
    expect(roundedHard.scheduledDays).toBeGreaterThan(0.006);
    expect(roundedGood.card.state).toBe('review');
    expect(roundedGood.scheduledDays).toBe(0.5);
  });

  it('treats non-finite runtime ratings as Again to avoid accidental promotion', () => {
    const base = createNewCard('eta-3', 'letter', NOW);
    const reviewed = reviewCard(base, Number.NaN as unknown as Rating, NOW);

    expect(reviewed.card.state).toBe('learning');
    expect(reviewed.card.lapses).toBe(0);
    expect(reviewed.scheduledDays).toBeLessThan(0.002);
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
});
