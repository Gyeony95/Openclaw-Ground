import { formatIntervalLabel } from './interval';

describe('formatIntervalLabel', () => {
  it('formats minute-scale intervals', () => {
    expect(formatIntervalLabel(0.5 / 1440)).toBe('<1m');
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

  it('formats long intervals in months', () => {
    expect(formatIntervalLabel(61)).toBe('2mo');
    expect(formatIntervalLabel(89)).toBe('2mo');
  });

  it('formats very long intervals in years', () => {
    expect(formatIntervalLabel(365)).toBe('1y');
    expect(formatIntervalLabel(730)).toBe('2y');
    expect(formatIntervalLabel(364)).toBe('1y');
    expect(formatIntervalLabel(363)).toBe('12mo');
  });

  it('guards invalid values', () => {
    expect(formatIntervalLabel(Number.NaN)).toBe('<1m');
    expect(formatIntervalLabel(-1)).toBe('<1m');
  });

  it('caps overflowed positive infinity intervals to a max horizon label', () => {
    expect(formatIntervalLabel(Number.POSITIVE_INFINITY)).toBe('100y');
    expect(formatIntervalLabel(Number.NEGATIVE_INFINITY)).toBe('<1m');
  });

  it('rounds near-boundary labels to better reflect scheduled intervals', () => {
    expect(formatIntervalLabel(59.6 / 1440)).toBe('60m');
    expect(formatIntervalLabel(23.6 / 24)).toBe('24h');
    expect(formatIntervalLabel(6.6)).toBe('6d');
  });

  it('keeps long-unit labels conservative so they do not overstate the next interval', () => {
    expect(formatIntervalLabel(13.9)).toBe('1w');
    expect(formatIntervalLabel(59.9)).toBe('8w');
    expect(formatIntervalLabel(359.9)).toBe('11mo');
    expect(formatIntervalLabel(729.9)).toBe('1y');
  });
});
