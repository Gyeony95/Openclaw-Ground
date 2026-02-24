import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
  { rating: 1, text: 'Again', fallbackHint: 'In minutes', tone: colors.danger },
  { rating: 2, text: 'Hard', fallbackHint: 'Keep short', tone: colors.warn },
  { rating: 3, text: 'Good', fallbackHint: 'On schedule', tone: colors.primary },
  { rating: 4, text: 'Easy', fallbackHint: 'Stretch out', tone: colors.success },
];

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
  const isCompact = width < 320;
  const isNarrow = width < 380;
  const isWide = width >= 520;
  const intervalLineCount = isCompact ? 1 : 2;
  const isDisabled = disabled || busy;
  const disabledSet = useMemo(() => new Set(disabledRatings), [disabledRatings]);
  const hasLockedRatings = disabledRatings.length > 0;
  const lockReasonHint = lockedHint ?? 'Some ratings are locked for this review.';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {labels.map((item) => {
          const interval = resolveIntervalLabel(intervalLabels, item.rating, item.fallbackHint);
          const ratingDisabled = isDisabled || disabledSet.has(item.rating);
          const isRatingLocked = !isDisabled && disabledSet.has(item.rating);
          const contentTone = isRatingLocked ? item.tone : ratingDisabled ? colors.subInk : item.tone;
          const accessibilityLabel = isRatingLocked
            ? `Rate ${item.text}. Locked. ${lockReasonHint}`
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
              hitSlop={6}
              android_ripple={ratingDisabled ? undefined : { color: `${item.tone}20` }}
              style={({ pressed }) => [
                styles.button,
                isNarrow ? styles.buttonNarrow : null,
                isCompact ? styles.buttonCompact : null,
                isWide ? styles.buttonWide : null,
                busy ? styles.buttonBusy : null,
                ratingDisabled
                  ? styles.buttonDisabledSurface
                  : { borderColor: item.tone, backgroundColor: `${item.tone}16` },
                isRatingLocked ? styles.buttonLocked : null,
                pressed && !ratingDisabled && [styles.buttonPressed, { backgroundColor: `${item.tone}24` }],
                ratingDisabled && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityHint={
                busy
                  ? 'Saving current review, rating buttons are temporarily disabled'
                  : isRatingLocked
                    ? lockReasonHint
                    : ratingDisabled
                      ? 'Rating is currently unavailable'
                      : `Schedules next review ${interval}`
              }
              accessibilityState={{ disabled: ratingDisabled, busy: busy || undefined }}
            >
              <Text style={[styles.buttonText, { color: contentTone }]} numberOfLines={1}>
                {item.text}
              </Text>
              {isRatingLocked ? <Text style={[styles.lockedLabel, { color: item.tone }]}>Locked</Text> : null}
              <View style={styles.intervalMeta}>
                <Text style={[styles.hintLabel, { color: contentTone }]} numberOfLines={1}>
                  Next
                </Text>
                <Text
                  style={[styles.hint, styles.hintCentered, { color: contentTone }]}
                  numberOfLines={intervalLineCount}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {interval}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {busy ? (
        <Text style={styles.lockedHint} accessibilityLiveRegion="polite">
          Recording review...
        </Text>
      ) : null}
      {hasLockedRatings && !busy ? (
        <Text style={styles.lockedHint} accessibilityLiveRegion="polite">
          {lockReasonHint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  intervalMeta: {
    alignItems: 'center',
    gap: 2,
  },
  button: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 13,
    paddingHorizontal: 10,
    minWidth: 78,
    minHeight: 94,
    flexBasis: '48%',
    flex: 1,
    alignItems: 'center',
    gap: 7,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  buttonCompact: {
    flexBasis: '100%',
  },
  buttonNarrow: {
    paddingVertical: 11,
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
    opacity: 0.72,
  },
  buttonDisabledSurface: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  buttonLocked: {
    borderStyle: 'dashed',
    opacity: 0.94,
    backgroundColor: colors.surfaceAlt,
  },
  buttonText: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  hintLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  lockedLabel: {
    fontSize: 9.5,
    letterSpacing: 0.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: colors.subInk,
  },
  lockedHint: {
    fontSize: 11,
    color: colors.subInk,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hint: {
    fontSize: 12,
    letterSpacing: 0.35,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  hintCentered: {
    textAlign: 'center',
  },
});
