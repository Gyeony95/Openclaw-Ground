import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Rating } from '../types';
import { colors, radii } from '../theme';

interface RatingRowProps {
  onRate: (rating: Rating) => void;
  intervalLabels?: Partial<Record<Rating, string>>;
  disabled?: boolean;
  busy?: boolean;
  disabledRatings?: Rating[];
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
}: RatingRowProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 320;
  const isNarrow = width < 380;
  const isWide = width >= 520;
  const intervalLineCount = isCompact ? 1 : 2;
  const isDisabled = disabled || busy;

  return (
    <View style={styles.container}>
      {busy ? (
        <View style={styles.busyRow} accessibilityRole="alert" accessibilityLabel="Saving review">
          <ActivityIndicator size="small" color={colors.subInk} />
          <Text style={styles.busyLabel} accessibilityLiveRegion="polite">
            Saving review...
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        {labels.map((item) => {
          const interval = resolveIntervalLabel(intervalLabels, item.rating, item.fallbackHint);
          const ratingDisabled = isDisabled || disabledRatings.includes(item.rating);
          return (
            <Pressable
              key={item.rating}
              onPress={() => onRate(item.rating)}
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
                pressed && !ratingDisabled && [styles.buttonPressed, { backgroundColor: `${item.tone}24` }],
                ratingDisabled && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Rate ${item.text}. Next ${interval}.`}
              accessibilityHint={
                busy
                  ? 'Saving current review, rating buttons are temporarily disabled'
                  : ratingDisabled
                    ? 'Rating is currently unavailable'
                    : `Schedules next review ${interval}`
              }
              accessibilityState={{ disabled: ratingDisabled, busy }}
            >
              <Text style={[styles.buttonText, { color: ratingDisabled ? colors.subInk : item.tone }]} numberOfLines={1}>
                {item.text}
              </Text>
              <Text style={[styles.hintLabel, { color: ratingDisabled ? colors.subInk : item.tone }]} numberOfLines={1}>
                Next
              </Text>
              <Text
                style={[styles.hint, styles.hintCentered, { color: ratingDisabled ? colors.subInk : item.tone }]}
                numberOfLines={intervalLineCount}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {interval}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  busyLabel: {
    fontSize: 12,
    color: colors.subInk,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
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
    gap: 6,
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
    transform: [{ translateY: 1 }, { scale: 0.99 }],
    opacity: 0.95,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  buttonDisabledSurface: {
    borderColor: colors.border,
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
  hint: {
    fontSize: 11.5,
    letterSpacing: 0.35,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  hintCentered: {
    textAlign: 'center',
  },
});
