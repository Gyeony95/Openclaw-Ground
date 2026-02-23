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
    minHeight: 108,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 15,
    justifyContent: 'space-between',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 15,
    elevation: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accent: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  value: {
    fontSize: 31,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.95,
  },
});
