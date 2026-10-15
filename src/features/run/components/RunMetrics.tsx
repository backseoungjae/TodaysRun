import { StyleSheet, View } from 'react-native';
import { AppText } from '@/shared/ui/components/AppText';
import { formatDuration, formatPace, formatDistance } from '../services/runDisplay';
import { Spacing } from '@/shared/ui/tokens/spacing';

export function RunMetrics({
  durationMs,
  distanceMeters,
  pace,
  compact = false,
}: {
  durationMs: number;
  distanceMeters: number;
  pace: number | null;
  compact?: boolean;
}) {
  if (compact)
    return (
      <View style={styles.row}>
        <AppText testID="run-duration" variant="button" numberOfLines={1} style={styles.metric}>
          시간 {formatDuration(durationMs)}
        </AppText>
        <AppText testID="run-distance" variant="button" numberOfLines={1} style={styles.metric}>
          거리 {formatDistance(distanceMeters)}km
        </AppText>
        <AppText testID="run-pace" variant="button" numberOfLines={1} style={styles.metric}>
          페이스 {formatPace(pace)}/km
        </AppText>
      </View>
    );
  return (
    <View style={styles.row}>
      <View style={styles.metric}>
        <AppText tone="muted">시간</AppText>
        <AppText testID="run-duration" variant="heading">
          {formatDuration(durationMs)}
        </AppText>
      </View>
      <View style={styles.metric}>
        <AppText tone="muted">거리 · km</AppText>
        <AppText testID="run-distance" variant="heading">
          {formatDistance(distanceMeters)}
        </AppText>
      </View>
      <View style={styles.metric}>
        <AppText tone="muted">페이스 · /km</AppText>
        <AppText testID="run-pace" variant="heading">
          {formatPace(pace)}
        </AppText>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1 },
});
