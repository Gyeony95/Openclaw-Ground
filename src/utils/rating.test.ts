import { parseRuntimeRatingValue, RATING_INTEGER_TOLERANCE } from './rating';

describe('parseRuntimeRatingValue', () => {
  it('exports a stable integer tolerance shared by scheduler and quiz flows', () => {
    expect(RATING_INTEGER_TOLERANCE).toBe(1e-4);
  });

  it('accepts numbers and decimal numeric strings', () => {
    expect(parseRuntimeRatingValue(3)).toBe(3);
    expect(parseRuntimeRatingValue('4')).toBe(4);
    expect(parseRuntimeRatingValue(' 2.0 ')).toBe(2);
    expect(parseRuntimeRatingValue('4e0')).toBe(4);
    expect(parseRuntimeRatingValue('.5')).toBe(0.5);
  });

  it('accepts boxed numeric runtime values from bridged inputs', () => {
    expect(parseRuntimeRatingValue(new Number(3))).toBe(3);
    expect(parseRuntimeRatingValue(new String(' 4 '))).toBe(4);
  });

  it('falls back to string coercion for bridged objects with non-primitive valueOf', () => {
    const bridged = {
      valueOf() {
        return {};
      },
      toString() {
        return ' 3 ';
      },
    };

    expect(parseRuntimeRatingValue(bridged)).toBe(3);
  });

  it('falls back to string coercion when bridged valueOf throws', () => {
    const bridged = {
      valueOf() {
        throw new Error('runtime bridge valueOf failure');
      },
      toString() {
        return '4';
      },
    };

    expect(parseRuntimeRatingValue(bridged)).toBe(4);
  });

  it('rejects malformed values', () => {
    expect(parseRuntimeRatingValue('0x4')).toBeNaN();
    expect(parseRuntimeRatingValue('Infinity')).toBeNaN();
    expect(parseRuntimeRatingValue(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(parseRuntimeRatingValue(Number.NEGATIVE_INFINITY)).toBeNaN();
    expect(parseRuntimeRatingValue(Number.NaN)).toBeNaN();
    expect(parseRuntimeRatingValue(new Number(Number.NaN))).toBeNaN();
    expect(parseRuntimeRatingValue('')).toBeNaN();
    expect(parseRuntimeRatingValue('abc')).toBeNaN();
  });
});
