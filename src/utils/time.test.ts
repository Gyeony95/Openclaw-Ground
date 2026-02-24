import { addDaysIso, daysBetween, isDue, isIsoDateTime, nowIso } from './time';

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

  it('falls back to epoch-safe date math when base timestamp is invalid and runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const shifted = addDaysIso('bad-iso', 1);
    nowSpy.mockRestore();

    expect(shifted).toBe('1970-01-02T00:00:00.000Z');
  });

  it('falls back to epoch-safe date math when runtime clock is non-finite and day offset is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const shifted = addDaysIso('bad-iso', Number.POSITIVE_INFINITY);
    nowSpy.mockRestore();

    expect(shifted).toBe('1970-01-01T00:00:00.000Z');
  });

  it('clamps overflowed date math to the max supported ISO timestamp', () => {
    const shifted = addDaysIso('+275760-09-13T00:00:00.000Z', 1);

    expect(shifted).toBe('+275760-09-13T00:00:00.000Z');
  });

  it('returns canonical runtime timestamps from nowIso', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-02-24T08:15:30.000Z'));
    const current = nowIso();
    nowSpy.mockRestore();

    expect(current).toBe('2026-02-24T08:15:30.000Z');
  });

  it('falls back to epoch when runtime clock is non-finite', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Number.NaN);
    const current = nowIso();
    nowSpy.mockRestore();

    expect(current).toBe('1970-01-01T00:00:00.000Z');
  });

  it('accepts strict ISO timestamps and rejects loose date-time strings', () => {
    expect(isIsoDateTime('2026-02-24T08:15:30.000Z')).toBe(true);
    expect(isIsoDateTime('2026-02-24T08:15:30Z')).toBe(true);
    expect(isIsoDateTime('+275760-09-13T00:00:00.000Z')).toBe(true);
    expect(isIsoDateTime('2026-02-24 08:15:30Z')).toBe(false);
    expect(isIsoDateTime('Tue, 24 Feb 2026 08:15:30 GMT')).toBe(false);
  });
});
