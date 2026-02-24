import { Card, Rating } from './types';
import {
  composeQuizOptions,
  findQuizOptionById,
  generateDistractors,
  hasValidQuizSelection,
  inferPartOfSpeech,
  isStudyModeSwitchLocked,
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

  it('detects adverbs that appear mid-phrase instead of only at the end', () => {
    expect(inferPartOfSpeech('in a quickly changing market')).toBe('adverb');
  });

  it('picks three wrong distractors biased toward lexical or semantic similarity', () => {
    const distractors = generateDistractors(target, deck, 3);

    expect(distractors).toHaveLength(3);
    expect(distractors.map((item) => item.id)).toEqual(['c2', 'c3', 'c4']);
    expect(distractors.some((item) => item.meaning === target.meaning)).toBe(false);
  });

  it('returns no distractors when requested count is zero or negative', () => {
    expect(generateDistractors(target, deck, 0)).toEqual([]);
    expect(generateDistractors(target, deck, -2)).toEqual([]);
  });

  it('floors non-integer distractor counts to keep option generation deterministic', () => {
    const distractors = generateDistractors(target, deck, 2.9);

    expect(distractors).toHaveLength(2);
    expect(distractors.map((item) => item.id)).toEqual(['c2', 'c3']);
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

  it('composes a single-option quiz when distractor count is zero', () => {
    const options = composeQuizOptions(target, deck, 'seed-zero', 0);

    expect(options).toHaveLength(1);
    expect(options[0].isCorrect).toBe(true);
    expect(options[0].text).toBe(target.meaning);
  });

  it('normalizes quiz option text by trimming and collapsing internal whitespace', () => {
    const messyDeck = [
      createCard('target', 'anchor', '  to   fix \n firmly   in place  '),
      createCard('c2', 'pin', '  to   fasten   with \n a pin '),
      createCard('c3', 'clip', 'to   hold\t together'),
      createCard('c4', 'bind', 'to tie   tightly'),
      createCard('c5', 'moor', 'to secure \n a boat with ropes'),
    ];

    const options = composeQuizOptions(messyDeck[0], messyDeck, 'whitespace-seed');

    expect(options).toHaveLength(4);
    expect(options.every((option) => option.text === option.text.trim())).toBe(true);
    expect(options.some((option) => /\s{2,}/.test(option.text))).toBe(false);
    expect(options.some((option) => /\n|\t/.test(option.text))).toBe(false);
  });

  it('caps quiz option text length and strips zero-width characters from malformed meanings', () => {
    const malformedDeck = [
      createCard('target', 'anchor', '\u200B clean  meaning \u200C'),
      createCard('c2', 'pin', ` ${'\u200Bx'.repeat(260)} `),
      createCard('c3', 'clip', 'to hold together'),
      createCard('c4', 'bind', 'to tie tightly'),
      createCard('c5', 'moor', 'to secure a boat with ropes'),
    ];

    const options = composeQuizOptions(malformedDeck[0], malformedDeck, 'text-cap-seed');

    expect(options).toHaveLength(4);
    expect(options.some((option) => option.text.includes('\u200B'))).toBe(false);
    expect(options.every((option) => option.text.length <= 180)).toBe(true);
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

  it('prefers exact option-id matches before normalized fallback to avoid ambiguous runtime collisions', () => {
    const options = [
      { id: 'dup-option', cardId: 'c1', text: 'exact', isCorrect: true },
      { id: ' dup-option ', cardId: 'c2', text: 'trim-collision', isCorrect: false },
    ];

    const selected = findQuizOptionById(options, 'dup-option');

    expect(selected?.id).toBe('dup-option');
    expect(selected?.cardId).toBe('c1');
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

  it('preserves the exact locked option id when trimmed collisions exist', () => {
    const options = [
      { id: 'dup-option', cardId: 'c1', text: 'exact', isCorrect: true },
      { id: ' dup-option ', cardId: 'c2', text: 'trim-collision', isCorrect: false },
    ];

    const locked = resolveLockedQuizSelection(options, ' dup-option ', 'dup-option');

    expect(locked).toBe(' dup-option ');
    expect(findQuizOptionById(options, locked)?.cardId).toBe('c2');
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

  it('does not throw when runtime card meaning getters throw during distractor generation', () => {
    const targetCard = createCard('getter-target', 'anchor', 'to fix firmly in place');
    const throwingMeaningCard = createCard('getter-throw-meaning', 'pin', 'to fasten with a pin');
    Object.defineProperty(throwingMeaningCard, 'meaning', {
      get() {
        throw new Error('bad runtime meaning getter');
      },
    });
    const deckWithThrowingGetter = [
      targetCard,
      throwingMeaningCard,
      createCard('getter-c3', 'clip', 'to hold together'),
      createCard('getter-c4', 'bind', 'to tie tightly'),
      createCard('getter-c5', 'moor', 'to secure a boat with ropes'),
    ] as Card[];

    expect(() => generateDistractors(targetCard, deckWithThrowingGetter, 3)).not.toThrow();
    const distractors = generateDistractors(targetCard, deckWithThrowingGetter, 3);
    expect(distractors).toHaveLength(3);
    expect(distractors.some((card) => card.id === 'getter-throw-meaning')).toBe(false);
  });

  it('does not throw when runtime card id getters throw during option composition', () => {
    const targetCard = createCard('getter-target-options', 'anchor', 'to fix firmly in place');
    const throwingIdCard = createCard('getter-throw-id', 'pin', 'to fasten with a pin');
    Object.defineProperty(throwingIdCard, 'id', {
      get() {
        throw new Error('bad runtime id getter');
      },
    });
    const deckWithThrowingId = [
      targetCard,
      throwingIdCard,
      createCard('getter-o3', 'clip', 'to hold together'),
      createCard('getter-o4', 'bind', 'to tie tightly'),
      createCard('getter-o5', 'moor', 'to secure a boat with ropes'),
    ] as Card[];

    expect(() => composeQuizOptions(targetCard, deckWithThrowingId, 'getter-id-seed')).not.toThrow();
    const options = composeQuizOptions(targetCard, deckWithThrowingId, 'getter-id-seed');
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it('excludes placeholder and blank meanings from distractor choices', () => {
    const deckWithInvalidMeanings = [
      createCard('target-clean', 'anchor', 'to fix firmly in place'),
      createCard('bad-1', 'blank', '   '),
      createCard('bad-2', 'placeholder', '[invalid meaning]'),
      createCard('good-1', 'pin', 'to fasten with a pin'),
      createCard('good-2', 'clip', 'to hold together'),
      createCard('good-3', 'bind', 'to tie tightly'),
    ];

    const distractors = generateDistractors(deckWithInvalidMeanings[0], deckWithInvalidMeanings, 3);
    const options = composeQuizOptions(deckWithInvalidMeanings[0], deckWithInvalidMeanings, 'invalid-meaning-seed');

    expect(distractors).toHaveLength(3);
    expect(distractors.some((card) => card.id === 'bad-1')).toBe(false);
    expect(distractors.some((card) => card.id === 'bad-2')).toBe(false);
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

  it('normalizes malformed string ratings for correct selections to neutral Good', () => {
    expect(resolveMultipleChoiceRating('0x4' as unknown as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating('Infinity' as unknown as Rating, true)).toBe(3);
  });

  it('accepts scientific-notation string ratings for correct selections', () => {
    expect(resolveMultipleChoiceRating('1e0' as unknown as Rating, true)).toBe(1);
    expect(resolveMultipleChoiceRating('2e0' as unknown as Rating, true)).toBe(2);
    expect(resolveMultipleChoiceRating('3e0' as unknown as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating('4e0' as unknown as Rating, true)).toBe(4);
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

  it('accepts small floating-point drift in correct-selection ratings', () => {
    expect(resolveMultipleChoiceRating(2.0000004 as Rating, true)).toBe(2);
    expect(resolveMultipleChoiceRating(3.9999996 as Rating, true)).toBe(4);
  });

  it('accepts scheduler-tolerated floating-point drift in correct-selection ratings', () => {
    expect(resolveMultipleChoiceRating(2.00005 as Rating, true)).toBe(2);
    expect(resolveMultipleChoiceRating(3.99995 as Rating, true)).toBe(4);
  });

  it('keeps larger fractional drift as neutral Good for correct selections', () => {
    expect(resolveMultipleChoiceRating(2.0002 as Rating, true)).toBe(3);
    expect(resolveMultipleChoiceRating(3.999 as Rating, true)).toBe(3);
  });

  it('locks mode switching while review is busy regardless of mode', () => {
    expect(isStudyModeSwitchLocked('flashcard', false, true)).toBe(true);
    expect(isStudyModeSwitchLocked('multiple-choice', false, true)).toBe(true);
  });

  it('locks study mode switching after a multiple-choice answer is selected', () => {
    expect(isStudyModeSwitchLocked('multiple-choice', true, false)).toBe(true);
  });

  it('does not lock study mode switching for flashcard mode with no active review', () => {
    expect(isStudyModeSwitchLocked('flashcard', true, false)).toBe(false);
    expect(isStudyModeSwitchLocked('flashcard', false, false)).toBe(false);
    expect(isStudyModeSwitchLocked('multiple-choice', false, false)).toBe(false);
  });
});
