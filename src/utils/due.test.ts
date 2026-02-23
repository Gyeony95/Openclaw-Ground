import { formatDueLabel } from './due';

describe('formatDueLabel', () => {
  const NOW = '2026-02-23T12:00:00.000Z';

  it('returns due now within one minute threshold', () => {
    expect(formatDueLabel('2026-02-23T12:00:30.000Z', NOW)).toBe('Due now');
    expect(formatDueLabel('2026-02-23T11:59:30.000Z', NOW)).toBe('Due now');
  });

  it('formats short overdue labels in hours', () => {
    expect(formatDueLabel('2026-02-23T09:10:00.000Z', NOW)).toBe('Overdue 3h');
  });

  it('formats sub-hour labels in minutes', () => {
    expect(formatDueLabel('2026-02-23T11:10:00.000Z', NOW)).toBe('Overdue 50m');
    expect(formatDueLabel('2026-02-23T12:35:00.000Z', NOW)).toBe('Due in 35m');
  });

  it('formats long overdue labels in days', () => {
    expect(formatDueLabel('2026-02-20T11:59:59.000Z', NOW)).toBe('Overdue 3d');
  });

  it('formats upcoming labels in hours or days conservatively', () => {
    expect(formatDueLabel('2026-02-23T16:30:00.000Z', NOW)).toBe('Due in 4h');
    expect(formatDueLabel('2026-02-25T12:00:01.000Z', NOW)).toBe('Due in 2d');
  });

  it('does not overstate near-boundary minute and hour future labels', () => {
    expect(formatDueLabel('2026-02-23T12:01:01.000Z', NOW)).toBe('Due in 1m');
    expect(formatDueLabel('2026-02-23T12:59:59.000Z', NOW)).toBe('Due in 59m');
    expect(formatDueLabel('2026-02-23T13:00:01.000Z', NOW)).toBe('Due in 1h');
  });

  it('returns unavailable for invalid timestamps', () => {
    expect(formatDueLabel('bad', NOW)).toBe('Due date unavailable');
    expect(formatDueLabel('2026-02-23T12:00:00.000Z', 'bad')).toBe('Due date unavailable');
  });

  it('floors overdue durations so labels do not overstate lateness', () => {
    expect(formatDueLabel('2026-02-23T10:59:59.000Z', NOW)).toBe('Overdue 1h');
    expect(formatDueLabel('2026-02-22T10:59:59.000Z', NOW)).toBe('Overdue 1d');
  });

  it('keeps near-boundary future day labels conservative', () => {
    expect(formatDueLabel('2026-02-24T12:00:01.000Z', NOW)).toBe('Due in 1d');
  });

  it('floors multi-day future labels so they do not overstate wait time', () => {
    expect(formatDueLabel('2026-02-26T11:59:59.000Z', NOW)).toBe('Due in 2d');
    expect(formatDueLabel('2026-02-25T00:00:00.000Z', NOW)).toBe('Due in 1d');
  });
});
