import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

interface MetricCardProps {
  label: string;
  value: number;
}

export function MetricCard({ label, value }: MetricCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 90,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    justifyContent: 'space-between',
  },
  value: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
