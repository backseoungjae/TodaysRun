import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { IconButton } from '@/shared/ui/components/IconButton';
import { Screen } from '@/shared/ui/components/Screen';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { Radius } from '@/shared/ui/tokens/radius';
import { useUiTheme } from '@/shared/ui/useUiTheme';
import { RunMetrics } from '@/features/run/components/RunMetrics';
import { calculateAveragePaceSecondsPerKm } from '@/features/run/domain/runMetrics';
import { formatRunDate } from '@/features/run/services/runDisplay';
import { useActivities } from './useActivities';

export default function ActivityScreen() {
  const { records, error, deleting, refresh, remove } = useActivities();
  const { colors } = useUiTheme();
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        러닝 기록
      </AppText>
      {error && (
        <>
          <AppText accessibilityRole="alert">{error}</AppText>
          <AppButton label="다시 불러오기" onPress={() => void refresh()} />
        </>
      )}
      {records === null && !error && <ActivityIndicator accessibilityLabel="기록 불러오는 중" />}
      {records?.length === 0 && (
        <View style={styles.empty}>
          <AppText variant="heading">아직 러닝 기록이 없어요</AppText>
          <AppText tone="muted">첫 러닝을 마치면 이곳에 기록이 쌓여요.</AppText>
        </View>
      )}
      {records?.map((record) => (
        <View
          key={record.id}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Pressable
            testID={`activity-record-${record.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${formatRunDate(record.startedAtMs)} 러닝 기록 보기`}
            disabled={deleting !== null}
            style={styles.details}
            onPress={() =>
              router.push({
                pathname: '/run-result/[runId]',
                params: { runId: record.id, source: 'activity' },
              })
            }
          >
            <AppText>{formatRunDate(record.startedAtMs)}</AppText>
            <RunMetrics
              durationMs={record.activeDurationMs}
              distanceMeters={record.distanceMeters}
              pace={calculateAveragePaceSecondsPerKm(
                record.activeDurationMs,
                record.distanceMeters,
              )}
            />
          </Pressable>
          <IconButton
            accessibilityLabel={`${formatRunDate(record.startedAtMs)} 러닝 기록 삭제`}
            disabled={deleting !== null}
            onPress={() => remove(record)}
          >
            <AppText accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              🗑
            </AppText>
          </IconButton>
        </View>
      ))}
    </Screen>
  );
}
const styles = StyleSheet.create({
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xxxl,
  },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  details: { gap: Spacing.md, paddingVertical: Spacing.sm },
});
