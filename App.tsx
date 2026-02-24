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
import { compareDueCards, countOverdueCards, countUpcomingDueCards, useDeck } from './src/hooks';
import { previewIntervals } from './src/scheduler/fsrs';
import { colors, radii } from './src/theme';
import { formatDueLabel } from './src/utils/due';
import { formatIntervalLabel } from './src/utils/interval';
import { Rating, ReviewState } from './src/types';

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
  return `${length.toLocaleString()}/${max.toLocaleString()}`;
}

function trimmedLength(value: string, max: number): number {
  return value.trim().slice(0, max).length;
}

function formatQueueShareLabel(dueNow: number, total: number): string {
  const dueLabel = dueNow === 1 ? 'due card' : 'due cards';
  const totalLabel = total === 1 ? 'card' : 'cards';
  return `${dueNow.toLocaleString()} ${dueLabel} / ${total.toLocaleString()} ${totalLabel}`;
}

function formatReviewQueueLabel(dueNow: number): string {
  const dueLabel = dueNow === 1 ? 'due card' : 'due cards';
  return `${dueNow.toLocaleString()} ${dueLabel} in queue`;
}

function formatQueuePositionLabel(position: number, total: number): string {
  return `Card ${position.toLocaleString()} of ${total.toLocaleString()}`;
}

function queueTone({
  dueAt,
  clockIso,
  loading,
  hasDueCard,
}: {
  dueAt?: string;
  clockIso: string;
  loading: boolean;
  hasDueCard: boolean;
}): string {
  if (loading) {
    return colors.subInk;
  }
  if (!hasDueCard) {
    return colors.success;
  }
  const dueMs = dueAt ? Date.parse(dueAt) : Number.NaN;
  const nowMs = Date.parse(clockIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return colors.warn;
  }
  if (dueMs - nowMs <= 60 * 1000) {
    return colors.danger;
  }
  return colors.primary;
}

function dueUrgency(dueAt: string | undefined, clockIso: string): { label: string; tone: string } {
  if (!dueAt) {
    return { label: 'Schedule pending', tone: colors.subInk };
  }
  const dueMs = Date.parse(dueAt);
  const nowMs = Date.parse(clockIso);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return { label: 'Schedule pending', tone: colors.subInk };
  }
  const deltaMs = dueMs - nowMs;
  if (deltaMs <= 60 * 1000 && deltaMs >= -60 * 1000) {
    return { label: 'Due now', tone: colors.primary };
  }
  if (deltaMs < -60 * 1000) {
    return { label: 'Overdue', tone: colors.danger };
  }
  if (deltaMs <= 60 * 60 * 1000) {
    return { label: 'Due soon', tone: colors.warn };
  }
  return { label: 'On track', tone: colors.success };
}

