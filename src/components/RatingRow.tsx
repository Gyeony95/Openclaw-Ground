import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Rating } from '../types';
import { colors, radii } from '../theme';

interface RatingRowProps {
  onRate: (rating: Rating) => void;
  intervalLabels?: Partial<Record<Rating, string>>;
  disabled?: boolean;
  busy?: boolean;
  disabledRatings?: Rating[];
  lockedHint?: string;
}

const labels: Array<{ rating: Rating; text: string; fallbackHint: string; tone: string }> = [
  { rating: 1, text: 'Again', fallbackHint: 'Retry soon', tone: colors.danger },
  { rating: 2, text: 'Hard', fallbackHint: 'Short step', tone: colors.warn },
  { rating: 3, text: 'Good', fallbackHint: 'On track', tone: colors.primary },
  { rating: 4, text: 'Easy', fallbackHint: 'Long step', tone: colors.success },
];
const validRatings = new Set<Rating>(labels.map((item) => item.rating));

function resolveIntervalLabel(
  intervalLabels: RatingRowProps['intervalLabels'],
  rating: Rating,
  fallbackHint: string,
): string {
  const raw = intervalLabels?.[rating];
  if (typeof raw !== 'string') {
    return fallbackHint;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : fallbackHint;
}

export function RatingRow({
  onRate,
  intervalLabels,
  disabled = false,
  busy = false,
  disabledRatings = [],
  lockedHint,
}: RatingRowProps) {
  const { width } = useWindowDimensions();
  // Keep tap targets readable on smaller phones by stacking sooner.
  const isCompact = width < 340;
  const isVeryNarrow = width < 320;
  const isNarrow = width < 380;
  const isWide = width >= 560;
  const intervalLineCount = isVeryNarrow ? 1 : 2;
  const isDisabled = disabled || busy;
  const disabledSet = useMemo(
    () => new Set(disabledRatings.filter((rating): rating is Rating => validRatings.has(rating))),
    [disabledRatings],
  );
  const hasLockedRatings = !isDisabled && disabledSet.size > 0;
  const againInterval = resolveIntervalLabel(intervalLabels, 1, labels[0].fallbackHint);
  const lockReasonHint =
    lockedHint ?? `Incorrect selection locked this step. Choose Again (${againInterval}) to continue.`;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {labels.map((item) => {
          const interval = resolveIntervalLabel(intervalLabels, item.rating, item.fallbackHint);
          const ratingDisabled = isDisabled || disabledSet.has(item.rating);
          const isRatingLocked = !isDisabled && disabledSet.has(item.rating);
          const lockedIntervalText = `Again ${againInterval}`;
          const intervalText = isRatingLocked ? lockedIntervalText : interval;
          const intervalPrefix = isRatingLocked ? 'Use' : 'Next';
          const contentTone = isRatingLocked ? colors.warn : ratingDisabled ? colors.subInk : item.tone;
          const lockTone = isRatingLocked ? colors.warn : contentTone;
          const accessibilityLabel = busy
            ? `Rate ${item.text}. Saving in progress.`
            : isRatingLocked
              ? `Rate ${item.text}. Locked. Use Again to continue. ${lockReasonHint}`
              : ratingDisabled
                ? `Rate ${item.text}. Unavailable.`
                : `Rate ${item.text}. Next interval ${interval}.`;
          return (
            <Pressable
              key={item.rating}
              onPress={() => {
                if (ratingDisabled) {
                  return;
                }
                onRate(item.rating);
              }}
              disabled={ratingDisabled}
              hitSlop={8}
              pressRetentionOffset={12}
              android_ripple={ratingDisabled ? undefined : { color: `${item.tone}20` }}
              style={({ pressed }) => [
                styles.button,
                isNarrow ? styles.buttonNarrow : null,
                isCompact ? styles.buttonCompact : null,
                isVeryNarrow ? styles.buttonVeryNarrow : null,
                isWide ? styles.buttonWide : null,
                busy ? styles.buttonBusy : null,
                ratingDisabled
                  ? styles.buttonDisabledSurface
                  : { borderColor: item.tone, backgroundColor: `${item.tone}16` },
                isRatingLocked
                  ? [styles.buttonLocked, { borderColor: `${item.tone}88`, backgroundColor: colors.surfaceAlt }]
                  : null,
                pressed && !ratingDisabled && [styles.buttonPressed, { backgroundColor: `${item.tone}24` }],
                ratingDisabled && !isRatingLocked && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityHint={
                busy
                  ? 'Saving current review, rating buttons are temporarily disabled'
                  : isRatingLocked
                    ? `Use Again to record this attempt. ${lockReasonHint}`
                    : ratingDisabled
                      ? 'Rating is currently unavailable'
                      : `Schedules next review ${interval}`
              }
              accessibilityState={{ disabled: ratingDisabled, busy: busy || undefined }}
            >
              <Text style={[styles.buttonText, { color: contentTone }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {item.text}
              </Text>
              {isRatingLocked ? (
                <Text style={[styles.lockedLabel, { color: lockTone }]} maxFontSizeMultiplier={1.2}>
                  Locked
                </Text>
              ) : null}
              <View style={styles.intervalMeta}>
                <Text style={[styles.hintLabel, { color: contentTone }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {intervalPrefix}
                </Text>
                <Text
                  style={[styles.hint, styles.hintCentered, { color: contentTone }]}
                  numberOfLines={intervalLineCount}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.3}
                >
                  {intervalText}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {busy ? (
        <View style={styles.busyRow} accessibilityLiveRegion="polite" accessibilityRole="status">
          <ActivityIndicator size="small" color={colors.subInk} />
          <Text style={styles.lockedHint}>Recording review...</Text>
        </View>
      ) : null}
      {hasLockedRatings && !busy ? (
        <Text style={styles.lockedHint} accessibilityLiveRegion="polite" accessibilityRole="status">
          {lockReasonHint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 11,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  intervalMeta: {
    alignItems: 'center',
    gap: 3,
  },
  button: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 10,
    minWidth: 80,
    minHeight: 104,
    flexBasis: '48%',
    flex: 1,
    alignItems: 'center',
    gap: 7,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  buttonCompact: {
    flexBasis: '100%',
  },
  buttonVeryNarrow: {
    minHeight: 98,
    paddingHorizontal: 6,
  },
  buttonNarrow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  buttonBusy: {
    opacity: 0.88,
  },
  buttonWide: {
    flexBasis: '23%',
  },
  buttonPressed: {
    transform: [{ translateY: 1 }, { scale: 0.985 }],
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.82,
  },
  buttonDisabledSurface: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  buttonLocked: {
    borderStyle: 'dashed',
    opacity: 0.94,
  },
  buttonText: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.64,
    textTransform: 'uppercase',
  },
  hintLabel: {
    fontSize: 10,
    letterSpacing: 0.55,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  lockedLabel: {
    fontSize: 9,
    letterSpacing: 0.45,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.subInk,
  },
  lockedHint: {
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.subInk,
    fontWeight: '600',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  hint: {
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  hintCentered: {
    textAlign: 'center',
  },
});
