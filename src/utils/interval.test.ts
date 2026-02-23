import { formatIntervalLabel } from './interval';

describe('formatIntervalLabel', () => {
  it('formats minute-scale intervals', () => {
    expect(formatIntervalLabel(1 / 1440)).toBe('1m');
    expect(formatIntervalLabel(10 / 1440)).toBe('10m');
  });

  it('formats hour and day intervals', () => {
    expect(formatIntervalLabel(0.5)).toBe('12h');
    expect(formatIntervalLabel(3)).toBe('3d');
  });

  it('formats week-scale intervals', () => {
    expect(formatIntervalLabel(8)).toBe('1w');
    expect(formatIntervalLabel(20)).toBe('3w');
  });

  it('formats long intervals in months without overstating', () => {
    expect(formatIntervalLabel(61)).toBe('2mo');
    expect(formatIntervalLabel(89)).toBe('2mo');
  });

  it('guards invalid values', () => {
    expect(formatIntervalLabel(Number.NaN)).toBe('<1m');
    expect(formatIntervalLabel(-1)).toBe('<1m');
  });
});
