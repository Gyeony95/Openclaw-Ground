import { parseRuntimeRatingValue } from './rating';

describe('parseRuntimeRatingValue', () => {
  it('accepts numbers and decimal numeric strings', () => {
    expect(parseRuntimeRatingValue(3)).toBe(3);
    expect(parseRuntimeRatingValue('4')).toBe(4);
    expect(parseRuntimeRatingValue(' 2.0 ')).toBe(2);
  });

  it('rejects non-decimal or malformed values', () => {
    expect(parseRuntimeRatingValue('0x4')).toBeNaN();
    expect(parseRuntimeRatingValue('4e0')).toBeNaN();
    expect(parseRuntimeRatingValue('Infinity')).toBeNaN();
    expect(parseRuntimeRatingValue('')).toBeNaN();
    expect(parseRuntimeRatingValue('abc')).toBeNaN();
  });
});
