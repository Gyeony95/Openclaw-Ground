import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Rating } from '../types';
import { colors, radii } from '../theme';

interface RatingRowProps {
  onRate: (rating: Rating) => void;
  intervalLabels?: Partial<Record<Rating, string>>;
}

const labels: Array<{ rating: Rating; text: string; fallbackHint: string; tone: string }> = [
  { rating: 1, text: 'Again', fallbackHint: 'Soon', tone: colors.danger },
  { rating: 2, text: 'Hard', fallbackHint: 'Short', tone: colors.warn },
  { rating: 3, text: 'Good', fallbackHint: 'Planned', tone: colors.primary },
  { rating: 4, text: 'Easy', fallbackHint: 'Longer', tone: colors.success },
];

export function RatingRow({ onRate, intervalLabels }: RatingRowProps) {
  return (
    <View style={styles.row}>
      {labels.map((item) => (
        <Pressable
          key={item.rating}
          onPress={() => onRate(item.rating)}
          style={({ pressed }) => [
            styles.button,
            { borderColor: item.tone, backgroundColor: `${item.tone}16` },
            pressed && styles.buttonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${item.text}`}
          accessibilityHint={`Schedules next review ${intervalLabels?.[item.rating] ?? item.fallbackHint}`}
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
    gap: 10,
  },
  button: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 12,
    paddingHorizontal: 10,
    minWidth: 72,
    minHeight: 64,
    flexBasis: '48%',
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  buttonPressed: {
    transform: [{ translateY: 1 }],
    opacity: 0.94,
  },
  buttonText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 11,
    color: colors.subInk,
    letterSpacing: 0.1,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
