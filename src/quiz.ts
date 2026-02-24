import { Card, Rating } from './types';

export interface QuizOption {
  id: string;
  cardId: string;
  text: string;
  isCorrect: boolean;
}

function normalizeId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionText(value: unknown): string {
  if (typeof value !== 'string') {
    return '[invalid meaning]';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '[invalid meaning]';
}

export function hasValidQuizSelection(selectedOptionId: string | null, options: QuizOption[]): boolean {
  if (typeof selectedOptionId !== 'string') {
    return false;
  }
  const normalizedSelectedId = selectedOptionId.trim();
  if (normalizedSelectedId.length === 0) {
    return false;
  }
  return options.some((option) => typeof option?.id === 'string' && option.id.trim() === normalizedSelectedId);
}

export function resolveMultipleChoiceRating(requestedRating: Rating, selectionIsCorrect: boolean): Rating {
  if (selectionIsCorrect) {
    const integerTolerance = 1e-9;
    const parsedRequestedRating =
      typeof requestedRating === 'number'
        ? requestedRating
        : typeof requestedRating === 'string'
          ? Number(requestedRating.trim())
          : Number.NaN;
    const roundedRating = Math.round(parsedRequestedRating);

    if (
      !Number.isFinite(parsedRequestedRating) ||
      Math.abs(parsedRequestedRating - roundedRating) > integerTolerance ||
      roundedRating < 1 ||
      roundedRating > 4
    ) {
      // Runtime-corrupted quiz ratings should resolve to a neutral review signal.
      return 3;
    }
    return roundedRating as Rating;
  }
  // In objective quiz mode, incorrect recognition should always log as a failed recall.
  return 1;
}

type PosTag = 'noun' | 'verb' | 'adjective' | 'adverb' | 'other';

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
    .replace(/[^a-z0-9\s]/g, ' ')
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
  if (/\bly\b|\w+ly$/.test(normalized)) {
    return 'adverb';
  }
  if (/\b\w+(ous|ive|able|ible|al|ic|ish|less|ful|ary)$/.test(normalized)) {
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

  const charDelta = Math.abs(a.length - b.length);
  const charMax = Math.max(a.length, b.length);
  const charScore = 1 - charDelta / Math.max(1, charMax);

  const tokenDelta = Math.abs(tokenize(a).length - tokenize(b).length);
  const tokenMax = Math.max(tokenize(a).length, tokenize(b).length, 1);
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

function scoreDistractor(target: Card, candidate: Card): number {
  const meaningOverlap = normalizedTokenOverlap(target.meaning, candidate.meaning);
  const wordOverlap = normalizedTokenOverlap(target.word, candidate.word);
  const meaningLexical = lexicalSimilarity(target.meaning, candidate.meaning);
  const wordLexical = lexicalSimilarity(target.word, candidate.word);
  const lengthScore = closishLengthScore(target.meaning, candidate.meaning);
  const samePos = inferPartOfSpeech(target.meaning) === inferPartOfSpeech(candidate.meaning);

  let score =
    meaningOverlap * 0.45 +
    wordOverlap * 0.15 +
    meaningLexical * 0.2 +
    wordLexical * 0.1 +
    lengthScore * 0.1;

  if (samePos) {
    score += 0.12;
  }

  const targetTokenLength = tokenize(target.meaning).length;
  const candidateTokenLength = tokenize(candidate.meaning).length;
  if (Math.abs(targetTokenLength - candidateTokenLength) <= 1) {
    score += 0.08;
  }

  return score;
}

export function generateDistractors(target: Card, deckCards: Card[], distractorCount = 3): Card[] {
  const targetMeaning = normalizeText(target.meaning);
  const ranked: RankedCandidate[] = [];
  const seenNormalizedMeanings = new Set<string>();
  const selected: Card[] = [];

  for (const card of deckCards) {
    if (card.id === target.id) {
      continue;
    }
    const candidateMeaning = normalizeText(card.meaning);
    if (!candidateMeaning || candidateMeaning === targetMeaning) {
      continue;
    }
    ranked.push({ card, score: scoreDistractor(target, card) });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftId = normalizeId(left.card?.id, 'left-missing-id');
    const rightId = normalizeId(right.card?.id, 'right-missing-id');
    return leftId.localeCompare(rightId);
  });

  for (const candidate of ranked) {
    const normalized = normalizeText(candidate.card.meaning);
    if (!seenNormalizedMeanings.has(normalized)) {
      seenNormalizedMeanings.add(normalized);
      selected.push(candidate.card);
    }
    if (selected.length >= distractorCount) {
      break;
    }
  }

  // Backfill with any remaining unique meanings so objective quiz mode is available
  // even when similarity ranking cannot produce enough distinct distractors.
  if (selected.length < distractorCount) {
    for (const card of deckCards) {
      if (card.id === target.id) {
        continue;
      }
      const normalized = normalizeText(card.meaning);
      if (!normalized || normalized === targetMeaning || seenNormalizedMeanings.has(normalized)) {
        continue;
      }
      seenNormalizedMeanings.add(normalized);
      selected.push(card);
      if (selected.length >= distractorCount) {
        break;
      }
    }
  }

  return selected;
}

export function composeQuizOptions(target: Card, deckCards: Card[], seed: string, distractorCount = 3): QuizOption[] {
  const distractors = generateDistractors(target, deckCards, distractorCount);
  const normalizedTargetId = normalizeId(target?.id, 'target-missing-id');
  const normalizedTargetUpdatedAt = typeof target?.updatedAt === 'string' ? target.updatedAt : 'invalid-updated-at';
  const optionIdBase = `${seed}:${normalizedTargetId}:${normalizedTargetUpdatedAt}`;
  const options: QuizOption[] = [
    {
      id: `${normalizedTargetId}:correct:${hashString(`${optionIdBase}:correct`).toString(36)}`,
      cardId: normalizedTargetId,
      text: normalizeOptionText(target?.meaning),
      isCorrect: true,
    },
    ...distractors.map((card, index) => ({
      id: `${normalizeId(card?.id, `distractor-${index}`)}:distractor:${index}:${hashString(
        `${optionIdBase}:distractor:${normalizeId(card?.id, `distractor-${index}`)}:${normalizeOptionText(card?.meaning)}:${index}`,
      ).toString(36)}`,
      cardId: normalizeId(card?.id, `distractor-${index}`),
      text: normalizeOptionText(card?.meaning),
      isCorrect: false,
    })),
  ];

  return seededShuffle(options, `${seed}:${normalizedTargetId}:${normalizedTargetUpdatedAt}`);
}
