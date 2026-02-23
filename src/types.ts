export type ReviewState = 'learning' | 'review' | 'relearning';

export type Rating = 1 | 2 | 3 | 4;

export interface Card {
  id: string;
  word: string;
  meaning: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  state: ReviewState;
  reps: number;
  lapses: number;
  stability: number;
  difficulty: number;
}

export interface Deck {
  cards: Card[];
  lastReviewedAt?: string;
}

export interface DeckStats {
  total: number;
  dueNow: number;
  learning: number;
  review: number;
  relearning: number;
}
