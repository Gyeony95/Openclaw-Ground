import { formatCounterDisplay } from './counter';

describe('formatCounterDisplay', () => {
  it('formats finite non-negative counters', () => {
    expect(formatCounterDisplay(0)).toBe('0');
    expect(formatCounterDisplay(12)).toBe('12');
    expect(formatCounterDisplay(12.8)).toBe('12');
  });

  it('accepts string and boxed numeric values from runtime bridges', () => {
    expect(formatCounterDisplay(' 42 ')).toBe('42');
    expect(formatCounterDisplay(new Number(7))).toBe('7');
    expect(formatCounterDisplay(new String('8'))).toBe('8');
  });

  it('accepts valueOf and toString backed runtime values', () => {
    const valueOfBacked = {
      valueOf() {
        return '19';
      },
    };
    const toStringBacked = {
      valueOf() {
        throw new Error('runtime bridge valueOf failure');
      },
      toString() {
        return '21';
      },
    };

    expect(formatCounterDisplay(valueOfBacked)).toBe('19');
    expect(formatCounterDisplay(toStringBacked)).toBe('21');
  });

  it('returns placeholder for invalid or negative counters', () => {
    expect(formatCounterDisplay(-1)).toBe('--');
    expect(formatCounterDisplay(Number.NaN)).toBe('--');
    expect(formatCounterDisplay('bad')).toBe('--');
    expect(formatCounterDisplay(undefined)).toBe('--');
  });
});
