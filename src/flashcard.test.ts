import { flipFlashcardSide, getFlashcardVisibility } from './flashcard';

describe('flashcard flow', () => {
  it('flips between front and back sides', () => {
    expect(flipFlashcardSide('front')).toBe('back');
    expect(flipFlashcardSide('back')).toBe('front');
  });

  it('shows only the word side content before flip', () => {
    const visibility = getFlashcardVisibility('front', true);
    expect(visibility.showMeaning).toBe(false);
    expect(visibility.showExample).toBe(false);
    expect(visibility.showRatings).toBe(false);
  });

  it('shows meaning and ratings after flip', () => {
    const visibility = getFlashcardVisibility('back', false);
    expect(visibility.showMeaning).toBe(true);
    expect(visibility.showExample).toBe(false);
    expect(visibility.showRatings).toBe(true);
  });

  it('shows example on back side when available', () => {
    const visibility = getFlashcardVisibility('back', true);
    expect(visibility.showMeaning).toBe(true);
    expect(visibility.showExample).toBe(true);
    expect(visibility.showRatings).toBe(true);
  });
});
