import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { MetricCard } from './src/components/MetricCard';
import { RatingRow } from './src/components/RatingRow';
import { MEANING_MAX_LENGTH, NOTES_MAX_LENGTH, WORD_MAX_LENGTH } from './src/scheduler/constants';
import {
  countOverdueCards,
  countScheduleRepairCards,
  countUpcomingDueCards,
  findNextUpcomingCard,
  hasScheduleRepairNeed,
  useDeck,
} from './src/hooks';
import { previewIntervals } from './src/scheduler/fsrs';
import { FlashcardSide, flipFlashcardSide, getFlashcardVisibility } from './src/flashcard';
import {
  composeQuizOptions,
  findQuizOptionById,
  hasValidQuizSelection,
  isStudyModeSwitchLocked,
  StudyMode,
  resolveLockedQuizSelection,
  resolveMultipleChoiceRating,
} from './src/quiz';
import { colors, radii } from './src/theme';
import { formatDueLabel } from './src/utils/due';
import { formatIntervalLabel } from './src/utils/interval';
import { dueUrgency, queueTone } from './src/utils/scheduleStatus';
import { normalizeBoundedText } from './src/utils/text';
import { isIsoDateTime } from './src/utils/time';
import { queueLoadStatusLabel } from './src/utils/queue';
import { Rating, ReviewState } from './src/types';

const INVALID_MEANING_PLACEHOLDER = '[invalid meaning]';

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stateConfig(state: ReviewState): { tone: string; label: string } {
  if (state === 'review') {
    return { tone: colors.success, label: 'Review' };
  }
  if (state === 'relearning') {
    return { tone: colors.danger, label: 'Relearning' };
  }
  return { tone: colors.warn, label: 'Learning' };
}

