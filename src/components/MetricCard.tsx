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
  const isVeryNarrow = width < 320;
  const hasValue = Number.isFinite(value);
  const normalizedValue = hasValue ? Math.max(0, Math.round(value)) : null;
  const displayValue = normalizedValue !== null ? normalizedValue.toLocaleString() : '--';
  const accessibilityValue = hasValue ? displayValue : 'loading';
  const statusLabel = hasValue ? 'Now' : 'Loading';
  const statusTone = hasValue ? colors.subInk : colors.warn;

  return (
    <View
      style={[styles.card, isNarrow && styles.cardNarrow]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${accessibilityValue}`}
      accessibilityHint={hasValue ? 'Metric is up to date.' : 'Metric is loading and will update shortly.'}
      accessibilityLiveRegion={hasValue ? 'none' : 'polite'}
    >
      <View style={[styles.topBorder, { backgroundColor: accent }]} />
      <View style={[styles.accentWash, { backgroundColor: `${accent}12` }]} />
      <View style={[styles.head, isVeryNarrow && styles.headCompact]}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.label} numberOfLines={2} ellipsizeMode="tail" maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        <View style={[styles.badge, isVeryNarrow && styles.badgeCompact, !hasValue && styles.badgeMuted]}>
          <Text style={[styles.badgeText, { color: statusTone }]} maxFontSizeMultiplier={1.3}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text
        style={[styles.value, isNarrow && styles.valueNarrow, !hasValue && styles.valueUnavailable]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        maxFontSizeMultiplier={1.3}
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
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
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
  accentWash: {
    position: 'absolute',
    top: 2,
    right: -18,
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 24,
  },
  headCompact: {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  badge: {
    marginLeft: 'auto',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeCompact: {
    marginLeft: 0,
  },
  badgeMuted: {
    opacity: 0.85,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.subInk,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  value: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  valueNarrow: {
    fontSize: 27,
  },
  valueUnavailable: {
    color: colors.subInk,
  },
  label: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.subInk,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    flexShrink: 1,
    lineHeight: 14,
  },
});
