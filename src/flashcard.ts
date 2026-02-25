export type FlashcardSide = 'front' | 'back';

export interface FlashcardVisibility {
  showMeaning: boolean;
  showExample: boolean;
  showRatings: boolean;
}

export interface FlashcardVisibilityOptions {
  forceShowRatings?: boolean;
}

export function flipFlashcardSide(side: FlashcardSide): FlashcardSide {
  return side === 'front' ? 'back' : 'front';
}

export function getFlashcardVisibility(
  side: FlashcardSide,
  hasExample: boolean,
  options: FlashcardVisibilityOptions = {},
): FlashcardVisibility {
  const forceShowRatings = options.forceShowRatings === true;
  if (side === 'front') {
    return {
      showMeaning: false,
      showExample: false,
      showRatings: forceShowRatings,
    };
  }
  return {
    showMeaning: true,
    showExample: hasExample,
    showRatings: true,
  };
}
