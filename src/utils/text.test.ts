import { collapseWhitespace, normalizeBoundedText, normalizeOptionalBoundedText } from './text';

describe('text normalization', () => {
  it('collapses and trims whitespace', () => {
    expect(collapseWhitespace('  new   york \n\t city  ')).toBe('new york city');
  });

  it('normalizes bounded text and truncates at max length', () => {
    expect(normalizeBoundedText('  alpha   beta  ', 7)).toBe('alpha b');
    expect(normalizeBoundedText('  alpha   beta  ', 20)).toBe('alpha beta');
  });

  it('removes zero-width characters during normalization', () => {
    expect(normalizeBoundedText('\u200B\u200C alpha \uFEFF beta \u200D', 40)).toBe('alpha beta');
    expect(normalizeOptionalBoundedText('\u200B\uFEFF', 20)).toBeUndefined();
  });

  it('returns empty string for non-string bounded values', () => {
    expect(normalizeBoundedText(undefined, 10)).toBe('');
    expect(normalizeBoundedText(42, 10)).toBe('');
  });

  it('guards non-finite and negative max lengths', () => {
    expect(normalizeBoundedText('alpha', Number.NaN)).toBe('');
    expect(normalizeBoundedText('alpha', -3)).toBe('');
  });

  it('normalizes optional bounded text and drops empty values', () => {
    expect(normalizeOptionalBoundedText('  note   one ', 20)).toBe('note one');
    expect(normalizeOptionalBoundedText('    ', 20)).toBeUndefined();
    expect(normalizeOptionalBoundedText(undefined, 20)).toBeUndefined();
  });
});
