import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { countUpcomingDueCards, useDeck } from './src/hooks';
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
  return `Last review ${new Date(lastReviewedAt).toLocaleString()}`;
}

function exactDateLabel(iso?: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) {
    return 'Schedule unavailable';
  }
  return new Date(iso).toLocaleString();
}

function asOfLabel(iso: string): string {
  if (!Number.isFinite(Date.parse(iso))) {
    return 'Clock unavailable';
  }
  return `As of ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function formatMetricNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  return value.toFixed(digits);
}

function queueTone({
  label,
  loading,
  hasDueCard,
}: {
  label: string;
  loading: boolean;
  hasDueCard: boolean;
}): string {
  if (loading) {
    return colors.subInk;
  }
  if (!hasDueCard) {
    return colors.success;
  }
  if (label === 'Due date unavailable') {
    return colors.warn;
  }
  if (label.startsWith('Overdue') || label === 'Due now') {
    return colors.danger;
  }
  return colors.primary;
}

export default function App() {
  const { loading, cards, dueCards, stats, addCard, reviewDueCard, clockIso, lastReviewedAt } = useDeck();
  const { width } = useWindowDimensions();
  const [word, setWord] = useState('');
  const [meaning, setMeaning] = useState('');
  const [notes, setNotes] = useState('');
  const [showMeaning, setShowMeaning] = useState(false);
  const [pendingReviewCardId, setPendingReviewCardId] = useState<string | null>(null);
  const [entryAnim] = useState(() => new Animated.Value(0));
  const meaningInputRef = useRef<TextInput>(null);
  const notesInputRef = useRef<TextInput>(null);

  const dueCard = dueCards[0];
  const retentionScore = useMemo(() => {
    if (stats.total === 0) {
      return 0;
    }
    return clampPercent(((stats.review + stats.relearning * 0.5 + stats.learning * 0.2) / stats.total) * 100);
  }, [stats]);
  const retentionBarWidth = `${retentionScore}%`;
  const queueLabel = loading ? 'Loading' : dueCard ? formatDueLabel(dueCard.dueAt, clockIso) : 'Queue clear';
  const queueLabelTone = queueTone({ label: queueLabel, loading, hasDueCard: Boolean(dueCard) });
  const queueShareLabel = loading ? '--' : `${stats.dueNow} due / ${stats.total} total`;
  const dueWithinDay = useMemo(() => {
    return countUpcomingDueCards(cards, clockIso, 24);
  }, [cards, clockIso]);
  const exactDueLabel = exactDateLabel(dueCard?.dueAt);
  const relativeDueLabel = dueCard ? formatDueLabel(dueCard.dueAt, clockIso) : 'Schedule unavailable';
  const asOf = asOfLabel(clockIso);
  const dueCardStateConfig = dueCard ? stateConfig(dueCard.state) : null;
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

  const canAdd = useMemo(() => word.trim().length > 0 && meaning.trim().length > 0, [word, meaning]);
  const noteCountTone = notes.length >= 220 ? colors.warn : colors.subInk;
  const isWideLayout = width >= 980;
  const isReviewBusy = pendingReviewCardId !== null;

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

  function handleAddCard() {
    if (!canAdd) {
      return;
    }
    addCard(word, meaning, notes);
    setWord('');
    setMeaning('');
    setNotes('');
  }

  function handleRate(rating: Rating) {
    if (!dueCard || pendingReviewCardId !== null) {
      return;
    }
    const reviewed = reviewDueCard(dueCard.id, rating);
    if (reviewed) {
      setPendingReviewCardId(dueCard.id);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.backgroundOrbA} />
      <View style={styles.backgroundOrbB} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <ScrollView
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
              <Text style={styles.title}>Retention Dashboard</Text>
              <Text style={styles.subtitle}>FSRS-inspired scheduler calibrated for consistent long-term recall.</Text>
              <View style={styles.heroTags}>
                <Text style={[styles.heroTag, { color: queueLabelTone }]}>{queueLabel}</Text>
                <Text style={styles.heroTag}>{queueShareLabel}</Text>
              </View>
              <View style={styles.metaLine}>
                <Text style={styles.subMeta}>{lastReviewedLabel}</Text>
                <Text style={styles.asOfMeta}>{asOf}</Text>
              </View>
              <View style={styles.scoreRow}>
                <View style={styles.scoreHeader}>
                  <Text style={styles.scoreLabel}>Retention score</Text>
                  <Text style={styles.scoreValue}>{retentionScore}%</Text>
                </View>
                <View style={styles.scoreTrack}>
                  <View style={[styles.scoreFill, { width: retentionBarWidth }]} />
                </View>
              </View>
            </Animated.View>

            <View style={styles.metrics}>
              <MetricCard label="Due now" value={stats.dueNow} accent={colors.primary} />
              <MetricCard label="Upcoming <=24h" value={dueWithinDay} accent={colors.accent} />
              <MetricCard label="Learning" value={stats.learning} accent={colors.warn} />
              <MetricCard label="Review" value={stats.review} accent={colors.success} />
              <MetricCard label="Relearning" value={stats.relearning} accent={colors.danger} />
              <MetricCard label="Total cards" value={stats.total} accent={colors.accent} />
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
                    <Text style={styles.panelTitle}>Review Queue</Text>
                    <Text style={styles.panelSubtitle}>Prioritized by due time and recency</Text>
                  </View>
                  <View style={styles.panelKpiWrap}>
                    <Text style={[styles.panelKpi, { color: queueLabelTone }]}>{queueLabel}</Text>
                    <Text style={styles.panelSubKpi}>{queueShareLabel}</Text>
                  </View>
                </View>
                {loading ? <Text style={styles.info}>Loading deck...</Text> : null}
                {!loading && !dueCard ? <Text style={styles.info}>No cards due. Add new words below.</Text> : null}
                {!loading && dueCard ? (
                  <View style={styles.reviewCard}>
                    <View style={styles.reviewTimeline}>
                      <Text style={styles.reviewTimelineLabel}>Scheduled for</Text>
                      <Text style={styles.reviewTimelineValue}>{exactDueLabel}</Text>
                      <Text style={styles.reviewTimelineSubValue}>{relativeDueLabel}</Text>
                    </View>
                    <View style={styles.reviewHeader}>
                      <Text style={styles.word}>{dueCard.word}</Text>
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
                    </View>
                    {!showMeaning ? <Text style={styles.revealHint}>Reveal to check meaning and notes.</Text> : null}
                    {showMeaning ? <Text style={styles.meaning}>{dueCard.meaning}</Text> : null}
                    {dueCard.notes && showMeaning ? <Text style={styles.notes}>{dueCard.notes}</Text> : null}
                    {showMeaning ? (
                      <View style={styles.metaRow}>
                        <Text style={styles.metaText}>Difficulty {formatMetricNumber(dueCard.difficulty, 1)}</Text>
                        <Text style={styles.metaText}>Stability {formatMetricNumber(dueCard.stability, 2)}d</Text>
                        <Text style={styles.metaText}>{formatDueLabel(dueCard.dueAt, clockIso)}</Text>
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
                      >
                        <Text style={styles.primaryBtnText}>Reveal answer</Text>
                      </Pressable>
                    ) : (
                      <View style={styles.answerActions}>
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
                        >
                          <Text style={styles.ghostBtnText}>Hide answer</Text>
                        </Pressable>
                        {isReviewBusy ? <Text style={styles.reviewingHint}>Recording review...</Text> : null}
                      </View>
                    )}
                  </View>
                ) : null}
              </View>
              <View style={[styles.panel, styles.addPanel, isWideLayout && styles.panelWide]}>
                <View style={styles.panelTitleWrap}>
                  <Text style={styles.panelTitle}>Add Vocabulary</Text>
                  <Text style={styles.panelSubtitle}>Keep entries precise and compact</Text>
                </View>
                <Text style={styles.info}>Capture one precise definition and optional context note.</Text>
                <TextInput
                  value={word}
                  onChangeText={setWord}
                  placeholder="Word"
                  style={styles.input}
                  placeholderTextColor={colors.subInk}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  maxLength={80}
                  accessibilityLabel="Word input"
                  onSubmitEditing={() => meaningInputRef.current?.focus()}
                />
                <TextInput
                  ref={meaningInputRef}
                  value={meaning}
                  onChangeText={setMeaning}
                  placeholder="Meaning"
                  style={styles.input}
                  placeholderTextColor={colors.subInk}
                  returnKeyType="next"
                  maxLength={180}
                  accessibilityLabel="Meaning input"
                  onSubmitEditing={() => notesInputRef.current?.focus()}
                />
                <TextInput
                  ref={notesInputRef}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notes (optional)"
                  style={[styles.input, styles.notesInput]}
                  placeholderTextColor={colors.subInk}
                  multiline
                  maxLength={240}
                  accessibilityLabel="Notes input"
                  returnKeyType="done"
                  blurOnSubmit
                  onSubmitEditing={handleAddCard}
                />
                <Text style={[styles.charCount, { color: noteCountTone }]}>{notes.length}/240</Text>

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
                >
                  <Text style={styles.primaryBtnText}>Add card</Text>
                </Pressable>
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
    textTransform: 'uppercase',
    letterSpacing: 0.55,
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
  info: {
    color: colors.subInk,
    fontSize: 13,
    lineHeight: 19,
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
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
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
});
