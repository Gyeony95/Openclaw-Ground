import { addDaysIso, daysBetween, isDue } from './time';

describe('time utils', () => {
  it('adds days in iso format', () => {
    expect(addDaysIso('2026-02-23T00:00:00.000Z', 2)).toBe('2026-02-25T00:00:00.000Z');
  });

  it('returns 0 for invalid dates in daysBetween', () => {
    expect(daysBetween('bad', '2026-02-23T00:00:00.000Z')).toBe(0);
  });

  it('returns false for invalid due date', () => {
    expect(isDue('bad', '2026-02-23T00:00:00.000Z')).toBe(false);
  });

  it('supports fractional days and clamps negative elapsed days to 0', () => {
    expect(addDaysIso('2026-02-23T00:00:00.000Z', 0.5)).toBe('2026-02-23T12:00:00.000Z');
    expect(daysBetween('2026-02-24T00:00:00.000Z', '2026-02-23T00:00:00.000Z')).toBe(0);
  });

  it('falls back to zero-day offset for non-finite addDays inputs', () => {
    expect(addDaysIso('2026-02-23T00:00:00.000Z', Number.NaN)).toBe('2026-02-23T00:00:00.000Z');
  });
});
