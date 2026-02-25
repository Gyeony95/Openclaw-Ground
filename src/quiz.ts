import { Card, Rating } from './types';
import { parseRuntimeRatingValue, RATING_INTEGER_TOLERANCE } from './utils/rating';
import { normalizeBoundedText } from './utils/text';
import { MEANING_MAX_LENGTH } from './scheduler/constants';

export interface QuizOption {
  id: string;
  cardId: string;
  text: string;
  isCorrect: boolean;
}

const INVALID_MEANING_PLACEHOLDER = '[invalid meaning]';
export type StudyMode = 'flashcard' | 'multiple-choice';

function fallbackRatingForState(state?: Card['state']): Rating {
  // Keep malformed/unknown state fallbacks conservative to avoid accidental promotions.
  return normalizeStateForFallback(state) === 'review' ? 3 : 1;
}

function normalizeStateForFallback(state: unknown): Card['state'] | null {
  if (state === 'review' || state === 'learning' || state === 'relearning') {
    return state;
  }
  if (typeof state !== 'string') {
    return null;
  }
  const normalized = state.trim().toLowerCase();
  if (normalized === 'rev') {
    return 'review';
  }
  if (normalized === 'review' || normalized === 'learning' || normalized === 'relearning') {
    return normalized;
  }
  const folded = normalized.replace(/[\s_-]+/g, '');
  if (folded === 'review') {
    return 'review';
  }
  if (folded === 'rev') {
    return 'review';
  }
  if (folded === 'learning' || folded === 'learn') {
    return 'learning';
  }
  if (folded === 'relearning' || folded === 'relearn') {
    return 'relearning';
  }
  const alphaFolded = normalized.replace(/[^a-z]+/g, '');
  if (alphaFolded === 'review') {
    return 'review';
  }
  if (alphaFolded === 'rev') {
    return 'review';
  }
  if (alphaFolded === 'learning' || alphaFolded === 'learn') {
    return 'learning';
  }
  if (alphaFolded === 'relearning' || alphaFolded === 'relearn') {
    return 'relearning';
  }
  return null;
}

function normalizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionText(value: unknown): string {
  const normalized = normalizeBoundedText(value, MEANING_MAX_LENGTH);
  return normalized.length > 0 ? normalized : INVALID_MEANING_PLACEHOLDER;
}

function isInvalidOptionText(value: unknown): boolean {
  return normalizeOptionText(value) === INVALID_MEANING_PLACEHOLDER;
}

