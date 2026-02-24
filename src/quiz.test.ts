import { Card } from './types';
import {
  composeQuizOptions,
  generateDistractors,
  hasValidQuizSelection,
  inferPartOfSpeech,
  normalizedTokenOverlap,
} from './quiz';

const NOW = '2026-02-24T12:00:00.000Z';

function createCard(id: string, word: string, meaning: string): Card {
  return {
    id,
    word,
    meaning,
    createdAt: NOW,
    updatedAt: NOW,
    dueAt: NOW,
    state: 'review',
    reps: 4,
    lapses: 0,
    stability: 8,
    difficulty: 4,
  };
}

describe('quiz distractors', () => {
  const target = createCard('c1', 'misspell', 'to write a word incorrectly');
  const deck = [
    target,
    createCard('c2', 'miswrite', 'to write text incorrectly by mistake'),
    createCard('c3', 'mistype', 'to type a word incorrectly on a keyboard'),
    createCard('c4', 'draft', 'to write a first version of text'),
    createCard('c5', 'correct', 'to remove mistakes from text'),
    createCard('c6', 'sparrow', 'a small bird found in cities'),
    createCard('c7', 'compose', 'to create and arrange written text'),
  ];

  it('computes normalized token overlap', () => {
    expect(normalizedTokenOverlap('write a word incorrectly', 'write text incorrectly')).toBeGreaterThan(0.3);
    expect(normalizedTokenOverlap('write a word incorrectly', 'small bird in cities')).toBe(0);
  });

  it('detects adjective meanings by suffix for distractor scoring', () => {
    expect(inferPartOfSpeech('dangerous and risky')).toBe('adjective');
  });

  it('picks three wrong distractors biased toward lexical or semantic similarity', () => {
    const distractors = generateDistractors(target, deck, 3);

    expect(distractors).toHaveLength(3);
    expect(distractors.map((item) => item.id)).toEqual(['c2', 'c3', 'c4']);
    expect(distractors.some((item) => item.meaning === target.meaning)).toBe(false);
  });

  it('composes deterministic options with one correct answer and three distractors', () => {
    const first = composeQuizOptions(target, deck, 'seed-1');
    const second = composeQuizOptions(target, deck, 'seed-1');
    const third = composeQuizOptions(target, deck, 'seed-2');

    expect(first).toHaveLength(4);
    expect(first.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(first.filter((option) => !option.isCorrect)).toHaveLength(3);
    expect(first.map((option) => option.id)).toEqual(second.map((option) => option.id));
    expect(first.map((option) => option.id)).not.toEqual(third.map((option) => option.id));
  });

  it('accepts only selections that still exist in the current option set', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');
    const selectedId = options[0].id;

    expect(hasValidQuizSelection(selectedId, options)).toBe(true);
    expect(hasValidQuizSelection('missing-option-id', options)).toBe(false);
    expect(hasValidQuizSelection(null, options)).toBe(false);
  });

  it('invalidates stale selection ids when options are regenerated with a different seed', () => {
    const first = composeQuizOptions(target, deck, 'seed-1');
    const second = composeQuizOptions(target, deck, 'seed-2');
    const removedId = first.find((option) => !second.some((candidate) => candidate.id === option.id))?.id;

    expect(typeof removedId).toBe('string');
    expect(hasValidQuizSelection(removedId ?? null, second)).toBe(false);
  });
});
