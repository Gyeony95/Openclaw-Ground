import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Rating } from '../types';
import { colors } from '../theme';

interface RatingRowProps {
  onRate: (rating: Rating) => void;
}

const labels: Array<{ rating: Rating; text: string; tone: string }> = [
  { rating: 1, text: 'Again', tone: colors.danger },
  { rating: 2, text: 'Hard', tone: colors.warn },
  { rating: 3, text: 'Good', tone: colors.primary },
  { rating: 4, text: 'Easy', tone: colors.success },
];

export function RatingRow({ onRate }: RatingRowProps) {
  return (
    <View style={styles.row}>
      {labels.map((item) => (
        <TouchableOpacity
          key={item.rating}
          onPress={() => onRate(item.rating)}
          style={[styles.button, { borderColor: item.tone }]}
          accessibilityRole="button"
          accessibilityLabel={`Rate ${item.text}`}
        >
          <Text style={[styles.buttonText, { color: item.tone }]}>{item.text}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  button: {
    borderWidth: 1.4,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 72,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
