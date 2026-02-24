import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Rating } from '../types';
import { colors, radii } from '../theme';

interface RatingRowProps {
  onRate: (rating: Rating) => void;
  intervalLabels?: Partial<Record<Rating, string>>;
  disabled?: boolean;
}

const labels: Array<{ rating: Rating; text: string; fallbackHint: string; tone: string }> = [
  { rating: 1, text: 'Again', fallbackHint: 'Soon', tone: colors.danger },
  { rating: 2, text: 'Hard', fallbackHint: 'Short', tone: colors.warn },
  { rating: 3, text: 'Good', fallbackHint: 'Planned', tone: colors.primary },
  { rating: 4, text: 'Easy', fallbackHint: 'Longer', tone: colors.success },
];

export function RatingRow({ onRate, intervalLabels, disabled = false }: RatingRowProps) {
  const { width } = useWindowDimensions();
  const isCompact = width < 320;
  const isNarrow = width < 380;
  const isWide = width >= 520;

  return (
    <View style={styles.row}>
      {labels.map((item) => {
        const interval = intervalLabels?.[item.rating] ?? item.fallbackHint;
        return (
          <Pressable
            key={item.rating}
            onPress={() => onRate(item.rating)}
            disabled={disabled}
            hitSlop={6}
            android_ripple={{ color: `${item.tone}20` }}
            style={({ pressed }) => [
              styles.button,
              isNarrow ? styles.buttonNarrow : null,
              isCompact ? styles.buttonCompact : null,
              isWide ? styles.buttonWide : null,
              disabled
                ? styles.buttonDisabledSurface
                : { borderColor: item.tone, backgroundColor: `${item.tone}16` },
              pressed && !disabled && [styles.buttonPressed, { backgroundColor: `${item.tone}24` }],
              disabled && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${item.text}. Next ${interval}.`}
            accessibilityHint={disabled ? 'Wait for the current review to finish' : `Schedules next review ${interval}`}
            accessibilityState={{ disabled }}
          >
            <Text style={[styles.buttonText, { color: disabled ? colors.subInk : item.tone }]}>{item.text}</Text>
            <Text
              style={[styles.hint, { color: disabled ? colors.subInk : item.tone }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {interval}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  button: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 10,
    minWidth: 78,
    minHeight: 72,
    flexBasis: '48%',
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  buttonCompact: {
    flexBasis: '100%',
  },
  buttonNarrow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  buttonWide: {
    flexBasis: '23%',
  },
  buttonPressed: {
    transform: [{ translateY: 1 }, { scale: 0.99 }],
    opacity: 0.95,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonDisabledSurface: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  buttonText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 10.5,
    letterSpacing: 0.35,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