export default function App() {
  const { loading, cards, dueCards, stats, addCard, reviewDueCard, clockIso, lastReviewedAt } = useDeck();
  const { width } = useWindowDimensions();
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [notes, setNotes] = useState('');
  const [showMeaning, setShowMeaning] = useState(false);
  const [pendingReviewCardId, setPendingReviewCardId] = useState<string | null>(null);
  const [isAddBusy, setIsAddBusy] = useState(false);
  const [addAttempted, setAddAttempted] = useState(false);
  const [entryAnim] = useState(() => new Animated.Value(0));
  const scrollRef = useRef<ScrollView>(null);
  const wordInputRef = useRef<TextInput>(null);
  const meaningInputRef = useRef<TextInput>(null);
  const notesInputRef = useRef<TextInput>(null);
  const reviewLockRef = useRef(false);
  const addLockRef = useRef(false);
  const addUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousHadDueCardRef = useRef(false);

  const dueCard = dueCards[0];
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
  const queueLabel = loading ? 'Loading' : dueCard ? formatDueLabel(dueCard.dueAt, clockIso) : 'Queue clear';
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
  });
  const queueShareLabel = loading
    ? '--'
    : formatQueueShareLabel(stats.dueNow, stats.total);
  const reviewQueueLabel = loading
    ? '--'
    : dueCard
      ? formatReviewQueueLabel(stats.dueNow)
      : queueShareLabel;
  const followUpQueueLabel = loading
    ? '--'
    : dueCards[1]
      ? `Then ${formatDueLabel(dueCards[1].dueAt, clockIso)}`
      : 'No second card queued';
  const queuePositionLabel = loading
    ? '--'
    : dueCard
      ? formatQueuePositionLabel(1, Math.max(1, stats.dueNow))
      : 'Queue empty';
  const dueWithinDay = useMemo(() => {
    return countUpcomingDueCards(cards, clockIso, 24);
  }, [cards, clockIso]);
  const overdueNow = useMemo(() => {
    return countOverdueCards(cards, clockIso);
  }, [cards, clockIso]);
  const overdueQueueLabel = loading
    ? '--'
    : overdueNow === 0
      ? 'No overdue cards'
      : `${overdueNow.toLocaleString()} overdue`;
  const exactDueLabel = exactDateLabel(dueCard?.dueAt);
  const relativeDueLabel = dueCard ? formatDueLabel(dueCard.dueAt, clockIso) : 'Schedule unavailable';
  const asOf = asOfLabel(clockIso);
  const dueCardStateConfig = dueCard ? stateConfig(dueCard.state) : null;
  const dueCardUrgency = dueUrgency(dueCard?.dueAt, clockIso);
  const ratingIntervals = useMemo(() => (dueCard ? previewIntervals(dueCard, clockIso) : null), [dueCard, clockIso]);
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
  const lastReviewedLabel = reviewedAtLabel(lastReviewedAt);

  const trimmedWordLength = trimmedLength(word, WORD_MAX_LENGTH);
  const trimmedMeaningLength = trimmedLength(meaning, MEANING_MAX_LENGTH);
  const wordLength = trimmedWordLength;
  const meaningLength = trimmedMeaningLength;
  const notesLength = trimmedLength(notes, NOTES_MAX_LENGTH);
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
      : canAdd
        ? 'Ready to add'
        : missingWord && missingMeaning
          ? 'Word and meaning are required'
          : missingWord
            ? 'Word is required'
            : 'Meaning is required';
  const addHintTone = loading
    ? colors.subInk
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
  const isReviewBusy = pendingReviewCardId !== null;
  const isFormEditable = !loading && !isAddBusy;
  const shouldAutoFocusAddInput = !loading && !dueCard;

  useEffect(() => {
    setShowMeaning(false);
  }, [dueCard?.id]);

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
    };
  }, []);

  function focusAddForm() {
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
    if (loading || dueCard || !isFormEditable) {
      return;
    }
    const focusId = requestAnimationFrame(() => {
      wordInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(focusId);
  }, [dueCard, isFormEditable, loading]);

  function handleAddCard() {
    if (loading || addLockRef.current) {
      return;
    }
    const trimmedWord = word.trim();
    const trimmedMeaning = meaning.trim();
    const trimmedNotes = notes.trim();
    if (!trimmedWord) {
      setAddAttempted(true);
      wordInputRef.current?.focus();
      return;
    }
    if (!trimmedMeaning) {
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
      addCard(trimmedWord, trimmedMeaning, trimmedNotes || undefined);
    } catch {
      addLockRef.current = false;
      setIsAddBusy(false);
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
    if (!dueCard || pendingReviewCardId !== null || reviewLockRef.current) {
      return;
    }
    Keyboard.dismiss();
    reviewLockRef.current = true;
    let reviewed = false;
    try {
      reviewed = reviewDueCard(dueCard.id, rating);
    } catch {
      setPendingReviewCardId(null);
      reviewLockRef.current = false;
      return;
    }
    if (reviewed) {
      setPendingReviewCardId(dueCard.id);
      return;
    }
    reviewLockRef.current = false;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.backgroundOrbA} />
      <View style={styles.backgroundOrbB} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Animated.View
              style={[
                styles.headerCard,
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
                  <Text style={styles.scoreValue}>{retentionScore}%</Text>
                </View>
                <View
                  style={styles.scoreTrack}
                  accessible
                  accessibilityRole="progressbar"
                  accessibilityLabel="Retention score"
                  accessibilityValue={{ min: 0, max: 100, now: retentionScore }}
                >
                  <View style={[styles.scoreFill, { width: retentionBarWidth }]} />
                </View>
              </View>
            </Animated.View>

            <View style={styles.metrics}>
              <MetricCard label="Due now" value={loading ? Number.NaN : stats.dueNow} accent={colors.primary} />
              <MetricCard label="Overdue" value={loading ? Number.NaN : overdueNow} accent={colors.danger} />
              <MetricCard label="Upcoming 24h" value={loading ? Number.NaN : dueWithinDay} accent={colors.accent} />
              <MetricCard label="Learning" value={loading ? Number.NaN : stats.learning} accent={colors.warn} />
              <MetricCard label="Review" value={loading ? Number.NaN : stats.review} accent={colors.success} />
              <MetricCard label="Relearning" value={loading ? Number.NaN : stats.relearning} accent={colors.danger} />
              <MetricCard label="Total cards" value={loading ? Number.NaN : stats.total} accent={colors.accent} />
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
                  </View>
                </View>
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator size="small" color={colors.subInk} />
                    <Text style={styles.info}>Loading deck...</Text>
                  </View>
                ) : null}
                {!loading && !dueCard ? (
                  <View style={styles.emptyQueue}>
                    <Text style={styles.info}>No cards due. Add new words below.</Text>
                    {nextUpcomingCard ? (
                      <Text style={styles.emptyQueueMeta}>
                        Next card {formatDueLabel(nextUpcomingCard.dueAt, clockIso)} at{' '}
                        {exactDateLabel(nextUpcomingCard.dueAt)}
                      </Text>
                    ) : (
                      <Text style={styles.emptyQueueMeta}>No upcoming cards scheduled yet.</Text>
                    )}
                    <Pressable
                      style={({ pressed }) => [styles.emptyQueueAction, pressed && styles.ghostBtnPressed]}
                      onPress={focusAddForm}
                      accessibilityRole="button"
                      accessibilityLabel="Start adding words"
                      accessibilityHint="Scrolls to the add form and focuses the word input"
                    >
                      <Text style={styles.emptyQueueActionText}>Start adding words</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!loading && dueCard ? (
                  <View
                    style={[
                      styles.reviewCard,
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
                      <Text style={styles.reviewTimelineMeta}>{queuePositionLabel}</Text>
                    </View>
                    <View style={styles.reviewHeader}>
                      <Text style={styles.word} numberOfLines={2} ellipsizeMode="tail">
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
                    {!showMeaning ? <Text style={styles.revealHint}>Reveal to check meaning and notes.</Text> : null}
                    {showMeaning ? <Text style={styles.meaning}>{dueCard.meaning}</Text> : null}
                    {dueCard.notes && showMeaning ? <Text style={styles.notes}>{dueCard.notes}</Text> : null}
                    {showMeaning ? (
                      <View style={styles.metaRow}>
                        <Text style={styles.metaText}>Difficulty {formatMetricNumber(dueCard.difficulty, 1)}</Text>
                        <Text style={styles.metaText}>Stability {formatMetricNumber(dueCard.stability, 2)}d</Text>
                        <Text style={styles.metaText}>
                          Reps {dueCard.reps} · Lapses {dueCard.lapses}
                        </Text>
                      </View>
                    ) : null}

                    {!showMeaning ? (
                      <Pressable
                        style={({ pressed }) => [
                          styles.primaryBtn,
                          pressed && styles.primaryBtnPressed,
                          isReviewBusy && styles.primaryBtnDisabled,
                        ]}
                        onPress={() => setShowMeaning(true)}
                        disabled={isReviewBusy}
                        accessibilityRole="button"
                        accessibilityLabel="Reveal answer"
                        accessibilityState={{ disabled: isReviewBusy, busy: isReviewBusy }}
                      >
                        <Text style={styles.primaryBtnText}>Reveal answer</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.answerActions}>
                        <Text style={styles.answerActionsLabel}>Rate recall quality</Text>
                        <RatingRow onRate={handleRate} intervalLabels={ratingIntervalLabels} disabled={isReviewBusy} />
                        <Pressable
                          style={({ pressed }) => [
                            styles.ghostBtn,
                            pressed && styles.ghostBtnPressed,
                            isReviewBusy && styles.ghostBtnDisabled,
                          ]}
                          onPress={() => setShowMeaning(false)}
                          disabled={isReviewBusy}
                          accessibilityRole="button"
                          accessibilityLabel="Hide answer"
                          accessibilityState={{ disabled: isReviewBusy, busy: isReviewBusy }}
                        >
                          <Text style={styles.ghostBtnText}>Hide answer</Text>
                        </Pressable>
                        {isReviewBusy ? (
                          <View style={styles.reviewingHintRow}>
                            <ActivityIndicator size="small" color={colors.subInk} />
                            <Text style={styles.reviewingHint} accessibilityLiveRegion="polite">
                              Recording review...
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    )}
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
                <TextInput
                  ref={wordInputRef}
                  value={word}
                  onChangeText={setWord}
                  placeholder="Word"
                  style={[styles.input, addAttempted && missingWord && styles.inputError]}
                  placeholderTextColor={colors.subInk}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  maxLength={WORD_MAX_LENGTH}
                  selectionColor={colors.primary}
                  autoFocus={shouldAutoFocusAddInput}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Word input"
                  onSubmitEditing={() => meaningInputRef.current?.focus()}
                />
                <Text style={[styles.charCount, { color: wordCountTone }]}>
                  {formatCountLabel(wordLength, WORD_MAX_LENGTH)}
                </Text>
                {addAttempted && missingWord ? <Text style={styles.inputErrorText}>Word is required.</Text> : null}
                <TextInput
                  ref={meaningInputRef}
                  value={meaning}
                  onChangeText={setMeaning}
                  placeholder="Meaning"
                  style={[styles.input, addAttempted && missingMeaning && styles.inputError]}
                  placeholderTextColor={colors.subInk}
                  returnKeyType="next"
                  maxLength={MEANING_MAX_LENGTH}
                  selectionColor={colors.primary}
                  blurOnSubmit={false}
                  editable={isFormEditable}
                  accessibilityLabel="Meaning input"
                  onSubmitEditing={() => {
                    if (notes.trim().length === 0) {
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
                <TextInput
                  ref={notesInputRef}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notes (optional)"
                  style={[styles.input, styles.notesInput]}
                  placeholderTextColor={colors.subInk}
                  multiline
                  textAlignVertical="top"
                  maxLength={NOTES_MAX_LENGTH}
                  selectionColor={colors.primary}
                  editable={isFormEditable}
                  accessibilityLabel="Notes input"
                  returnKeyType="done"
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
  },
  reviewCardBusy: {
    opacity: 0.82,
  },
  reviewTimeline: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
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
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  reviewTimelineSubValue: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  reviewTimelineMeta: {
    color: colors.subInk,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontVariant: ['tabular-nums'],
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
  stateBadge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.85,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  urgencyBadge: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
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
