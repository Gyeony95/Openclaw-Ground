import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, radii } from '../theme';

interface MetricCardProps {
  label: string;
  value: number;
  accent?: string;
}

export function MetricCard({ label, value, accent = colors.primary }: MetricCardProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 360;
  const displayValue = Number.isFinite(value) ? value.toLocaleString() : '--';

  return (
    <View style={[styles.card, isNarrow && styles.cardNarrow]} accessible accessibilityLabel={`${label}: ${displayValue}`}>
      <View style={[styles.topBorder, { backgroundColor: accent }]} />
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text
        style={[styles.value, isNarrow && styles.valueNarrow]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {displayValue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 112,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 15,
    paddingVertical: 15,
    justifyContent: 'space-between',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    overflow: 'hidden',
  },
  cardNarrow: {
    flexBasis: '100%',
    minHeight: 100,
  },
  topBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  value: {
    fontSize: 29,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  valueNarrow: {
    fontSize: 26,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
});
