import { StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '../theme';

interface MetricCardProps {
  label: string;
  value: number;
  accent?: string;
}

export function MetricCard({ label, value, accent = colors.primary }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.accent, { backgroundColor: accent }]} />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: '48%',
    minHeight: 104,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: 'space-between',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accent: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  value: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
