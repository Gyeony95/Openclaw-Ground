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
    expect(formatIntervalLabel(20)).toBe('2w');
  });

  it('formats long intervals in months without overstating', () => {
    expect(formatIntervalLabel(61)).toBe('2mo');
    expect(formatIntervalLabel(89)).toBe('2mo');
  });

  it('guards invalid values', () => {
    expect(formatIntervalLabel(Number.NaN)).toBe('<1m');
    expect(formatIntervalLabel(-1)).toBe('<1m');
  });

  it('floors near-boundary labels to avoid overstating next interval', () => {
    expect(formatIntervalLabel(59.9 / 1440)).toBe('59m');
    expect(formatIntervalLabel(23.9 / 24)).toBe('23h');
    expect(formatIntervalLabel(6.9)).toBe('6d');
  });
});
