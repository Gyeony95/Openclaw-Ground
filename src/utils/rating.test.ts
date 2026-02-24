import { parseRuntimeRatingValue } from './rating';

describe('parseRuntimeRatingValue', () => {
  it('accepts numbers and decimal numeric strings', () => {
    expect(parseRuntimeRatingValue(3)).toBe(3);
    expect(parseRuntimeRatingValue('4')).toBe(4);
    expect(parseRuntimeRatingValue(' 2.0 ')).toBe(2);
    expect(parseRuntimeRatingValue('4e0')).toBe(4);
    expect(parseRuntimeRatingValue('.5')).toBe(0.5);
  });

  it('rejects malformed values', () => {
    expect(parseRuntimeRatingValue('0x4')).toBeNaN();
    expect(parseRuntimeRatingValue('Infinity')).toBeNaN();
    expect(parseRuntimeRatingValue('')).toBeNaN();
    expect(parseRuntimeRatingValue('abc')).toBeNaN();
  });
});
