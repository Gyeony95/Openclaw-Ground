import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  return (
    <View style={styles.row}>
      {labels.map((item) => (
        <Pressable
          key={item.rating}
          onPress={() => onRate(item.rating)}
          disabled={disabled}
          style={({ pressed }) => [
            styles.button,
            { borderColor: item.tone, backgroundColor: `${item.tone}16` },
            pressed && [styles.buttonPressed, { backgroundColor: `${item.tone}24` }],
            disabled && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${item.text}`}
          accessibilityHint={`Schedules next review ${intervalLabels?.[item.rating] ?? item.fallbackHint}`}
          accessibilityState={{ disabled }}
        >
          <Text style={[styles.buttonText, { color: item.tone }]}>{item.text}</Text>
          <Text style={styles.hint}>{intervalLabels?.[item.rating] ?? item.fallbackHint}</Text>
        </Pressable>
      ))}
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
    minHeight: 64,
    flexBasis: '48%',
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  buttonPressed: {
    transform: [{ translateY: 1 }, { scale: 0.99 }],
    opacity: 0.95,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 10.5,
    color: colors.subInk,
    letterSpacing: 0.35,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
