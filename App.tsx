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
  compareDueCards,
  countOverdueCards,
  countScheduleRepairCards,
  countUpcomingDueCards,
  hasScheduleRepairNeed,
  useDeck,
} from './src/hooks';
import { previewIntervals } from './src/scheduler/fsrs';
import { FlashcardSide, flipFlashcardSide, getFlashcardVisibility } from './src/flashcard';
import { composeQuizOptions, hasValidQuizSelection, resolveMultipleChoiceRating } from './src/quiz';
import { colors, radii } from './src/theme';
import { formatDueLabel } from './src/utils/due';
import { formatIntervalLabel } from './src/utils/interval';
import { dueUrgency, queueTone } from './src/utils/scheduleStatus';
import { normalizeBoundedText } from './src/utils/text';
import { Rating, ReviewState } from './src/types';

type StudyMode = 'flashcard' | 'multiple-choice';

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

function reviewedAtLabel(lastReviewedAt?: string): string {
  if (!lastReviewedAt || !Number.isFinite(Date.parse(lastReviewedAt))) {
    return 'No review history yet';
  }
  return `Last review ${new Date(lastReviewedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function exactDateLabel(iso?: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) {
    return 'Schedule unavailable';
  }
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function asOfLabel(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) {
    return 'Clock unavailable';
  }
  return `As of ${new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatMetricNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function formatCountLabel(length: number, max: number): string {
  const remaining = Math.max(0, max - length);
  const suffix = remaining === 1 ? 'char left' : 'chars left';
  return `${remaining.toLocaleString()} ${suffix}`;
}

function trimmedLength(value: string, max: number): number {
  return normalizeBoundedText(value, max).length;
}

function formatQueueShareLabel(dueNow: number, total: number): string {
  if (total <= 0) {
    return 'No cards yet';
  }
  const boundedDueNow = Math.min(total, Math.max(0, dueNow));
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
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
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
  const [pendingReviewCardId, setPendingReviewCardId] = useState<string | null>(null);
  const [isAddBusy, setIsAddBusy] = useState(false);
  const [addAttempted, setAddAttempted] = useState(false);
  const [showAddSuccess, setShowAddSuccess] = useState(false);
  const [addActionError, setAddActionError] = useState<string | null>(null);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
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

  const dueCard = dueCards[0];
  const dueQueueCount = dueCards.length;
  const retentionScore = useMemo(() => {
    if (stats.total === 0) {
      return 0;
    }
    return clampPercent(((stats.review + stats.relearning * 0.5 + stats.learning * 0.2) / stats.total) * 100);
  }, [stats]);
  const nextUpcomingCard = useMemo(() => {
    const nowMs = Date.parse(clockIso);
    if (!Number.isFinite(nowMs)) {
      return undefined;
    }
    return cards
      .filter((card) => {
        const dueMs = Date.parse(card.dueAt);
        return Number.isFinite(dueMs) && dueMs > nowMs;
      })
      .sort(compareDueCards)[0];
  }, [cards, clockIso]);
  const retentionBarWidth = `${retentionScore}%`;
  const retentionTone =
    retentionScore >= 80 ? colors.success : retentionScore >= 50 ? colors.primary : colors.warn;
  const queueLabel = loading
    ? 'Loading'
    : dueCard
      ? !hasScheduleRepairNeed(dueCard) && hasValidIso(dueCard.dueAt)
        ? formatDueLabel(dueCard.dueAt, clockIso)
        : 'Needs schedule repair'
      : 'Queue clear';
  const nextUpcomingLabel = loading
    ? '--'
    : nextUpcomingCard
      ? `Next ${formatDueLabel(nextUpcomingCard.dueAt, clockIso)}`
      : 'No upcoming card';
  const queueLabelTone = queueTone({
    dueAt: dueCard?.dueAt,
    clockIso,
    loading,
    hasDueCard: Boolean(dueCard),
    needsRepair: dueCard ? hasScheduleRepairNeed(dueCard) : false,
  });
  const queueShareLabel = loading
    ? '--'
    : formatQueueShareLabel(dueQueueCount, stats.total);
  const queueProgressPercent = loading || stats.total === 0 ? 0 : clampPercent((dueQueueCount / stats.total) * 100);
  const queueProgressWidth = `${queueProgressPercent}%`;
  const queueProgressMeta = loading ? '--' : queueShareLabel;
  const queueProgressTone = loading
    ? colors.primary
    : queueProgressPercent >= 80
      ? colors.danger
      : queueProgressPercent >= 50
        ? colors.warn
        : colors.success;
  const reviewQueueLabel = loading
    ? '--'
    : dueCard
      ? formatReviewQueueLabel(dueQueueCount)
      : queueShareLabel;
  const followUpQueueLabel = loading
    ? '--'
    : dueCards[1]
      ? hasScheduleRepairNeed(dueCards[1]) || !hasValidIso(dueCards[1].dueAt)
        ? 'Then needs schedule repair'
        : `Then ${formatDueLabel(dueCards[1].dueAt, clockIso)}`
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
  const dueWithinDay = useMemo(() => {
    return countUpcomingDueCards(cards, clockIso, 24);
  }, [cards, clockIso]);
  const overdueNow = useMemo(() => {
    return countOverdueCards(cards, clockIso);
  }, [cards, clockIso]);
  const scheduleRepairCount = useMemo(() => countScheduleRepairCards(cards), [cards]);
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
  const exactDueLabel = exactDateLabel(dueCard?.dueAt);
  const dueNeedsRepair = dueCard ? hasScheduleRepairNeed(dueCard) : false;
  const relativeDueLabel = dueCard
    ? !dueNeedsRepair && hasValidIso(dueCard.dueAt)
      ? formatDueLabel(dueCard.dueAt, clockIso)
      : 'Needs schedule repair'
    : 'Schedule unavailable';
  const asOf = asOfLabel(clockIso);
  const emptyQueueTitle =
    scheduleRepairCount > 0
      ? `No cards due. ${scheduleRepairCount.toLocaleString()} schedule ${
          scheduleRepairCount === 1 ? 'repair' : 'repairs'
        } pending.`
      : 'No cards due. Add new words below.';
  const emptyQueueActionLabel = scheduleRepairCount > 0 ? 'Add more words' : 'Start adding words';
  const dueCardStateConfig = dueCard ? stateConfig(dueCard.state) : null;
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
  const dueCardRevealKey = dueCard ? `${dueCard.id}:${dueCard.updatedAt}:${dueCard.dueAt}` : 'none';
  const quizSeed = dueCard ? `${dueCard.id}:${dueCard.updatedAt}` : 'none';
  const quizOptions = useMemo(() => (dueCard ? composeQuizOptions(dueCard, cards, quizSeed, 3) : []), [cards, dueCard, quizSeed]);
  const selectedQuizOption = useMemo(
    () => quizOptions.find((option) => option.id === selectedQuizOptionId),
    [quizOptions, selectedQuizOptionId],
  );
  const correctQuizOption = useMemo(() => quizOptions.find((option) => option.isCorrect), [quizOptions]);
  const canUseMultipleChoice = quizOptions.length === 4;
  const missingQuizOptions = Math.max(0, 4 - quizOptions.length);
  const multipleChoiceRequirementLabel =
    missingQuizOptions === 0
      ? null
      : `Need ${missingQuizOptions.toLocaleString()} more distinct ${
          missingQuizOptions === 1 ? 'card meaning' : 'card meanings'
        } for multiple-choice mode.`;
  const hasQuizSelection = hasValidQuizSelection(selectedQuizOptionId, quizOptions);
  const quizSelectionIsCorrect = selectedQuizOption?.isCorrect ?? false;
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
  const quickRatingPreviewLabel = ratingIntervalLabels
    ? `Again ${ratingIntervalLabels[1]} · Hard ${ratingIntervalLabels[2]} · Good ${ratingIntervalLabels[3]} · Easy ${ratingIntervalLabels[4]}`
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
  const canAdd = useMemo(
    () => !loading && !isAddBusy && trimmedWordLength > 0 && trimmedMeaningLength > 0,
    [isAddBusy, loading, trimmedWordLength, trimmedMeaningLength],
  );
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
  const isReviewBusy = pendingReviewCardId !== null;
  const quizOptionsLocked = isReviewBusy || hasQuizSelection;
  const isFormEditable = !loading && !isAddBusy;
  const flashcardVisibility = useMemo(
    () => getFlashcardVisibility(flashcardSide, Boolean(dueCard?.notes?.trim())),
    [dueCard?.notes, flashcardSide],
  );
  const canShowRatings = studyMode === 'flashcard' ? flashcardVisibility.showRatings : hasQuizSelection;

  useEffect(() => {
    setFlashcardSide('front');
    setSelectedQuizOptionId(null);
    setReviewActionError(null);
  }, [dueCardRevealKey]);

  useEffect(() => {
    if (studyMode === 'multiple-choice' && !canUseMultipleChoice) {
      setStudyMode('flashcard');
    }
  }, [canUseMultipleChoice, studyMode]);

  useEffect(() => {
    if (!selectedQuizOptionId) {
      return;
    }
    if (!hasValidQuizSelection(selectedQuizOptionId, quizOptions)) {
      setSelectedQuizOptionId(null);
    }
  }, [quizOptions, selectedQuizOptionId]);

  useEffect(() => {
    if (pendingReviewCardId === null) {
      return;
    }
    if (!dueCard || dueCard.id !== pendingReviewCardId) {
      setPendingReviewCardId(null);
    }
  }, [dueCard, pendingReviewCardId]);

  useEffect(() => {
    if (pendingReviewCardId === null) {
      reviewLockRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setPendingReviewCardId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingReviewCardId]);

  useEffect(() => {
    Animated.timing(entryAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
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
  }, [meaning.length, notes.length, showAddSuccess, word.length]);

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
      setAddAttempted(true);
      wordInputRef.current?.focus();
      return;
    }
    if (!normalizedMeaning) {
      setAddAttempted(true);
      meaningInputRef.current?.focus();
      return;
    }
    setAddAttempted(false);
    Keyboard.dismiss();
    addLockRef.current = true;
    setIsAddBusy(true);
    const shouldReturnToWordInput = !dueCard;
    try {
      addCard(normalizedWord, normalizedMeaning, normalizedNotes || undefined);
    } catch {
      addLockRef.current = false;
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
      return;
    }
    if (!dueCard || pendingReviewCardId !== null || reviewLockRef.current) {
      return;
    }
    setReviewActionError(null);
    Keyboard.dismiss();
    reviewLockRef.current = true;
    const resolvedRating =
      studyMode === 'multiple-choice'
        ? resolveMultipleChoiceRating(rating, quizSelectionIsCorrect)
        : rating;
    let reviewed = false;
    try {
      reviewed = reviewDueCard(dueCard.id, resolvedRating);
    } catch {
      setPendingReviewCardId(null);
      reviewLockRef.current = false;
      setReviewActionError('Unable to record this review right now.');
      return;
    }
    if (reviewed) {
      setPendingReviewCardId(dueCard.id);
      return;
    }
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
    if (isReviewBusy) {
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
    if (!dueCard || isReviewBusy || studyMode !== 'multiple-choice' || hasQuizSelection) {
      return;
    }
    if (!hasValidQuizSelection(optionId, quizOptions)) {
      return;
    }
    setSelectedQuizOptionId(optionId.trim());
    setReviewActionError(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.backgroundOrbA} />
      <View style={styles.backgroundOrbB} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        style={styles.safe}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
                <Text style={[styles.heroTag, { color: queueLabelTone }]}>{queueLabel}</Text>
                <Text style={styles.heroTag}>{queueShareLabel}</Text>
                <Text style={styles.heroTag}>{nextUpcomingLabel}</Text>
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
                <MetricCard label="Upcoming 24h" value={loading ? Number.NaN : dueWithinDay} accent={colors.accent} />
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
              <View style={[styles.panel, styles.reviewPanel, isWideLayout && styles.panelWide]}>
                <View style={styles.panelHead}>
                  <View style={styles.panelTitleWrap}>
                    <Text style={styles.panelTitle} accessibilityRole="header">
                      Review Queue
                    </Text>
                    <Text style={styles.panelSubtitle}>Prioritized by due time and recency</Text>
                  </View>
                  <View style={styles.panelKpiWrap}>
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
                        scheduleRepairCount > 0 && !loading ? styles.panelSubKpiAlert : null,
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
                      <Text style={styles.queueProgressValue}>{queueProgressPercent}%</Text>
                    </View>
                    <View
                      style={styles.queueProgressTrack}
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityLabel="Queue load"
                      accessibilityValue={{ min: 0, max: 100, now: queueProgressPercent }}
                    >
                      <View style={[styles.queueProgressFill, { width: queueProgressWidth, backgroundColor: queueProgressTone }]} />
                    </View>
                    <Text style={styles.queueProgressMeta} numberOfLines={1} ellipsizeMode="tail">
                      {queueProgressMeta}
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
                    accessibilityLabel={`Review card ${dueCard.word}. ${dueCardStateConfig?.label ?? 'Learning'}. ${relativeDueLabel}.`}
                  >
                    <View style={[styles.reviewTimeline, { borderColor: `${dueCardUrgency.tone}44` }]}>
                      <Text style={styles.reviewTimelineLabel}>Scheduled for</Text>
                      <Text style={styles.reviewTimelineValue} numberOfLines={1}>
                        {exactDueLabel}
                      </Text>
                      <Text style={styles.reviewTimelineSubValue} numberOfLines={1}>
                        {relativeDueLabel}
                      </Text>
                      {dueNeedsRepair ? (
                        <Text style={styles.reviewTimelineRepair}>Malformed schedule will be repaired on review.</Text>
                      ) : null}
                      <Text style={styles.reviewTimelineMeta}>{queuePositionLabel}</Text>
                      <Text style={styles.reviewTimelineMeta}>{remainingQueueLabel}</Text>
                    </View>
                    <View style={styles.studyModeToggleRow}>
                      <Pressable
                        onPress={() => handleSelectStudyMode('flashcard')}
                        disabled={isReviewBusy}
                        style={({ pressed }) => [
                          styles.studyModeToggleBtn,
                          studyMode === 'flashcard' && styles.studyModeToggleBtnActive,
                          isReviewBusy && styles.studyModeToggleBtnDisabled,
                          pressed && !isReviewBusy && styles.ghostBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Flashcard mode"
                        accessibilityState={{ selected: studyMode === 'flashcard', disabled: isReviewBusy }}
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
                        disabled={isReviewBusy || !canUseMultipleChoice}
                        style={({ pressed }) => [
                          styles.studyModeToggleBtn,
                          studyMode === 'multiple-choice' && styles.studyModeToggleBtnActive,
                          (isReviewBusy || !canUseMultipleChoice) && styles.studyModeToggleBtnDisabled,
                          pressed && !isReviewBusy && canUseMultipleChoice && styles.ghostBtnPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Multiple-choice mode"
                        accessibilityHint={
                          isReviewBusy
                            ? 'Disabled while the current review is being recorded'
                            : canUseMultipleChoice
                              ? 'Switches to objective multiple-choice quiz mode'
                              : multipleChoiceRequirementLabel ?? 'Need at least four distinct card meanings'
                        }
                        accessibilityState={{ selected: studyMode === 'multiple-choice', disabled: isReviewBusy || !canUseMultipleChoice }}
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
                        accessibilityLabel={`Flashcard ${dueCard.word}. ${flashcardVisibility.showMeaning ? 'Back side showing answer.' : 'Front side showing prompt.'}`}
                        accessibilityHint="Tap to flip between word and answer"
                        accessibilityState={{ disabled: isReviewBusy, busy: isReviewBusy }}
                      >
                        <View style={styles.reviewHeader}>
                          <Text style={[styles.word, isCompactLayout && styles.wordCompact]} numberOfLines={2} ellipsizeMode="tail">
                            {dueCard.word}
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
                        {flashcardVisibility.showMeaning ? <Text style={styles.meaning}>{dueCard.meaning}</Text> : null}
                        {flashcardVisibility.showExample ? <Text style={styles.notes}>{dueCard.notes}</Text> : null}
                        {flashcardVisibility.showMeaning ? (
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>Difficulty {formatMetricNumber(dueCard.difficulty, 1)}</Text>
                            <Text style={styles.metaText}>Stability {formatMetricNumber(dueCard.stability, 2)}d</Text>
                            <Text style={styles.metaText}>
                              Reps {dueCard.reps} · Lapses {dueCard.lapses}
                            </Text>
                          </View>
                        ) : null}
                      </Pressable>
                    ) : (
                      <View style={styles.flashcardFace}>
                        <View style={styles.reviewHeader}>
                          <Text style={[styles.word, isCompactLayout && styles.wordCompact]} numberOfLines={2} ellipsizeMode="tail">
                            {dueCard.word}
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
                            {quizOptions.map((option) => {
                              const isSelected = selectedQuizOptionId === option.id;
                              const showCorrect = hasQuizSelection && option.isCorrect;
                              const showIncorrect = hasQuizSelection && isSelected && !option.isCorrect;
                              const optionPrefix = showCorrect ? 'Correct: ' : showIncorrect ? 'Incorrect: ' : '';
                              return (
                                <Pressable
                                  key={option.id}
                                  onPress={() => handleSelectQuizOption(option.id)}
                                  disabled={quizOptionsLocked}
                                  style={({ pressed }) => [
                                    styles.quizOptionBtn,
                                    isSelected && styles.quizOptionBtnSelected,
                                    showCorrect && styles.quizOptionBtnCorrect,
                                    showIncorrect && styles.quizOptionBtnIncorrect,
                                    quizOptionsLocked && styles.quizOptionBtnLocked,
                                    pressed && !quizOptionsLocked && styles.ghostBtnPressed,
                                  ]}
                                  accessibilityRole="radio"
                                  accessibilityLabel={option.text}
                                  accessibilityState={{
                                    selected: isSelected,
                                    checked: isSelected,
                                    disabled: quizOptionsLocked,
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.quizOptionText,
                                      isSelected && styles.quizOptionTextSelected,
                                      showCorrect && styles.quizOptionTextCorrect,
                                      showIncorrect && styles.quizOptionTextIncorrect,
                                    ]}
                                  >
                                    {optionPrefix}
                                    {option.text}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        )}
                        {hasQuizSelection && correctQuizOption ? (
                          <Text style={[styles.quizFeedback, { color: quizSelectionIsCorrect ? colors.success : colors.danger }]}>
                            {quizSelectionIsCorrect
                              ? 'Correct. Selection locked. Rate how easy this felt.'
                              : `Incorrect. Selection locked. Correct answer: ${correctQuizOption.text}. This review will be recorded as Again.`}
                          </Text>
                        ) : (
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
                        {studyMode === 'flashcard' ? (
                          <Text style={styles.flipBackHint}>Tap card to flip back to word</Text>
                        ) : forceAgainForQuizSelection ? (
                          <Text style={styles.flipBackHint}>Incorrect selection recorded as Again for FSRS consistency.</Text>
                        ) : (
                          <Text style={styles.flipBackHint}>Rate confidence after checking the answer.</Text>
                        )}
                        {isReviewBusy ? (
                          <View style={styles.reviewingHintRow}>
                            <ActivityIndicator size="small" color={colors.subInk} />
                            <Text style={styles.reviewingHint} accessibilityLiveRegion="polite">
                              Recording review...
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    {reviewActionError ? (
                      <Text style={styles.actionError} accessibilityLiveRegion="polite">
                        {reviewActionError}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <View style={[styles.panel, styles.addPanel, isWideLayout && styles.panelWide]}>
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
                  style={[styles.input, addAttempted && missingWord && styles.inputError]}
                  placeholderTextColor={colors.subInk}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  returnKeyType="next"
                  enterKeyHint="next"
                  maxLength={WORD_MAX_LENGTH}
                  selectionColor={colors.primary}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Word input"
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
                  placeholder="Meaning"
                  style={[styles.input, addAttempted && missingMeaning && styles.inputError]}
                  placeholderTextColor={colors.subInk}
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  returnKeyType="next"
                  enterKeyHint="next"
                  maxLength={MEANING_MAX_LENGTH}
                  selectionColor={colors.primary}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Meaning input"
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
                  placeholder="Notes (optional)"
                  style={[styles.input, styles.notesInput]}
                  placeholderTextColor={colors.subInk}
                  multiline
                  textAlignVertical="top"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  maxLength={NOTES_MAX_LENGTH}
                  selectionColor={colors.primary}
                  editable={isFormEditable}
                  accessibilityLabel="Notes input"
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
                    !canAdd && styles.primaryBtnDisabled,
                  ]}
                  onPress={handleAddCard}
                  disabled={!canAdd}
                  accessibilityRole="button"
                  accessibilityLabel="Add card"
                  accessibilityHint={canAdd ? 'Adds this word to your study deck' : addFormHint}
                  accessibilityState={{ disabled: !canAdd, busy: isAddBusy }}
                >
                  <View style={styles.primaryBtnContent}>
                    {isAddBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text style={styles.primaryBtnText}>{isAddBusy ? 'Adding...' : 'Add card'}</Text>
                  </View>
                </Pressable>
                <Text style={[styles.addHint, { color: addHintTone }]} accessibilityLiveRegion="polite">
                  {addFormHint}
                </Text>
                {addActionError ? (
                  <Text style={styles.actionError} accessibilityLiveRegion="polite">
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
  queueProgressValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  queueProgressMeta: {
    color: colors.subInk,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.25,
    fontVariant: ['tabular-nums'],
    textTransform: 'uppercase',
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
  reviewTimelineLabel: {
    color: colors.subInk,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.85,
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
    gap: 8,
  },
  studyModeToggleBtn: {
    flex: 1,
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
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  quizOptionBtnSelected: {
    borderColor: colors.primary,
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
    opacity: 0.94,
  },
  quizOptionText: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
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
    marginTop: 4,
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
  reviewingHint: {
    color: colors.subInk,
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.25,
    textAlign: 'center',
  },
  reviewingHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
