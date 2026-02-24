import { collapseWhitespace, normalizeBoundedText, normalizeOptionalBoundedText } from './text';

describe('text normalization', () => {
  it('collapses and trims whitespace', () => {
    expect(collapseWhitespace('  new   york \n\t city  ')).toBe('new york city');
  });

  it('normalizes bounded text and truncates at max length', () => {
    expect(normalizeBoundedText('  alpha   beta  ', 7)).toBe('alpha b');
    expect(normalizeBoundedText('  alpha   beta  ', 20)).toBe('alpha beta');
  });

  it('returns empty string for non-string bounded values', () => {
    expect(normalizeBoundedText(undefined, 10)).toBe('');
    expect(normalizeBoundedText(42, 10)).toBe('');
  });

  it('normalizes optional bounded text and drops empty values', () => {
    expect(normalizeOptionalBoundedText('  note   one ', 20)).toBe('note one');
    expect(normalizeOptionalBoundedText('    ', 20)).toBeUndefined();
    expect(normalizeOptionalBoundedText(undefined, 20)).toBeUndefined();
  });
});
