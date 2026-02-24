export type FlashcardSide = 'front' | 'back';

export interface FlashcardVisibility {
  showMeaning: boolean;
  showExample: boolean;
  showRatings: boolean;
}

export function flipFlashcardSide(side: FlashcardSide): FlashcardSide {
  return side === 'front' ? 'back' : 'front';
}

export function getFlashcardVisibility(side: FlashcardSide, hasExample: boolean): FlashcardVisibility {
  if (side === 'front') {
    return {
      showMeaning: false,
      showExample: false,
      showRatings: false,
    };
  }
  return {
    showMeaning: true,
    showExample: hasExample,
    showRatings: true,
  };
}