function formatIsoStamp(iso?: string): string | null {
  const normalizedIso = typeof iso === 'string' ? iso.trim() : '';
  if (!normalizedIso || !isIsoDateTime(normalizedIso)) {
    return null;
  }
  try {
    const stampDate = new Date(normalizedIso);
    if (!Number.isFinite(stampDate.getTime())) {
      return null;
    }
    const currentYear = new Date().getFullYear();
    const includeYear = stampDate.getFullYear() !== currentYear;
    const stamp = stampDate.toLocaleString([], {
      year: includeYear ? 'numeric' : undefined,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return stamp || null;
  } catch {
    return null;
  }
}

function reviewedAtLabel(lastReviewedAt?: string): string {
  const stamp = formatIsoStamp(lastReviewedAt);
  if (!stamp) {
    return 'No review history yet';
  }
  return `Last review ${stamp}`;
}

function cardActivityLabel(updatedAt?: string, reps = 0): string {
  const stamp = formatIsoStamp(updatedAt);
  if (!stamp) {
    return 'Schedule activity unavailable';
  }
  return reps > 0 ? `Last review ${stamp}` : `Created ${stamp}`;
}

function exactDateLabel(iso?: string): string {
  const stamp = formatIsoStamp(iso);
  if (!stamp) {
    return 'Schedule unavailable';
  }
  return stamp;
}

function asOfLabel(iso: string): string {
  const stamp = formatIsoStamp(iso);
  if (!stamp) {
    return 'Clock unavailable';
  }
  return `As of ${stamp}`;
}

function formatMetricNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function formatCountLabel(length: number, max: number): string {
  const safeLength = Math.max(0, Math.min(max, length));
  const remaining = Math.max(0, max - length);
  if (remaining === 0) {
    return `Limit reached · ${safeLength.toLocaleString()}/${max.toLocaleString()}`;
  }
  const suffix = remaining === 1 ? 'char left' : 'chars left';
  return `${remaining.toLocaleString()} ${suffix} · ${safeLength.toLocaleString()}/${max.toLocaleString()}`;
}

function trimmedLength(value: string, max: number): number {
  return normalizeBoundedText(value, max).length;
}

function formatQueueShareLabel(dueNow: number, total: number): string {
  if (total <= 0) {
    return 'No cards yet';
  }
  const boundedDueNow = Math.min(total, Math.max(0, dueNow));
  if (boundedDueNow === 0) {
    const totalLabel = total === 1 ? 'card' : 'cards';
    return `Queue clear · ${total.toLocaleString()} ${totalLabel}`;
  }
  if (boundedDueNow === total) {
    const totalLabel = total === 1 ? 'card' : 'cards';
    return `All ${total.toLocaleString()} ${totalLabel} due`;
  }
  const dueLabel = boundedDueNow === 1 ? 'due card' : 'due cards';
  const totalLabel = total === 1 ? 'card' : 'cards';
  return `${boundedDueNow.toLocaleString()} ${dueLabel} / ${total.toLocaleString()} ${totalLabel}`;
}

function formatReviewQueueLabel(dueNow: number): string {
  const boundedDueNow = Math.max(0, dueNow);
  const dueLabel = boundedDueNow === 1 ? 'due card' : 'due cards';
  return `${boundedDueNow.toLocaleString()} ${dueLabel} in queue`;
}

function formatQueuePositionLabel(position: number, total: number): string {
  return `Card ${position.toLocaleString()} of ${total.toLocaleString()}`;
}

function formatRemainingQueueLabel(remaining: number): string {
  if (remaining <= 0) {
    return 'Last card in queue';
  }
  return `${remaining.toLocaleString()} ${remaining === 1 ? 'card' : 'cards'} remain`;
}

function hasValidIso(value?: string): boolean {
  return typeof value === 'string' && isIsoDateTime(value.trim());
}

export default function App() {
  const { loading, cards, dueCards, stats, addCard, reviewDueCard, clockIso, lastReviewedAt } = useDeck();
  const { width } = useWindowDimensions();
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [notes, setNotes] = useState('');
  const [studyMode, setStudyMode] = useState<StudyMode>('flashcard');
  const [flashcardSide, setFlashcardSide] = useState<FlashcardSide>('front');
  const [selectedQuizOptionId, setSelectedQuizOptionId] = useState<string | null>(null);
  const [pendingReviewCardKey, setPendingReviewCardKey] = useState<string | null>(null);
  const [isAddBusy, setIsAddBusy] = useState(false);
  const [isAddLocked, setIsAddLocked] = useState(false);
  const [addAttempted, setAddAttempted] = useState(false);
  const [showAddSuccess, setShowAddSuccess] = useState(false);
  const [addActionError, setAddActionError] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<'word' | 'meaning' | 'notes' | null>(null);
  const [entryAnim] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollView>(null);
  const wordInputRef = useRef<TextInput>(null);
  const meaningInputRef = useRef<TextInput>(null);
  const notesInputRef = useRef<TextInput>(null);
  const reviewLockRef = useRef(false);
  const addLockRef = useRef(false);
  const addUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousHadDueCardRef = useRef(false);
  const quizSelectionLockRef = useRef(false);

  const dueCard = dueCards[0];
  const nextDueCard = dueCards[1];
  const dueQueueCount = dueCards.length;
  const dueNeedsRepair = dueCard ? hasScheduleRepairNeed(dueCard) : false;
  const nextDueNeedsRepair = nextDueCard ? hasScheduleRepairNeed(nextDueCard) : false;
  const retentionScore = useMemo(() => {
    if (stats.total === 0) {
      return 0;
    }
    return clampPercent(((stats.review + stats.relearning * 0.5 + stats.learning * 0.2) / stats.total) * 100);
  }, [stats]);
  const nextUpcomingCard = useMemo(() => {
    return findNextUpcomingCard(cards, clockIso, clockIso);
  }, [cards, clockIso]);
  const scheduleRepairCount = useMemo(() => countScheduleRepairCards(cards), [cards]);
  const retentionBarWidth = `${retentionScore}%`;
  const retentionTone =
    retentionScore >= 80 ? colors.success : retentionScore >= 50 ? colors.primary : colors.warn;
  const queueLabel = loading
    ? 'Loading'
    : dueCard
      ? !dueNeedsRepair && hasValidIso(dueCard.dueAt)
        ? formatDueLabel(dueCard.dueAt, clockIso)
        : 'Needs schedule repair'
      : scheduleRepairCount > 0
        ? 'Repair backlog'
        : 'Queue clear';
  const nextUpcomingLabel = loading
    ? '--'
    : nextUpcomingCard
      ? `Next ${formatDueLabel(nextUpcomingCard.dueAt, clockIso)}`
      : scheduleRepairCount > 0
        ? 'Next card needs schedule repair'
        : 'No upcoming card';
  const queueLabelTone = queueTone({
    dueAt: dueCard?.dueAt,
    clockIso,
    loading,
    hasDueCard: Boolean(dueCard),
    needsRepair: dueNeedsRepair,
    hasPendingRepairs: scheduleRepairCount > 0,
  });
  const queueShareLabel = loading
    ? '--'
    : formatQueueShareLabel(dueQueueCount, stats.total);
  const queueProgressPercent = loading || stats.total === 0 ? 0 : clampPercent((dueQueueCount / stats.total) * 100);
  const queueProgressWidth = `${queueProgressPercent}%`;
  const queueLoadStatus = queueLoadStatusLabel(queueProgressPercent, scheduleRepairCount, stats.total);
  const dueWithinDay = useMemo(() => {
    return countUpcomingDueCards(cards, clockIso, 24, clockIso);
  }, [cards, clockIso]);
  const queueProgressMeta = loading
    ? '--'
    : scheduleRepairCount > 0
      ? `${queueShareLabel} · ${dueWithinDay.toLocaleString()} due in next 24h · ${scheduleRepairCount.toLocaleString()} ${scheduleRepairCount === 1 ? 'repair needed' : 'repairs needed'}`
      : `${queueShareLabel} · ${dueWithinDay.toLocaleString()} due in next 24h`;
  const queueProgressMetaCompact = loading
    ? '--'
    : scheduleRepairCount > 0
      ? stats.total <= 0
        ? `${scheduleRepairCount.toLocaleString()} ${scheduleRepairCount === 1 ? 'repair pending' : 'repairs pending'}`
        : `${dueQueueCount.toLocaleString()}/${stats.total.toLocaleString()} due · ${scheduleRepairCount.toLocaleString()} ${scheduleRepairCount === 1 ? 'repair' : 'repairs'}`
      : stats.total === 0
      ? 'No cards yet'
      : `${dueQueueCount.toLocaleString()}/${stats.total.toLocaleString()} due · ${dueWithinDay.toLocaleString()} next 24h`;
  const queueProgressTone = loading
    ? colors.primary
    : scheduleRepairCount > 0
      ? colors.warn
      : queueProgressPercent >= 80
      ? colors.danger
      : queueProgressPercent >= 50
        ? colors.warn
        : colors.success;
  const queueProgressMetaTone = loading || scheduleRepairCount === 0 ? colors.subInk : colors.warn;
  const reviewQueueLabel = loading
    ? '--'
    : dueCard
      ? formatReviewQueueLabel(dueQueueCount)
      : queueShareLabel;
  const followUpQueueLabel = loading
    ? '--'
    : nextDueCard
      ? nextDueNeedsRepair || !hasValidIso(nextDueCard.dueAt)
        ? 'Then needs schedule repair'
        : `Then ${formatDueLabel(nextDueCard.dueAt, clockIso)}`
      : 'No second card queued';
  const queuePositionLabel = loading
    ? '--'
    : dueCard
      ? formatQueuePositionLabel(1, Math.max(1, dueQueueCount))
      : 'Queue empty';
  const remainingQueueLabel = loading
    ? '--'
    : dueCard
      ? formatRemainingQueueLabel(Math.max(0, dueQueueCount - 1))
      : 'No cards remaining';
  const overdueNow = useMemo(() => {
    return countOverdueCards(cards, clockIso, clockIso);
  }, [cards, clockIso]);
  const overdueQueueLabel = loading
    ? '--'
    : overdueNow === 0
      ? 'No overdue cards'
      : `${overdueNow.toLocaleString()} overdue`;
  const scheduleRepairLabel = loading
    ? '--'
    : scheduleRepairCount === 0
      ? 'Schedules healthy'
      : `${scheduleRepairCount.toLocaleString()} schedule ${scheduleRepairCount === 1 ? 'repair' : 'repairs'}`;
  const dueCardWord = dueCard ? normalizeBoundedText(dueCard.word, WORD_MAX_LENGTH) || '[invalid word]' : '[no card]';
  const dueCardMeaning = dueCard
    ? normalizeBoundedText(dueCard.meaning, MEANING_MAX_LENGTH) || INVALID_MEANING_PLACEHOLDER
    : '[no answer]';
  const dueCardNotes = dueCard ? normalizeBoundedText(dueCard.notes ?? '', NOTES_MAX_LENGTH) : '';
  const exactDueLabel = dueNeedsRepair ? 'Schedule repair pending' : exactDateLabel(dueCard?.dueAt);
  const relativeDueLabel = dueCard
    ? !dueNeedsRepair && hasValidIso(dueCard.dueAt)
      ? formatDueLabel(dueCard.dueAt, clockIso)
      : 'Review to repair schedule'
    : 'Schedule unavailable';
  const asOf = asOfLabel(clockIso);
  const emptyQueueTitle =
    scheduleRepairCount > 0
      ? `No cards due right now. ${scheduleRepairCount.toLocaleString()} schedule ${
          scheduleRepairCount === 1 ? 'repair' : 'repairs'
        } pending.`
      : 'No cards due. Add new words below.';
  const emptyQueueActionLabel = scheduleRepairCount > 0 ? 'Add more words' : 'Start adding words';
  const dueCardStateConfig = dueCard
    ? dueNeedsRepair
      ? { tone: colors.warn, label: 'Repair' }
      : stateConfig(dueCard.state)
    : null;
  const dueCardUrgency = dueUrgency({
    dueAt: dueCard?.dueAt,
    clockIso,
    needsRepair: dueNeedsRepair,
  });
  const ratingIntervals = useMemo(() => {
    if (!dueCard) {
      return null;
    }
    try {
      return previewIntervals(dueCard, clockIso);
    } catch {
      // Keep the review surface interactive even if preview math fails for malformed runtime data.
      return null;
    }
  }, [clockIso, dueCard]);
  const dueCardRevealKey = dueCard
    ? `${dueCard.id}:${dueCard.updatedAt}:${dueCard.dueAt}:${dueCard.state}:${dueCard.reps}:${dueCard.lapses}`
    : 'none';
  const quizSeed = dueCard ? `${dueCard.id}:${dueCard.updatedAt}` : 'none';
  const quizOptions = useMemo(() => (dueCard ? composeQuizOptions(dueCard, cards, quizSeed, 3) : []), [cards, dueCard, quizSeed]);
  const correctQuizOption = useMemo(() => quizOptions.find((option) => option.isCorrect), [quizOptions]);
  const correctQuizOptionText =
    normalizeBoundedText(correctQuizOption?.text ?? '', MEANING_MAX_LENGTH) || '[answer unavailable]';
  const hasValidMeaningForMultipleChoice =
    dueCardMeaning !== INVALID_MEANING_PLACEHOLDER &&
    correctQuizOptionText !== INVALID_MEANING_PLACEHOLDER &&
    correctQuizOptionText !== '[answer unavailable]';
  const canUseMultipleChoice = quizOptions.length === 4 && hasValidMeaningForMultipleChoice;
  const missingQuizOptions = Math.max(0, 4 - quizOptions.length);
  const multipleChoiceRequirementLabel =
    !hasValidMeaningForMultipleChoice
      ? 'Current card meaning is malformed. Use flashcard mode for this review.'
      : missingQuizOptions > 0
        ? `Need ${missingQuizOptions.toLocaleString()} more distinct ${
            missingQuizOptions === 1 ? 'card meaning' : 'card meanings'
          } for multiple-choice mode.`
        : null;
  const normalizedSelectedQuizOption = useMemo(
    () => findQuizOptionById(quizOptions, selectedQuizOptionId),
    [quizOptions, selectedQuizOptionId],
  );
  const normalizedSelectedQuizOptionId = normalizedSelectedQuizOption?.id ?? null;
  const selectedQuizOptionIndex = useMemo(() => {
    if (!normalizedSelectedQuizOptionId) {
      return -1;
    }
    return quizOptions.findIndex((option) => option.id === normalizedSelectedQuizOptionId);
  }, [normalizedSelectedQuizOptionId, quizOptions]);
  const selectedQuizOptionLetter =
    selectedQuizOptionIndex >= 0 && selectedQuizOptionIndex < 26
      ? String.fromCharCode(65 + selectedQuizOptionIndex)
      : null;
  const hasQuizSelection = normalizedSelectedQuizOption !== undefined;
  const quizSelectionLocked = studyMode === 'multiple-choice' && hasQuizSelection;
  const quizSelectionIsCorrect = normalizedSelectedQuizOption?.isCorrect ?? false;
  const forceAgainForQuizSelection = studyMode === 'multiple-choice' && hasQuizSelection && !quizSelectionIsCorrect;
  const disabledRatingsInQuizMode = forceAgainForQuizSelection ? ([2, 3, 4] as Rating[]) : [];
  const ratingIntervalLabels = useMemo(
    () =>
      ratingIntervals
        ? {
            1: formatIntervalLabel(ratingIntervals[1]),
            2: formatIntervalLabel(ratingIntervals[2]),
            3: formatIntervalLabel(ratingIntervals[3]),
            4: formatIntervalLabel(ratingIntervals[4]),
          }
        : undefined,
    [ratingIntervals],
  );
  const visibleRatingIntervalLabels = useMemo(() => {
    if (!ratingIntervalLabels) {
      return undefined;
    }
    if (!forceAgainForQuizSelection) {
      return ratingIntervalLabels;
    }
    return {
      ...ratingIntervalLabels,
      2: 'Locked',
      3: 'Locked',
      4: 'Locked',
    };
  }, [forceAgainForQuizSelection, ratingIntervalLabels]);
  const quickRatingPreviewLabel = visibleRatingIntervalLabels
    ? forceAgainForQuizSelection
      ? `Again ${visibleRatingIntervalLabels[1]} · Hard/Good/Easy locked after incorrect choice`
      : `Again ${visibleRatingIntervalLabels[1]} · Hard ${visibleRatingIntervalLabels[2]} · Good ${visibleRatingIntervalLabels[3]} · Easy ${visibleRatingIntervalLabels[4]}`
    : null;
  const lastReviewedLabel = reviewedAtLabel(lastReviewedAt);

  const trimmedWordLength = trimmedLength(word, WORD_MAX_LENGTH);
  const trimmedMeaningLength = trimmedLength(meaning, MEANING_MAX_LENGTH);
  const normalizedWord = normalizeBoundedText(word, WORD_MAX_LENGTH);
  const normalizedMeaning = normalizeBoundedText(meaning, MEANING_MAX_LENGTH);
  const normalizedNotes = normalizeBoundedText(notes, NOTES_MAX_LENGTH);
  const wordLength = normalizedWord.length;
  const meaningLength = normalizedMeaning.length;
  const notesLength = normalizedNotes.length;
  const missingWord = trimmedWordLength === 0;
  const missingMeaning = trimmedMeaningLength === 0;
  const canAttemptAdd = useMemo(
    () => !loading && !isAddBusy && !isAddLocked,
    [isAddBusy, isAddLocked, loading],
  );
  const canAdd = useMemo(
    () => !loading && !isAddBusy && !isAddLocked && trimmedWordLength > 0 && trimmedMeaningLength > 0,
    [isAddBusy, isAddLocked, loading, trimmedWordLength, trimmedMeaningLength],
  );
  const addButtonDisabled = !canAttemptAdd || !canAdd;
  const addButtonLabel = loading
    ? 'Loading...'
    : isAddBusy
      ? 'Adding...'
      : showAddSuccess
        ? 'Added'
        : canAdd
          ? 'Add card'
          : 'Fill required fields';
  const addFormHint = loading
    ? 'Loading deck...'
    : isAddBusy
      ? 'Adding card...'
      : showAddSuccess
        ? 'Card added'
      : canAdd
        ? 'Ready to add'
        : missingWord && missingMeaning
          ? 'Word and meaning are required'
          : missingWord
            ? 'Word is required'
            : 'Meaning is required';
  const addHintTone = loading
    ? colors.subInk
    : showAddSuccess
      ? colors.success
    : canAdd
      ? colors.success
      : addAttempted
        ? colors.danger
        : colors.subInk;
  const wordRemaining = Math.max(0, WORD_MAX_LENGTH - wordLength);
  const meaningRemaining = Math.max(0, MEANING_MAX_LENGTH - meaningLength);
  const notesRemaining = Math.max(0, NOTES_MAX_LENGTH - notesLength);
  const wordCountTone = wordRemaining === 0 ? colors.danger : wordRemaining <= 12 ? colors.warn : colors.subInk;
  const meaningCountTone = meaningRemaining === 0 ? colors.danger : meaningRemaining <= 20 ? colors.warn : colors.subInk;
  const noteCountTone = notesRemaining === 0 ? colors.danger : notesRemaining <= 20 ? colors.warn : colors.subInk;
  const isWideLayout = width >= 980;
  const isCompactLayout = width < 380;
  const isReviewBusy = pendingReviewCardKey !== null && pendingReviewCardKey === dueCardRevealKey;
  const modeSwitchLocked = isStudyModeSwitchLocked(studyMode, hasQuizSelection, isReviewBusy);
  const quizOptionsLocked = isReviewBusy;
  const isFormEditable = !loading && !isAddBusy;
  const flashcardVisibility = useMemo(
    () => getFlashcardVisibility(flashcardSide, dueCardNotes.length > 0),
    [dueCardNotes, flashcardSide],
  );
  const canShowRatings = studyMode === 'flashcard' ? flashcardVisibility.showRatings : hasQuizSelection;

  useEffect(() => {
    setFlashcardSide('front');
    setSelectedQuizOptionId(null);
    setReviewActionError(null);
    quizSelectionLockRef.current = false;
  }, [dueCardRevealKey]);

  useEffect(() => {
    if (studyMode === 'multiple-choice' && dueCard && !canUseMultipleChoice) {
      setStudyMode('flashcard');
      setSelectedQuizOptionId(null);
      setFlashcardSide('front');
      setReviewActionError(null);
    }
  }, [canUseMultipleChoice, dueCard, studyMode]);

  useEffect(() => {
    if (!selectedQuizOptionId) {
      return;
    }
    if (!hasValidQuizSelection(selectedQuizOptionId, quizOptions)) {
      setSelectedQuizOptionId(null);
    }
  }, [quizOptions, selectedQuizOptionId]);

  useEffect(() => {
    quizSelectionLockRef.current = studyMode === 'multiple-choice' && hasQuizSelection;
  }, [hasQuizSelection, studyMode]);

  useEffect(() => {
    if (pendingReviewCardKey === null) {
      reviewLockRef.current = false;
      return;
    }
    if (pendingReviewCardKey !== dueCardRevealKey) {
      reviewLockRef.current = false;
      setPendingReviewCardKey(null);
      return;
    }
    const timer = setTimeout(() => {
      setPendingReviewCardKey(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [dueCardRevealKey, pendingReviewCardKey]);

  useEffect(() => {
    const animation = Animated.timing(entryAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => {
      animation.stop();
    };
  }, [entryAnim]);

  useEffect(() => {
    return () => {
      if (addUnlockTimerRef.current) {
        clearTimeout(addUnlockTimerRef.current);
      }
      if (addSuccessTimerRef.current) {
        clearTimeout(addSuccessTimerRef.current);
      }
    };
  }, []);

  function focusAddForm() {
    if (!isFormEditable) {
      return;
    }
    scrollRef.current?.scrollToEnd({ animated: true });
    requestAnimationFrame(() => {
      wordInputRef.current?.focus();
    });
  }

  useEffect(() => {
    const hasDueCardInQueue = Boolean(dueCard);
    if (loading) {
      previousHadDueCardRef.current = hasDueCardInQueue;
      return;
    }
    if (previousHadDueCardRef.current && !hasDueCardInQueue) {
      focusAddForm();
    }
    previousHadDueCardRef.current = hasDueCardInQueue;
  }, [dueCard, loading]);

  useEffect(() => {
    if (!addAttempted) {
      return;
    }
    if (!missingWord && !missingMeaning) {
      setAddAttempted(false);
    }
  }, [addAttempted, missingMeaning, missingWord]);

  useEffect(() => {
    if (showAddSuccess && (word.length > 0 || meaning.length > 0 || notes.length > 0)) {
      setShowAddSuccess(false);
    }
  }, [meaning, notes, showAddSuccess, word]);

  useEffect(() => {
    if (addActionError === null) {
      return;
    }
    setAddActionError(null);
  }, [word, meaning, notes]);

  useEffect(() => {
    if (loading || dueCard || !isFormEditable) {
      return;
    }
    const focusId = requestAnimationFrame(() => {
      wordInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusId);
  }, [dueCard, isFormEditable, loading]);

  function handleAddCard() {
    if (loading || addLockRef.current || isAddBusy) {
      return;
    }
    setAddActionError(null);
    if (!normalizedWord) {
      setShowAddSuccess(false);
      setAddAttempted(true);
      wordInputRef.current?.focus();
      return;
    }
    if (!normalizedMeaning) {
      setShowAddSuccess(false);
      setAddAttempted(true);
      meaningInputRef.current?.focus();
      return;
    }
    setAddAttempted(false);
    Keyboard.dismiss();
    addLockRef.current = true;
    setIsAddLocked(true);
    setIsAddBusy(true);
    const shouldReturnToWordInput = !dueCard;
    try {
      addCard(normalizedWord, normalizedMeaning, normalizedNotes || undefined);
    } catch {
      setShowAddSuccess(false);
      addLockRef.current = false;
      setIsAddLocked(false);
      setIsAddBusy(false);
      setAddActionError('Unable to add this card right now.');
      return;
    }
    meaningInputRef.current?.blur();
    notesInputRef.current?.blur();
    if (shouldReturnToWordInput) {
      wordInputRef.current?.focus();
    } else {
      wordInputRef.current?.blur();
    }
    setWord('');
    setMeaning('');
    setNotes('');
    setShowAddSuccess(true);
    if (addSuccessTimerRef.current) {
      clearTimeout(addSuccessTimerRef.current);
    }
    addSuccessTimerRef.current = setTimeout(() => {
      setShowAddSuccess(false);
      addSuccessTimerRef.current = null;
    }, 1400);
    if (addUnlockTimerRef.current) {
      clearTimeout(addUnlockTimerRef.current);
    }
    addUnlockTimerRef.current = setTimeout(() => {
      addLockRef.current = false;
      setIsAddLocked(false);
      setIsAddBusy(false);
      if (shouldReturnToWordInput) {
        requestAnimationFrame(() => {
          wordInputRef.current?.focus();
        });
      }
      addUnlockTimerRef.current = null;
    }, 250);
  }

  function handleRate(rating: Rating) {
    if (studyMode === 'multiple-choice' && !hasQuizSelection) {
      setReviewActionError('Select one answer first to unlock rating buttons.');
      return;
    }
    if (forceAgainForQuizSelection && rating !== 1) {
      setReviewActionError('Incorrect answer selected. Use Again to record failed recall.');
      return;
    }
    if (!dueCard || isReviewBusy || reviewLockRef.current) {
      return;
    }
    setReviewActionError(null);
    Keyboard.dismiss();
    reviewLockRef.current = true;
    const resolvedRating =
      studyMode === 'multiple-choice'
        ? resolveMultipleChoiceRating(rating, quizSelectionIsCorrect, dueCard.state)
        : rating;
    let reviewed = false;
    try {
      reviewed = reviewDueCard(dueCard.id, resolvedRating);
    } catch {
      setPendingReviewCardKey(null);
      setSelectedQuizOptionId(null);
      setFlashcardSide('front');
      quizSelectionLockRef.current = false;
      reviewLockRef.current = false;
      setReviewActionError('Unable to record this review right now.');
      return;
    }
    if (reviewed) {
      setSelectedQuizOptionId(null);
      setFlashcardSide('front');
      quizSelectionLockRef.current = false;
      setPendingReviewCardKey(dueCardRevealKey);
      return;
    }
    setSelectedQuizOptionId(null);
    setFlashcardSide('front');
    quizSelectionLockRef.current = false;
    setReviewActionError('This card is no longer due. Queue refreshed.');
    reviewLockRef.current = false;
  }

  function handleFlipFlashcard() {
    if (isReviewBusy || studyMode !== 'flashcard') {
      return;
    }
    setFlashcardSide((current) => flipFlashcardSide(current));
  }

  function handleSelectStudyMode(mode: StudyMode) {
    if (modeSwitchLocked || (studyMode === 'multiple-choice' && quizSelectionLockRef.current)) {
      return;
    }
    if (mode === 'multiple-choice' && !canUseMultipleChoice) {
      return;
    }
    setStudyMode(mode);
    setReviewActionError(null);
    if (mode === 'flashcard') {
      setSelectedQuizOptionId(null);
      setFlashcardSide('front');
    }
  }

  function handleSelectQuizOption(optionId: string) {
    if (!dueCard || isReviewBusy || studyMode !== 'multiple-choice') {
      return;
    }
    if (quizSelectionLocked && normalizedSelectedQuizOptionId && normalizedSelectedQuizOptionId !== optionId) {
      setReviewActionError('Answer is locked for this attempt. Rate this card to continue.');
      return;
    }
    setSelectedQuizOptionId((currentSelectedOptionId) => {
      const nextSelectionId = resolveLockedQuizSelection(quizOptions, currentSelectedOptionId, optionId);
      if (!nextSelectionId || !hasValidQuizSelection(nextSelectionId, quizOptions)) {
        return null;
      }
      // Lock mode switching immediately so rapid taps cannot bypass forced review rating.
      quizSelectionLockRef.current = true;
      return nextSelectionId;
    });
    setReviewActionError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.backgroundOrbA} />
      <View style={styles.backgroundOrbB} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        style={styles.safe}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Animated.View
              style={[
                styles.headerCard,
                isCompactLayout && styles.headerCardCompact,
                {
                  opacity: entryAnim,
                  transform: [
                    {
                      translateY: entryAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.headerGlowA} />
              <View style={styles.headerGlowB} />
              <Text style={styles.eyebrow}>Word Memorizer</Text>
              <Text style={styles.title} accessibilityRole="header">
                Retention Dashboard
              </Text>
              <Text style={styles.subtitle}>FSRS-inspired scheduler calibrated for consistent long-term recall.</Text>
              <View style={styles.heroTags}>
                <Text
                  style={[
                    styles.heroTag,
                    styles.heroTagPriority,
                    { color: queueLabelTone, borderColor: `${queueLabelTone}55`, backgroundColor: `${queueLabelTone}14` },
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {queueLabel}
                </Text>
                <Text style={styles.heroTag} numberOfLines={1} ellipsizeMode="tail">
                  {queueShareLabel}
                </Text>
                <Text style={styles.heroTag} numberOfLines={1} ellipsizeMode="tail">
                  {nextUpcomingLabel}
                </Text>
                {!loading && scheduleRepairCount > 0 ? (
                  <Text
                    style={[
                      styles.heroTag,
                      { color: colors.warn, borderColor: `${colors.warn}55`, backgroundColor: `${colors.warn}14` },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {scheduleRepairCount.toLocaleString()} {scheduleRepairCount === 1 ? 'repair pending' : 'repairs pending'}
                  </Text>
                ) : null}
              </View>
              <View style={styles.metaLine}>
                <Text style={styles.subMeta} numberOfLines={1} ellipsizeMode="tail">
                  {lastReviewedLabel}
                </Text>
                <Text style={styles.asOfMeta}>{asOf}</Text>
              </View>
              <View style={styles.scoreRow}>
                <View style={styles.scoreHeader}>
                  <Text style={styles.scoreLabel}>Retention score</Text>
                  <Text style={[styles.scoreValue, { color: retentionTone }]}>{retentionScore}%</Text>
                </View>
                <View
                  style={styles.scoreTrack}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Retention score"
                  accessibilityValue={{ min: 0, max: 100, now: retentionScore }}
                >
                  <View style={[styles.scoreFill, { width: retentionBarWidth, backgroundColor: retentionTone }]} />
                </View>
              </View>
            </Animated.View>

            <View style={styles.metrics}>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Due now" value={loading ? Number.NaN : dueQueueCount} accent={colors.primary} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Overdue" value={loading ? Number.NaN : overdueNow} accent={colors.danger} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Due next 24h" value={loading ? Number.NaN : dueWithinDay} accent={colors.accent} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Learning" value={loading ? Number.NaN : stats.learning} accent={colors.warn} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Review" value={loading ? Number.NaN : stats.review} accent={colors.success} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Relearning" value={loading ? Number.NaN : stats.relearning} accent={colors.danger} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard label="Total cards" value={loading ? Number.NaN : stats.total} accent={colors.accent} />
              </View>
              <View style={isCompactLayout ? styles.metricCardCompact : null}>
                <MetricCard
                  label="Needs repair"
                  value={loading ? Number.NaN : scheduleRepairCount}
                  accent={scheduleRepairCount > 0 ? colors.warn : colors.success}
                />
              </View>
            </View>

            <Animated.View
              style={[
                styles.panelGrid,
                isWideLayout && styles.panelGridWide,
                {
                  opacity: entryAnim,
                  transform: [
                    {
                      translateY: entryAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [16, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={[styles.panel, styles.reviewPanel, isCompactLayout && styles.panelCompact, isWideLayout && styles.panelWide]}>
                <View style={[styles.panelHead, isCompactLayout && styles.panelHeadCompact]}>
                  <View style={styles.panelTitleWrap}>
                    <Text style={styles.panelTitle} accessibilityRole="header">
                      Review Queue
                    </Text>
                    <Text style={styles.panelSubtitle}>Prioritized by due time and recency</Text>
                  </View>
                  <View style={[styles.panelKpiWrap, isCompactLayout && styles.panelKpiWrapCompact]}>
                    <Text
                      style={[styles.panelKpi, { color: queueLabelTone }]}
                      accessibilityLiveRegion="polite"
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {queueLabel}
                    </Text>
                    <Text style={styles.panelSubKpi} numberOfLines={1} ellipsizeMode="tail">
                      {reviewQueueLabel}
                    </Text>
                    <Text
                      style={[
                        styles.panelSubKpi,
                        overdueNow > 0 && !loading ? styles.panelSubKpiAlert : null,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {overdueQueueLabel}
                    </Text>
                    <Text style={styles.panelSubKpi} numberOfLines={1} ellipsizeMode="tail">
                      {followUpQueueLabel}
                    </Text>
                    <Text
                      style={[
                        styles.panelSubKpi,
                        scheduleRepairCount > 0 && !loading ? styles.panelSubKpiWarn : null,
                      ]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {scheduleRepairLabel}
                    </Text>
                  </View>
                </View>
                {!loading ? (
                  <View style={styles.queueProgressWrap}>
                    <View style={styles.queueProgressHeader}>
                      <Text style={styles.queueProgressLabel}>Queue load</Text>
                      <View style={styles.queueProgressValueWrap}>
                        <Text style={[styles.queueProgressStatus, { color: queueProgressTone }]}>{queueLoadStatus}</Text>
                        <Text style={styles.queueProgressValue}>{queueProgressPercent}%</Text>
                      </View>
                    </View>
                    <View
                      style={styles.queueProgressTrack}
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel="Queue load"
                      accessibilityValue={{
                        min: 0,
                        max: 100,
                        now: queueProgressPercent,
                        text: `${queueLoadStatus}, ${queueProgressPercent}%`,
                      }}
                    >
                      <View style={[styles.queueProgressFill, { width: queueProgressWidth, backgroundColor: queueProgressTone }]} />
                    </View>
                    <Text
                      style={[styles.queueProgressMeta, { color: queueProgressMetaTone }]}
                      numberOfLines={isCompactLayout ? 3 : 2}
                      ellipsizeMode="tail"
                      accessibilityRole="status"
                      accessibilityLiveRegion="polite"
                    >
                      {isCompactLayout ? queueProgressMetaCompact : queueProgressMeta}
                    </Text>
                  </View>
                ) : null}
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={colors.subInk} />
                    <Text style={styles.info}>Loading deck...</Text>
                  </View>
                ) : null}
                {!loading && !dueCard ? (
                  <View style={styles.emptyQueue}>
                    <Text style={styles.info}>{emptyQueueTitle}</Text>
                    {nextUpcomingCard ? (
                      <Text style={styles.emptyQueueMeta}>
                        Next card {formatDueLabel(nextUpcomingCard.dueAt, clockIso)} at{' '}
                        {exactDateLabel(nextUpcomingCard.dueAt)}
                      </Text>
                    ) : (
                      <Text style={styles.emptyQueueMeta}>No upcoming cards scheduled yet.</Text>
                    )}
                    <Pressable
                      style={({ pressed }) => [
                        styles.emptyQueueAction,
                        scheduleRepairCount > 0 && styles.emptyQueueActionRepair,
                        !isFormEditable && styles.emptyQueueActionDisabled,
                        pressed && isFormEditable && styles.ghostBtnPressed,
                      ]}
                      onPress={focusAddForm}
                      disabled={!isFormEditable}
                      accessibilityRole="button"
                      accessibilityLabel={emptyQueueActionLabel}
                      accessibilityHint="Scrolls to the add form and focuses the word input"
                      accessibilityState={{ disabled: !isFormEditable }}
                    >
                      <Text style={styles.emptyQueueActionText}>{emptyQueueActionLabel}</Text>
                      <Text style={styles.emptyQueueActionSubText}>Jump to add form</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!loading && dueCard ? (
                  <View
                    style={[
                      styles.reviewCard,
                      isCompactLayout && styles.reviewCardCompact,
                      { borderColor: `${dueCardUrgency.tone}66` },
                      isReviewBusy && styles.reviewCardBusy,
                    ]}
                    accessible
                    accessibilityLabel={`Review card ${dueCardWord}. ${dueCardStateConfig?.label ?? 'Learning'}. ${relativeDueLabel}.`}
                    accessibilityState={{ busy: isReviewBusy || undefined }}
                  >
                    <View style={[styles.reviewTimeline, { borderColor: `${dueCardUrgency.tone}44` }]}>
                      <View style={styles.reviewTimelineHeader}>
                        <Text style={styles.reviewTimelineLabel}>Scheduled for</Text>
                        <View style={[styles.reviewUrgencyBadge, { borderColor: `${dueCardUrgency.tone}66` }]}>
                          <Text style={[styles.reviewUrgencyText, { color: dueCardUrgency.tone }]}>
                            {dueCardUrgency.label}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.reviewTimelineValue} numberOfLines={2}>
                        {exactDueLabel}
                      </Text>
                      <Text style={styles.reviewTimelineSubValue} numberOfLines={1}>
                        {relativeDueLabel}
                      </Text>
                      {dueNeedsRepair ? (
                        <Text
                          style={styles.reviewTimelineRepair}
                          accessibilityRole="status"
                          accessibilityLiveRegion="polite"
                        >
                          Schedule repair will be applied on this review.
                        </Text>
                      ) : null}
                      <Text style={styles.reviewTimelineMeta}>{cardActivityLabel(dueCard.updatedAt, dueCard.reps)}</Text>
                      <Text style={styles.reviewTimelineMeta}>{queuePositionLabel}</Text>
                      <Text style={styles.reviewTimelineMeta}>{remainingQueueLabel}</Text>
                    </View>
                    <View style={styles.studyModeToggleRow}>
                      <Pressable
                        onPress={() => handleSelectStudyMode('flashcard')}
                        disabled={modeSwitchLocked}
                        style={({ pressed }) => [
                          styles.studyModeToggleBtn,
                          studyMode === 'flashcard' && styles.studyModeToggleBtnActive,
                          modeSwitchLocked && styles.studyModeToggleBtnDisabled,
                          pressed && !modeSwitchLocked && styles.ghostBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Flashcard mode"
                        accessibilityHint={
                          isReviewBusy
                            ? 'Disabled while the current review is being recorded'
                            : quizSelectionLocked
                              ? 'Complete the locked quiz attempt first'
                            : 'Switches to flashcard mode'
                        }
                        accessibilityState={{ selected: studyMode === 'flashcard', disabled: modeSwitchLocked }}
                      >
                        <Text
                          style={[
                            styles.studyModeToggleText,
                            studyMode === 'flashcard' && styles.studyModeToggleTextActive,
                          ]}
                        >
                          Flashcard
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleSelectStudyMode('multiple-choice')}
                        disabled={modeSwitchLocked || quizSelectionLocked || !canUseMultipleChoice}
                        style={({ pressed }) => [
                          styles.studyModeToggleBtn,
                          studyMode === 'multiple-choice' && styles.studyModeToggleBtnActive,
                          (modeSwitchLocked || quizSelectionLocked || !canUseMultipleChoice) && styles.studyModeToggleBtnDisabled,
                          pressed && !modeSwitchLocked && !quizSelectionLocked && canUseMultipleChoice && styles.ghostBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Multiple-choice mode"
                        accessibilityHint={
                          isReviewBusy
                            ? 'Disabled while the current review is being recorded'
                            : quizSelectionLocked
                              ? 'Complete the locked quiz attempt first'
                            : canUseMultipleChoice
                              ? 'Switches to objective multiple-choice quiz mode'
                              : multipleChoiceRequirementLabel ?? 'Need at least four distinct card meanings'
                        }
                        accessibilityState={{
                          selected: studyMode === 'multiple-choice',
                          disabled: modeSwitchLocked || quizSelectionLocked || !canUseMultipleChoice,
                        }}
                      >
                        <Text
                          style={[
                            styles.studyModeToggleText,
                            studyMode === 'multiple-choice' && styles.studyModeToggleTextActive,
                          ]}
                        >
                          Multiple-choice
                        </Text>
                      </Pressable>
                    </View>
                    {studyMode === 'multiple-choice' && !hasQuizSelection ? (
                      <Text style={styles.studyModeHelper}>
                        {canUseMultipleChoice
                          ? 'Select one answer to unlock FSRS rating buttons.'
                          : multipleChoiceRequirementLabel ?? 'Need at least four distinct card meanings.'}
                      </Text>
                    ) : null}
                    {studyMode === 'multiple-choice' && hasQuizSelection ? (
                      <Text style={styles.studyModeHelper}>
                        First answer locked
                        {selectedQuizOptionLetter ? ` (${selectedQuizOptionLetter})` : ''}. Rate this attempt to continue.
                      </Text>
                    ) : null}
                    {studyMode === 'multiple-choice' && quickRatingPreviewLabel ? (
                      <Text style={styles.revealPreviewHint} numberOfLines={2} ellipsizeMode="tail">
                        {quickRatingPreviewLabel}
                      </Text>
                    ) : null}

                    {studyMode === 'flashcard' ? (
                      <Pressable
                        onPress={handleFlipFlashcard}
                        disabled={isReviewBusy}
                        style={({ pressed }) => [
                          styles.flashcardFace,
                          pressed && !isReviewBusy && styles.flashcardFacePressed,
                          isReviewBusy && styles.flashcardFaceDisabled,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Flashcard ${dueCardWord}. ${flashcardVisibility.showMeaning ? 'Back side showing answer.' : 'Front side showing prompt.'}`}
                        accessibilityHint="Tap to flip between word and answer"
                        accessibilityState={{ disabled: isReviewBusy, busy: isReviewBusy }}
                      >
                        <View style={styles.reviewHeader}>
                          <Text style={[styles.word, isCompactLayout && styles.wordCompact]} numberOfLines={2} ellipsizeMode="tail">
                            {dueCardWord}
                          </Text>
                          <View style={styles.reviewBadgeColumn}>
                            <Text
                              style={[
                                styles.stateBadge,
                                {
                                  color: dueCardStateConfig?.tone ?? colors.subInk,
                                  borderColor: dueCardStateConfig?.tone ?? colors.border,
                                },
                              ]}
                            >
                              {dueCardStateConfig?.label}
                            </Text>
                            <Text
                              style={[
                                styles.urgencyBadge,
                                {
                                  color: dueCardUrgency.tone,
                                  borderColor: dueCardUrgency.tone,
                                },
                              ]}
                            >
                              {dueCardUrgency.label}
                            </Text>
                          </View>
                        </View>
                        {!flashcardVisibility.showMeaning ? <Text style={styles.revealHint}>Tap card to reveal meaning.</Text> : null}
                        {!flashcardVisibility.showMeaning && quickRatingPreviewLabel ? (
                          <Text style={styles.revealPreviewHint} numberOfLines={2} ellipsizeMode="tail">
                            {quickRatingPreviewLabel}
                          </Text>
                        ) : null}
                        {flashcardVisibility.showMeaning ? <Text style={styles.meaning}>{dueCardMeaning}</Text> : null}
                        {flashcardVisibility.showExample ? <Text style={styles.notes}>{dueCardNotes}</Text> : null}
                        {flashcardVisibility.showMeaning ? (
                          dueNeedsRepair ? (
                            <View style={styles.metaRow}>
                              <Text style={[styles.metaText, styles.metaTextWarn]}>
                                Schedule repair pending
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.metaRow}>
                              <Text style={styles.metaText}>Difficulty {formatMetricNumber(dueCard.difficulty, 1)}</Text>
                              <Text style={styles.metaText}>Stability {formatMetricNumber(dueCard.stability, 2)}d</Text>
                              <Text style={styles.metaText}>
                                Reps {dueCard.reps} · Lapses {dueCard.lapses}
                              </Text>
                            </View>
                          )
                        ) : null}
                      </Pressable>
                    ) : (
                      <View style={styles.flashcardFace}>
                        <View style={styles.reviewHeader}>
                          <Text style={[styles.word, isCompactLayout && styles.wordCompact]} numberOfLines={2} ellipsizeMode="tail">
                            {dueCardWord}
                          </Text>
                          <View style={styles.reviewBadgeColumn}>
                            <Text
                              style={[
                                styles.stateBadge,
                                {
                                  color: dueCardStateConfig?.tone ?? colors.subInk,
                                  borderColor: dueCardStateConfig?.tone ?? colors.border,
                                },
                              ]}
                            >
                              {dueCardStateConfig?.label}
                            </Text>
                            <Text
                              style={[
                                styles.urgencyBadge,
                                {
                                  color: dueCardUrgency.tone,
                                  borderColor: dueCardUrgency.tone,
                                },
                              ]}
                            >
                              {dueCardUrgency.label}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.answerActionsLabel}>Choose the correct meaning</Text>
                        {!hasQuizSelection && quickRatingPreviewLabel ? (
                          <Text style={styles.quizPreviewHint} numberOfLines={2} ellipsizeMode="tail">
                            {quickRatingPreviewLabel}
                          </Text>
                        ) : null}
                        {!canUseMultipleChoice ? (
                          <Text style={styles.revealHint}>
                            {multipleChoiceRequirementLabel ?? 'Add more distinct cards to enable multiple-choice mode.'}
                          </Text>
                        ) : (
                          <View
                            style={styles.quizOptionList}
                            accessible
                            accessibilityRole="radiogroup"
                            accessibilityLabel="Meaning options"
                          >
                            {quizOptions.map((option, index) => {
                              const isSelected = normalizedSelectedQuizOptionId === option.id;
                              const showCorrect = hasQuizSelection && option.isCorrect;
                              const showIncorrect = hasQuizSelection && isSelected && !option.isCorrect;
                              const optionLetter = String.fromCharCode(65 + index);
                              const optionPrefix = showCorrect ? 'Correct: ' : showIncorrect ? 'Incorrect: ' : '';
                              const quizOptionLocked = quizOptionsLocked || quizSelectionLocked;
                              const selectionLockedByChoice = quizSelectionLocked && hasQuizSelection;
                              const quizOptionHint = quizOptionLocked
                                ? selectionLockedByChoice
                                  ? isSelected
                                    ? 'Selected answer is locked until this review is rated'
                                    : 'Another answer is locked for this attempt'
                                  : 'Answer options are temporarily unavailable'
                                : 'Select this meaning';
                              return (
                                <Pressable
                                  key={`${option.id}:${index}`}
                                  onPress={() => handleSelectQuizOption(option.id)}
                                  disabled={quizOptionLocked}
                                  style={({ pressed }) => [
                                    styles.quizOptionBtn,
                                    isSelected && styles.quizOptionBtnSelected,
                                    showCorrect && styles.quizOptionBtnCorrect,
                                    showIncorrect && styles.quizOptionBtnIncorrect,
                                    quizOptionLocked && styles.quizOptionBtnLocked,
                                    pressed && !quizOptionLocked && styles.ghostBtnPressed,
                                  ]}
                                  accessibilityRole="radio"
                                  accessibilityLabel={`${optionLetter}. ${option.text}`}
                                  accessibilityHint={quizOptionHint}
                                  accessibilityState={{
                                    selected: isSelected,
                                    checked: isSelected,
                                    disabled: quizOptionLocked,
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.quizOptionText,
                                      isSelected && styles.quizOptionTextSelected,
                                      showCorrect && styles.quizOptionTextCorrect,
                                      showIncorrect && styles.quizOptionTextIncorrect,
                                    ]}
                                    numberOfLines={3}
                                    ellipsizeMode="tail"
                                  >
                                    <Text style={styles.quizOptionLabel}>{optionLetter}. </Text>
                                    {optionPrefix}
                                    {option.text}
                                  </Text>
                                  {isSelected && hasQuizSelection ? (
                                    <Text style={styles.quizOptionSelectionTag}>Selected choice</Text>
                                  ) : null}
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                        {hasQuizSelection && correctQuizOption ? (
                          <Text
                            style={[styles.quizFeedback, { color: quizSelectionIsCorrect ? colors.success : colors.danger }]}
                            accessibilityRole="status"
                            accessibilityLiveRegion="polite"
                          >
                            {quizSelectionIsCorrect
                              ? 'Correct. Selection locked. Rate how easy this felt.'
                              : `Incorrect. Selection locked. Correct answer: ${correctQuizOptionText}. This review will be recorded as Again.`}
                          </Text>
                        ) : !canUseMultipleChoice ? null : (
                          <Text style={styles.revealHint}>Select one option to unlock FSRS rating buttons.</Text>
                        )}
                      </View>
                    )}

                    {canShowRatings ? (
                      <View style={styles.answerActions}>
                        <Text style={styles.answerActionsLabel}>Rate recall quality</Text>
                        <RatingRow
                          onRate={handleRate}
                          intervalLabels={visibleRatingIntervalLabels}
                          disabled={isReviewBusy}
                          busy={isReviewBusy}
                          disabledRatings={disabledRatingsInQuizMode}
                          lockedHint={
                            forceAgainForQuizSelection
                              ? 'Incorrect multiple-choice selection locks this rating. Use Again to record failed recall.'
                              : undefined
                          }
                        />
                        {!visibleRatingIntervalLabels ? (
                          <Text style={styles.flipBackHint}>Interval preview unavailable. Ratings will still schedule normally.</Text>
                        ) : null}
                        {studyMode === 'flashcard' ? (
                          <Text style={styles.flipBackHint}>Tap card to flip back to word</Text>
                        ) : forceAgainForQuizSelection ? (
                          <Text style={styles.flipBackHint}>Incorrect selection recorded as Again for FSRS consistency.</Text>
                        ) : (
                          <Text style={styles.flipBackHint}>Rate confidence after checking the answer.</Text>
                        )}
                      </View>
                    ) : null}
                    {reviewActionError ? (
                      <Text style={styles.actionError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        {reviewActionError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <View style={[styles.panel, styles.addPanel, isCompactLayout && styles.panelCompact, isWideLayout && styles.panelWide]}>
                <View style={styles.panelTitleWrap}>
                  <Text style={styles.panelTitle} accessibilityRole="header">
                    Add Vocabulary
                  </Text>
                  <Text style={styles.panelSubtitle}>Keep entries precise and compact</Text>
                </View>
                <Text style={styles.info}>Capture one precise definition and optional context note.</Text>
                <Text style={styles.inputLabel}>Word</Text>
                <TextInput
                  ref={wordInputRef}
                  value={word}
                  onChangeText={setWord}
                  placeholder="Word"
                  style={[
                    styles.input,
                    focusedInput === 'word' && styles.inputFocused,
                    addAttempted && missingWord && styles.inputError,
                    focusedInput === 'word' && addAttempted && missingWord && styles.inputErrorFocused,
                  ]}
                  placeholderTextColor={colors.subInk}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  importantForAutofill="no"
                  textContentType="none"
                  returnKeyType="next"
                  enterKeyHint="next"
                  maxLength={WORD_MAX_LENGTH}
                  selectionColor={colors.primary}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Word input"
                  onFocus={() => setFocusedInput('word')}
                  onBlur={() => setFocusedInput((current) => (current === 'word' ? null : current))}
                  onSubmitEditing={() => meaningInputRef.current?.focus()}
                />
                <Text style={[styles.charCount, { color: wordCountTone }]}>
                  {formatCountLabel(wordLength, WORD_MAX_LENGTH)}
                </Text>
                {addAttempted && missingWord ? <Text style={styles.inputErrorText}>Word is required.</Text> : null}
                <Text style={styles.inputLabel}>Meaning</Text>
                <TextInput
                  ref={meaningInputRef}
                  value={meaning}
                  onChangeText={setMeaning}
                  placeholder={normalizedWord ? `Meaning of ${normalizedWord}` : 'Meaning'}
                  style={[
                    styles.input,
                    focusedInput === 'meaning' && styles.inputFocused,
                    addAttempted && missingMeaning && styles.inputError,
                    focusedInput === 'meaning' && addAttempted && missingMeaning && styles.inputErrorFocused,
                  ]}
                  placeholderTextColor={colors.subInk}
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  importantForAutofill="no"
                  textContentType="none"
                  returnKeyType="next"
                  enterKeyHint="next"
                  maxLength={MEANING_MAX_LENGTH}
                  selectionColor={colors.primary}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Meaning input"
                  onFocus={() => setFocusedInput('meaning')}
                  onBlur={() => setFocusedInput((current) => (current === 'meaning' ? null : current))}
                  onSubmitEditing={() => {
                    if (normalizedNotes.length === 0) {
                      handleAddCard();
                      return;
                    }
                    notesInputRef.current?.focus();
                  }}
                />
                <Text style={[styles.charCount, { color: meaningCountTone }]}>
                  {formatCountLabel(meaningLength, MEANING_MAX_LENGTH)}
                </Text>
                {addAttempted && missingMeaning ? <Text style={styles.inputErrorText}>Meaning is required.</Text> : null}
                <Text style={styles.inputLabel}>Notes (optional)</Text>
                <TextInput
                  ref={notesInputRef}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder={normalizedWord ? `Usage note for ${normalizedWord} (optional)` : 'Notes (optional)'}
                  style={[styles.input, focusedInput === 'notes' && styles.inputFocused, styles.notesInput]}
                  placeholderTextColor={colors.subInk}
                  multiline
                  textAlignVertical="top"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="off"
                  importantForAutofill="no"
                  textContentType="none"
                  maxLength={NOTES_MAX_LENGTH}
                  selectionColor={colors.primary}
                  editable={isFormEditable}
                  accessibilityLabel="Notes input"
                  onFocus={() => setFocusedInput('notes')}
                  onBlur={() => setFocusedInput((current) => (current === 'notes' ? null : current))}
                  returnKeyType="done"
                  enterKeyHint="done"
                  blurOnSubmit
                  onSubmitEditing={handleAddCard}
                />
                <Text style={[styles.charCount, { color: noteCountTone }]}>
                  {formatCountLabel(notesLength, NOTES_MAX_LENGTH)}
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && styles.primaryBtnPressed,
                    addButtonDisabled && styles.primaryBtnDisabled,
                    !canAdd && canAttemptAdd && styles.primaryBtnInactive,
                  ]}
                  onPress={handleAddCard}
                  disabled={addButtonDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Add card. ${addButtonLabel}.`}
                  accessibilityHint={canAdd ? 'Adds this word to your study deck' : addFormHint}
                  accessibilityState={{ disabled: addButtonDisabled, busy: isAddBusy }}
                >
                  <View style={styles.primaryBtnContent}>
                    {isAddBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.primaryBtnText}>{addButtonLabel}</Text>
                  </View>
                </Pressable>
                <Text
                  style={[styles.addHint, { color: addHintTone }]}
                  accessibilityRole="status"
                  accessibilityLiveRegion="polite"
                >
                  {addFormHint}
                </Text>
                {addActionError ? (
                  <Text style={styles.actionError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                    {addActionError}
                  </Text>
                ) : null}
              </View>
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backgroundOrbA: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: colors.primarySoft,
    top: -156,
    right: -104,
    opacity: 0.85,
  },
  backgroundOrbB: {
    position: 'absolute',
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: colors.bgMuted,
    top: 246,
    left: -150,
    opacity: 0.72,
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 14,
    paddingBottom: 44,
  },
  content: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    gap: 16,
  },
  headerCard: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 21,
    gap: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 4,
  },
  headerCardCompact: {
    padding: 16,
    gap: 8,
  },
  headerGlowA: {
    position: 'absolute',
    right: -26,
    top: -18,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.primarySoft,
  },
  headerGlowB: {
    position: 'absolute',
    right: 28,
    top: 20,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.surface,
    opacity: 0.85,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  title: {
    fontSize: 29,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: 13.5,
    color: colors.subInk,
    lineHeight: 20,
  },
  heroTags: {
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  heroTag: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    color: colors.ink,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
    maxWidth: '100%',
  },
  heroTagPriority: {
    fontWeight: '800',
  },
  subMeta: {
    color: colors.subInk,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.15,
    flex: 1,
  },
  metaLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  asOfMeta: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.25,
    flexShrink: 0,
  },
  scoreRow: {
    marginTop: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    gap: 9,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreTrack: {
    height: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  scoreFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metrics: {
    flexDirection: 'row',
    gap: 9,
    flexWrap: 'wrap',
  },
  metricCardCompact: {
    flexBasis: '48%',
  },
  panelGrid: {
    gap: 14,
  },
  panelGridWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  panelWide: {
    flex: 1,
  },
  reviewPanel: {
    minHeight: 390,
  },
  addPanel: {
    minHeight: 390,
  },
  panel: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    padding: 17,
    gap: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.08,
    shadowRadius: 17,
    elevation: 4,
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  panelHeadCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
  },
  panelTitleWrap: {
    gap: 3,
    flex: 1,
  },
  panelTitle: {
    fontSize: 16.5,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: 0.1,
  },
  panelSubtitle: {
    fontSize: 11,
    color: colors.subInk,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  panelKpiWrap: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 1,
  },
  panelKpiWrapCompact: {
    alignItems: 'flex-start',
  },
  panelKpi: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.85,
    color: colors.primary,
    fontWeight: '700',
    textAlign: 'right',
  },
  panelSubKpi: {
    fontSize: 10,
    color: colors.subInk,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  panelSubKpiAlert: {
    color: colors.danger,
  },
  panelSubKpiWarn: {
    color: colors.warn,
  },
  queueProgressWrap: {
    marginBottom: 14,
    gap: 6,
  },
  queueProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  queueProgressLabel: {
    color: colors.subInk,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  queueProgressValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  queueProgressStatus: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  queueProgressValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  queueProgressMeta: {
    color: colors.subInk,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.25,
    fontVariant: ['tabular-nums'],
  },
  queueProgressTrack: {
    height: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  queueProgressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  info: {
    color: colors.subInk,
    fontSize: 13,
    lineHeight: 19,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyQueue: {
    gap: 6,
  },
  emptyQueueAction: {
    marginTop: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    gap: 2,
  },
  emptyQueueActionRepair: {
    borderColor: `${colors.warn}55`,
    backgroundColor: `${colors.warn}10`,
  },
  emptyQueueActionDisabled: {
    opacity: 0.55,
  },
  emptyQueueActionText: {
    fontSize: 12,
    color: colors.ink,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  emptyQueueActionSubText: {
    fontSize: 10.5,
    color: colors.subInk,
    fontWeight: '600',
    letterSpacing: 0.25,
  },
  emptyQueueMeta: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  reviewCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    borderStyle: 'solid',
    gap: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  panelCompact: {
    minHeight: 0,
    padding: 14,
    gap: 10,
  },
  reviewCardCompact: {
    padding: 13,
    gap: 11,
  },
  reviewCardBusy: {
    opacity: 0.82,
  },
  reviewTimeline: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 3,
  },
  reviewTimelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reviewTimelineLabel: {
    color: colors.subInk,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.85,
  },
  reviewUrgencyBadge: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
  },
  reviewUrgencyText: {
    fontSize: 9.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  reviewTimelineValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  reviewTimelineSubValue: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  reviewTimelineRepair: {
    color: colors.warn,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.25,
    borderWidth: 1,
    borderColor: `${colors.warn}66`,
    backgroundColor: `${colors.warn}14`,
    borderRadius: radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  reviewTimelineMeta: {
    color: colors.subInk,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
  },
  studyModeToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  studyModeToggleBtn: {
    flex: 1,
    minWidth: 148,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 9,
    alignItems: 'center',
  },
  studyModeToggleBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  studyModeToggleBtnDisabled: {
    opacity: 0.5,
  },
  studyModeToggleText: {
    color: colors.subInk,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  studyModeToggleTextActive: {
    color: colors.primary,
  },
  studyModeHelper: {
    color: colors.subInk,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  reviewBadgeColumn: {
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
  },
  word: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 38,
    flexShrink: 1,
  },
  wordCompact: {
    fontSize: 30,
    lineHeight: 34,
  },
  stateBadge: {
    fontSize: 10.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.85,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 5,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  urgencyBadge: {
    fontSize: 9.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  meaning: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 29,
  },
  revealHint: {
    fontSize: 13,
    color: colors.subInk,
    lineHeight: 19,
  },
  flashcardFace: {
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: 12,
  },
  flashcardFacePressed: {
    transform: [{ translateY: 1 }, { scale: 0.995 }],
    opacity: 0.96,
  },
  flashcardFaceDisabled: {
    opacity: 0.7,
  },
  revealPreviewHint: {
    fontSize: 12,
    color: colors.subInk,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  quizPreviewHint: {
    fontSize: 12,
    color: colors.subInk,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  notes: {
    fontSize: 14,
    color: colors.subInk,
    lineHeight: 20,
  },
  answerActionsLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.subInk,
  },
  quizOptionList: {
    gap: 8,
  },
  quizOptionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  quizOptionBtnSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  quizOptionBtnCorrect: {
    borderColor: colors.success,
    backgroundColor: '#eef9f1',
  },
  quizOptionBtnIncorrect: {
    borderColor: colors.danger,
    backgroundColor: '#fff5f6',
  },
  quizOptionBtnLocked: {
    opacity: 0.9,
  },
  quizOptionText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  quizOptionLabel: {
    fontWeight: '800',
    color: colors.subInk,
  },
  quizOptionTextSelected: {
    color: colors.primary,
  },
  quizOptionTextCorrect: {
    color: colors.success,
  },
  quizOptionTextIncorrect: {
    color: colors.danger,
  },
  quizOptionSelectionTag: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  quizFeedback: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 9,
    flexWrap: 'wrap',
  },
  metaText: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
    color: colors.subInk,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: colors.surface,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
    fontVariant: ['tabular-nums'],
  },
  metaTextWarn: {
    color: colors.warn,
    borderColor: `${colors.warn}80`,
    backgroundColor: `${colors.warn}14`,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 15,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 21,
  },
  inputFocused: {
    borderColor: colors.focusRing,
    shadowColor: colors.focusRing,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.subInk,
  },
  inputError: {
    borderColor: colors.danger,
    backgroundColor: '#fff5f6',
  },
  inputErrorFocused: {
    shadowColor: colors.danger,
  },
  inputErrorText: {
    marginTop: -5,
    color: colors.danger,
    fontSize: 11.5,
    fontWeight: '600',
  },
  notesInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  charCount: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: colors.subInk,
    marginTop: -6,
  },
  addHint: {
    marginTop: 6,
    color: colors.subInk,
    fontSize: 12,
    fontWeight: '600',
  },
  actionError: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#f2c8cf',
    backgroundColor: '#fff4f6',
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger,
  },
  primaryBtn: {
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 11,
    elevation: 4,
  },
  primaryBtnPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.95,
  },
  primaryBtnDisabled: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryBtnInactive: {
    opacity: 0.85,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  primaryBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  answerActions: {
    gap: 10,
  },
  flipBackHint: {
    color: colors.subInk,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  ghostBtn: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 11,
    alignItems: 'center',
  },
  ghostBtnPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.9,
  },
  ghostBtnDisabled: {
    opacity: 0.55,
  },
  ghostBtnText: {
    color: colors.subInk,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