function safeOptionId(option: unknown): string | null {
  if (!option || typeof option !== 'object') {
    return null;
  }
  try {
    const id = (option as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function safeNormalizedOptionId(option: unknown): string | null {
  const raw = safeOptionId(option);
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasValidQuizSelection(selectedOptionId: string | null, options: QuizOption[]): boolean {
  return findQuizOptionById(options, selectedOptionId) !== undefined;
}

export function findQuizOptionById(
  options: QuizOption[],
  selectedOptionId: string | null,
): QuizOption | undefined {
  if (typeof selectedOptionId !== 'string') {
    return undefined;
  }
  const normalizedSelectedId = selectedOptionId.trim();
  if (normalizedSelectedId.length === 0) {
    return undefined;
  }
  const exactMatch = options.find((option) => {
    const rawOptionId = safeOptionId(option);
    return rawOptionId === selectedOptionId && rawOptionId.trim().length > 0;
  });
  if (exactMatch) {
    return exactMatch;
  }
  return options.find((option) => {
    const optionId = safeNormalizedOptionId(option);
    return optionId === normalizedSelectedId;
  });
}

export function resolveLockedQuizSelection(
  options: QuizOption[],
  currentSelectedOptionId: string | null,
  requestedOptionId: string,
): string | null {
  const current = findQuizOptionById(options, currentSelectedOptionId);
  if (current) {
    return current.id;
  }
  const requested = findQuizOptionById(options, requestedOptionId);
  return requested ? requested.id : null;
}

export function resolveMultipleChoiceRating(
  requestedRating: Rating,
  selectionIsCorrect: boolean,
  currentState?: Card['state'],
): Rating {
  if (selectionIsCorrect) {
    const parsedRequestedRating = parseRuntimeRatingValue(requestedRating);
    const roundedRating = Math.round(parsedRequestedRating);

    if (
      !Number.isFinite(parsedRequestedRating) ||
      Math.abs(parsedRequestedRating - roundedRating) > RATING_INTEGER_TOLERANCE ||
      roundedRating < 1 ||
      roundedRating > 4
    ) {
      // Align malformed quiz ratings with scheduler safety by phase.
      return fallbackRatingForState(currentState);
    }
    return roundedRating as Rating;
  }
  // In objective quiz mode, incorrect recognition should always log as a failed recall.
  return 1;
}

export function isStudyModeSwitchLocked(currentMode: StudyMode, hasQuizSelection: boolean, reviewBusy: boolean): boolean {
  if (reviewBusy) {
    return true;
  }
  // Once an answer is picked in objective mode, keep the mode fixed until the review is rated
  // so failed recognition cannot bypass the forced-again FSRS mapping.
  return currentMode === 'multiple-choice' && hasQuizSelection;
}

type PosTag = 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';
const LETTER_SEQUENCE_RE = '[\\p{L}\\p{M}]+';
const ADVERB_RE = new RegExp(`\\b${LETTER_SEQUENCE_RE}ly\\b`, 'u');
const ADJECTIVE_RE = new RegExp(
  `\\b${LETTER_SEQUENCE_RE}(?:ous|ive|able|ible|al|ic|ish|less|ful|ary)\\b`,
  'u',
);

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'on',
  'in',
  'at',
  'from',
  'by',
  'with',
  'and',
  'or',
  'that',
  'this',
  'is',
  'are',
  'be',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function uniqueTokens(value: string): Set<string> {
  return new Set(tokenize(value));
}

export function normalizedTokenOverlap(left: string, right: string): number {
  const a = uniqueTokens(left);
  const b = uniqueTokens(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : overlap / union;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const prev = new Array(right.length + 1);
  const curr = new Array(right.length + 1);

  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    const leftChar = left.charCodeAt(i - 1);
    for (let j = 1; j <= right.length; j += 1) {
      const cost = leftChar === right.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[right.length];
}

function lexicalSimilarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 0;
  }
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function inferPartOfSpeech(meaning: string): PosTag {
  const normalized = normalizeText(meaning);
  if (!normalized) {
    return 'other';
  }

  if (/^(to\s+|be\s+|become\s+)/.test(normalized)) {
    return 'verb';
  }
  if (ADVERB_RE.test(normalized)) {
    return 'adverb';
  }
  if (ADJECTIVE_RE.test(normalized)) {
    return 'adjective';
  }
  if (/^(a\s+|an\s+|the\s+|someone\s+|something\s+)/.test(normalized)) {
    return 'noun';
  }
  return 'other';
}

function closishLengthScore(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);

  const charDelta = Math.abs(a.length - b.length);
  const charMax = Math.max(a.length, b.length);
  const charScore = 1 - charDelta / Math.max(1, charMax);

  const tokenDelta = Math.abs(aTokens.length - bTokens.length);
  const tokenMax = Math.max(aTokens.length, bTokens.length, 1);
  const tokenScore = 1 - tokenDelta / tokenMax;

  return Math.max(0, Math.min(1, charScore * 0.6 + tokenScore * 0.4));
}

function hashString(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const values = [...items];
  let state = hashString(seed) || 0x9e3779b9;
  const next = () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

interface RankedCandidate {
  card: Card;
  score: number;
}

function isSameCardIdentity(target: Card, candidate: Card): boolean {
  if (candidate === target) {
    return true;
  }

  const targetId = normalizeId(safeReadCardText(target, 'id'), '');
  const candidateId = normalizeId(safeReadCardText(candidate, 'id'), '');
  const targetWord = normalizeText(safeReadCardText(target, 'word'));
  const candidateWord = normalizeText(safeReadCardText(candidate, 'word'));

  if (targetId && candidateId && targetId === candidateId) {
    // Treat ID + headword matches as the same logical card even if meaning text
    // drifted during sync/runtime corruption, so stale duplicates never appear
    // as distractors against the card being reviewed.
    if (targetWord && candidateWord) {
      return targetWord === candidateWord;
    }
    return true;
  }

  const targetMeaning = normalizeText(safeReadCardText(target, 'meaning'));
  const candidateMeaning = normalizeText(safeReadCardText(candidate, 'meaning'));
  return (
    targetWord.length > 0 &&
    candidateWord.length > 0 &&
    targetMeaning.length > 0 &&
    candidateMeaning.length > 0 &&
    candidateWord === targetWord &&
    candidateMeaning === targetMeaning
  );
}

function readCardText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeReadCardText(card: unknown, field: 'id' | 'word' | 'meaning' | 'updatedAt'): string {
  if (!card || typeof card !== 'object') {
    return '';
  }
  try {
    return readCardText((card as Record<string, unknown>)[field]);
  } catch {
    return '';
  }
}

function scoreDistractor(
  targetWord: string,
  targetMeaning: string,
  candidateWord: string,
  candidateMeaning: string,
): number {
  const meaningOverlap = normalizedTokenOverlap(targetMeaning, candidateMeaning);
  const wordOverlap = normalizedTokenOverlap(targetWord, candidateWord);
  const meaningLexical = lexicalSimilarity(targetMeaning, candidateMeaning);
  const wordLexical = lexicalSimilarity(targetWord, candidateWord);
  const lengthScore = closishLengthScore(targetMeaning, candidateMeaning);
  const samePos = inferPartOfSpeech(targetMeaning) === inferPartOfSpeech(candidateMeaning);

  let score =
    meaningOverlap * 0.45 +
    wordOverlap * 0.15 +
    meaningLexical * 0.2 +
    wordLexical * 0.1 +
    lengthScore * 0.1;

  if (samePos) {
    score += 0.12;
  }

  const targetTokenLength = tokenize(targetMeaning).length;
  const candidateTokenLength = tokenize(candidateMeaning).length;
  if (Math.abs(targetTokenLength - candidateTokenLength) <= 1) {
    score += 0.08;
  }

  return score;
}

export function generateDistractors(target: Card, deckCards: Card[], distractorCount = 3): Card[] {
  const normalizedDistractorCount =
    Number.isFinite(distractorCount) && distractorCount > 0 ? Math.floor(distractorCount) : 0;
  if (normalizedDistractorCount === 0) {
    return [];
  }
  const targetMeaningRaw = readCardText(target?.meaning);
  const targetWordRaw = readCardText(target?.word);
  const targetMeaning = normalizeText(targetMeaningRaw);
  const ranked: RankedCandidate[] = [];
  const seenNormalizedMeanings = new Set<string>();
  const selected: Card[] = [];

  for (const card of deckCards) {
    if (!card || typeof card !== 'object') {
      continue;
    }
    const candidateMeaningRaw = safeReadCardText(card, 'meaning');
    if (isInvalidOptionText(candidateMeaningRaw)) {
      continue;
    }
    if (isSameCardIdentity(target, card)) {
      continue;
    }
    const candidateMeaning = normalizeText(candidateMeaningRaw);
    if (!candidateMeaning || candidateMeaning === targetMeaning) {
      continue;
    }
    const candidateWordRaw = safeReadCardText(card, 'word');
    ranked.push({
      card,
      score: scoreDistractor(targetWordRaw, targetMeaningRaw, candidateWordRaw, candidateMeaningRaw),
    });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftId = normalizeId(safeReadCardText(left.card, 'id'), 'left-missing-id');
    const rightId = normalizeId(safeReadCardText(right.card, 'id'), 'right-missing-id');
    return leftId.localeCompare(rightId);
  });

  for (const candidate of ranked) {
    const normalized = normalizeText(safeReadCardText(candidate.card, 'meaning'));
    if (!seenNormalizedMeanings.has(normalized)) {
      seenNormalizedMeanings.add(normalized);
      selected.push(candidate.card);
    }
    if (selected.length >= normalizedDistractorCount) {
      break;
    }
  }

  // Backfill with any remaining unique meanings so objective quiz mode is available
  // even when similarity ranking cannot produce enough distinct distractors.
  if (selected.length < normalizedDistractorCount) {
    for (const card of deckCards) {
      if (!card || typeof card !== 'object') {
        continue;
      }
      if (isSameCardIdentity(target, card)) {
        continue;
      }
      if (isInvalidOptionText(safeReadCardText(card, 'meaning'))) {
        continue;
      }
      const normalized = normalizeText(safeReadCardText(card, 'meaning'));
      if (!normalized || normalized === targetMeaning || seenNormalizedMeanings.has(normalized)) {
        continue;
      }
      seenNormalizedMeanings.add(normalized);
      selected.push(card);
      if (selected.length >= normalizedDistractorCount) {
        break;
      }
    }
  }

  return selected;
}

export function composeQuizOptions(target: Card, deckCards: Card[], seed: string, distractorCount = 3): QuizOption[] {
  const distractors = generateDistractors(target, deckCards, distractorCount);
  const normalizedTargetId = normalizeId(safeReadCardText(target, 'id'), 'target-missing-id');
  const normalizedTargetUpdatedAt = normalizeId(
    safeReadCardText(target, 'updatedAt'),
    'invalid-updated-at',
  );
  const optionIdBase = `${seed}:${normalizedTargetId}:${normalizedTargetUpdatedAt}`;
  const options: QuizOption[] = [
    {
      id: `${normalizedTargetId}:correct:${hashString(`${optionIdBase}:correct`).toString(36)}`,
      cardId: normalizedTargetId,
      text: normalizeOptionText(safeReadCardText(target, 'meaning')),
      isCorrect: true,
    },
    ...distractors.map((card, index) => ({
      id: `${normalizeId(safeReadCardText(card, 'id'), `distractor-${index}`)}:distractor:${index}:${hashString(
        `${optionIdBase}:distractor:${normalizeId(safeReadCardText(card, 'id'), `distractor-${index}`)}:${normalizeOptionText(safeReadCardText(card, 'meaning'))}:${index}`,
      ).toString(36)}`,
      cardId: normalizeId(safeReadCardText(card, 'id'), `distractor-${index}`),
      text: normalizeOptionText(safeReadCardText(card, 'meaning')),
      isCorrect: false,
    })),
  ];

  return seededShuffle(options, `${seed}:${normalizedTargetId}:${normalizedTargetUpdatedAt}`);
}
