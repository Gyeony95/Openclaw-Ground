import { Card, Rating } from './types';
import {
  composeQuizOptions,
  findQuizOptionById,
  generateDistractors,
  hasValidQuizSelection,
  inferPartOfSpeech,
  normalizedTokenOverlap,
  resolveLockedQuizSelection,
  resolveMultipleChoiceRating,
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

  it('preserves non-Latin tokens when computing overlap', () => {
    expect(normalizedTokenOverlap('안녕하세요 세계', '안녕하세요 친구')).toBeGreaterThan(0);
    expect(normalizedTokenOverlap('안녕하세요 세계', '감사합니다 모두')).toBe(0);
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
    expect(new Set(first.map((option) => option.id)).size).toBe(first.length);
    expect(first.map((option) => option.id)).toEqual(second.map((option) => option.id));
    expect(first.map((option) => option.id)).not.toEqual(third.map((option) => option.id));
  });

  it('keeps option IDs unique when distractors contain duplicate card IDs', () => {
    const duplicateIdDeck = [
      createCard('t1', 'anchor', 'to fix firmly in place'),
      createCard('dup', 'pin', 'to fasten with a pin'),
      createCard('dup', 'tack', 'to attach lightly'),
      createCard('dup', 'clip', 'to hold together'),
      createCard('x1', 'bind', 'to tie tightly'),
    ];

    const options = composeQuizOptions(duplicateIdDeck[0], duplicateIdDeck, 'dup-seed');

    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
    expect(options.filter((option) => option.cardId === 'dup')).toHaveLength(3);
  });

  it('keeps duplicate-id cards eligible as distractors when their content differs from the target', () => {
    const duplicateIdDeck = [
      createCard('dup-target', 'anchor', 'to fix firmly in place'),
      createCard('dup-target', 'moor', 'to secure a boat with ropes'),
      createCard('x1', 'pin', 'to fasten with a pin'),
      createCard('x2', 'clip', 'to hold together'),
      createCard('x3', 'bind', 'to tie tightly'),
    ];

    const distractors = generateDistractors(duplicateIdDeck[0], duplicateIdDeck, 3);

    expect(distractors).toHaveLength(3);
    expect(distractors.some((card) => card.word === 'moor')).toBe(true);
    expect(distractors.every((card) => card.meaning !== duplicateIdDeck[0].meaning)).toBe(true);
  });

  it('accepts only selections that still exist in the current option set', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');
    const selectedId = options[0].id;

    expect(hasValidQuizSelection(selectedId, options)).toBe(true);
    expect(hasValidQuizSelection('missing-option-id', options)).toBe(false);
    expect(hasValidQuizSelection(null, options)).toBe(false);
  });

  it('does not throw when option ids are malformed at runtime', () => {
    const malformedOptions = [
      { id: undefined as unknown as string, cardId: 'c2', text: 'bad', isCorrect: false },
      { id: 'valid-option', cardId: 'c3', text: 'good', isCorrect: true },
    ];

    expect(() => hasValidQuizSelection('valid-option', malformedOptions)).not.toThrow();
    expect(hasValidQuizSelection('valid-option', malformedOptions)).toBe(true);
  });

  it('treats whitespace-padded selection ids as valid when the target option exists', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');
    const selectedId = options[0].id;

    expect(hasValidQuizSelection(`  ${selectedId}  `, options)).toBe(true);
    expect(hasValidQuizSelection('   ', options)).toBe(false);
  });

  it('finds selected options by normalized ids when option ids include whitespace', () => {
    const options = [
      { id: '  correct-option  ', cardId: 'c1', text: 'answer', isCorrect: true },
      { id: 'wrong-option', cardId: 'c2', text: 'wrong', isCorrect: false },
    ];

    const selected = findQuizOptionById(options, 'correct-option');

    expect(selected?.id).toBe('  correct-option  ');
    expect(selected?.isCorrect).toBe(true);
  });

  it('returns undefined for malformed or missing selected option ids', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');

    expect(findQuizOptionById(options, null)).toBeUndefined();
    expect(findQuizOptionById(options, '   ')).toBeUndefined();
    expect(findQuizOptionById(options, 'missing')).toBeUndefined();
  });

  it('locks quiz selection to the first valid answer until review is submitted', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');
    const firstId = options[0].id;
    const secondId = options[1].id;

    const firstSelection = resolveLockedQuizSelection(options, null, firstId);
    const attemptedChange = resolveLockedQuizSelection(options, firstSelection, secondId);

    expect(firstSelection).toBe(firstId);
    expect(attemptedChange).toBe(firstId);
  });

  it('returns null when both current and requested quiz selections are invalid', () => {
    const options = composeQuizOptions(target, deck, 'seed-1');

    const selection = resolveLockedQuizSelection(options, 'missing-option', 'another-missing-option');

    expect(selection).toBeNull();
  });

  it('invalidates stale selection ids when options are regenerated with a different seed', () => {
    const first = composeQuizOptions(target, deck, 'seed-1');
    const second = composeQuizOptions(target, deck, 'seed-2');
    const removedId = first.find((option) => !second.some((candidate) => candidate.id === option.id))?.id;

    expect(typeof removedId).toBe('string');
    expect(hasValidQuizSelection(removedId ?? null, second)).toBe(false);
  });

  it('backfills distractors from remaining unique meanings when top-ranked candidates collapse', () => {
    const fallbackDeck = [
      createCard('t1', 'light', 'to make bright'),
      createCard('t2', 'ignite', 'to make bright'),
      createCard('t3', 'spark', 'to make bright'),
      createCard('t4', 'glow', 'to emit light softly'),
      createCard('t5', 'shine', 'to reflect light'),
      createCard('t6', 'blink', 'to close and open the eyes quickly'),
    ];

    const distractors = generateDistractors(fallbackDeck[0], fallbackDeck, 3);

    expect(distractors).toHaveLength(3);
    expect(new Set(distractors.map((card) => card.meaning.toLowerCase())).size).toBe(3);
  });

  it('keeps duplicate-id cards eligible during backfill when target identity differs', () => {
    const fallbackDeck = [
      createCard('dup-target', 'anchor', 'to fix firmly in place'),
      createCard('dup-target', 'moor', 'to secure a boat with ropes'),
      createCard('x1', 'pin', 'to fix firmly in place'),
      createCard('x2', 'tack', 'to fix firmly in place'),
      createCard('x3', 'clip', 'to hold together'),
    ];

    const distractors = generateDistractors(fallbackDeck[0], fallbackDeck, 3);

    expect(distractors).toHaveLength(3);
    expect(distractors.some((card) => card.word === 'moor')).toBe(true);
    expect(distractors.every((card) => card.meaning !== fallbackDeck[0].meaning)).toBe(true);
  });

  it('composes options safely when deck cards contain malformed ids or blank meanings', () => {
    const malformedDeck = [
      createCard('target', 'anchor', 'to fix firmly in place'),
      { ...createCard('c2', 'pin', ''), id: '   ' as unknown as string },
      { ...createCard('c3', 'tack', '   '), id: undefined as unknown as string },
      { ...createCard('c4', 'clip', 'to hold together') },
      { ...createCard('c5', 'bind', 'to tie tightly') },
    ];

    const options = composeQuizOptions(malformedDeck[0], malformedDeck as Card[], 'malformed-seed');

    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.id)).size).toBe(4);
    expect(options.every((option) => option.id.trim().length > 0)).toBe(true);
    expect(options.every((option) => option.text.trim().length > 0)).toBe(true);
  });

  it('skips malformed runtime deck entries when generating distractors and options', () => {
    const malformedDeck = [
      createCard('target-safe', 'anchor', 'to fix firmly in place'),
      createCard('c2', 'pin', 'to fasten with a pin'),
      createCard('c3', 'clip', 'to hold together'),
      createCard('c4', 'bind', 'to tie tightly'),
      null,
      { ...createCard('bad-meaning', 'corrupt', 'placeholder'), meaning: { bad: true } as unknown as string },
      { ...createCard('bad-word', 'corrupt', 'to attach lightly'), word: 42 as unknown as string },
    ] as unknown as Card[];

    expect(() => generateDistractors(malformedDeck[0], malformedDeck, 3)).not.toThrow();
    expect(() => composeQuizOptions(malformedDeck[0], malformedDeck, 'malformed-runtime-seed')).not.toThrow();

    const options = composeQuizOptions(malformedDeck[0], malformedDeck, 'malformed-runtime-seed');
    expect(options).toHaveLength(4);
    expect(options.every((option) => option.text !== '[invalid meaning]')).toBe(true);
  });

  it('forces incorrect multiple-choice selections to Again for FSRS consistency', () => {
    expect(resolveMultipleChoiceRating(4, false)).toBe(1);
    expect(resolveMultipleChoiceRating(3, false)).toBe(1);
    expect(resolveMultipleChoiceRating(2, false)).toBe(1);
    expect(resolveMultipleChoiceRating(1, false)).toBe(1);
  });

  it('keeps requested rating when multiple-choice selection is correct', () => {
    expect(resolveMultipleChoiceRating(1, true)).toBe(1);
    expect(resolveMultipleChoiceRating(2, true)).toBe(2);
    expect(resolveMultipleChoiceRating(3, true)).toBe(3);
    expect(resolveMultipleChoiceRating(4, true)).toBe(4);
  });

  it('accepts numeric-string ratings for correct selections', () => {
    expect(resolveMultipleChoiceRating('1' as unknown as Rating, true)).toBe(1);
    expect(resolveMultipleChoiceRating('2' as unknown as Rating, true)).toBe(2);
    expect(resolveMultipleChoiceRating('3' as unknown as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating('4' as unknown as Rating, true)).toBe(4);
  });

  it('normalizes non-decimal string ratings for correct selections to neutral Good', () => {
    expect(resolveMultipleChoiceRating('0x4' as unknown as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating('4e0' as unknown as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating('Infinity' as unknown as Rating, true)).toBe(3);
  });

  it('normalizes malformed correct-selection ratings to neutral Good', () => {
    expect(resolveMultipleChoiceRating(Number.NaN as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating(2.5 as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating(0 as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating(9 as Rating, true)).toBe(3);
  });

  it('accepts near-integer correct-selection ratings and normalizes them', () => {
    expect(resolveMultipleChoiceRating((2 + Number.EPSILON) as Rating, true)).toBe(2);
    expect(resolveMultipleChoiceRating((4 - Number.EPSILON) as Rating, true)).toBe(4);
  });
});
