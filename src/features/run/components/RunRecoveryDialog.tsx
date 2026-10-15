import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { Radius } from '@/shared/ui/tokens/radius';
import { useUiTheme } from '@/shared/ui/useUiTheme';
import { RunMetrics } from './RunMetrics';
import { calculateAveragePaceSecondsPerKm } from '../domain/runMetrics';
import { formatRunDate } from '../services/runDisplay';
import type { useRunBootstrap } from '../hooks/useRunBootstrap';

export function RunRecoveryDialog({ recovery }: { recovery: ReturnType<typeof useRunBootstrap> }) {
  const { colors } = useUiTheme();
  const records = recovery.inspection.kind === 'required' ? recovery.inspection.records : [];
  const active = recovery.inspection.kind === 'owned' ? recovery.inspection.record : null;
  return (
    <Modal
      visible={recovery.visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
      accessibilityViewIsModal
    >
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.surface }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <AppText variant="heading" accessibilityRole="header">
              {recovery.checking
                ? '러닝 상태 확인 중'
                : active
                  ? '진행 중인 러닝이 있어요'
                  : records.length
                    ? '완료되지 않은 러닝 기록'
                    : '러닝 상태 확인 실패'}
            </AppText>
            {recovery.checking ? (
              <>
                <ActivityIndicator accessibilityLabel="러닝 상태 확인 중" />
                <AppText>저장된 상태와 위치 Task를 확인하고 있어요.</AppText>
              </>
            ) : (
              <>
                {active && (
                  <View style={styles.record}>
                    <AppText>
                      현재 러닝으로 돌아가거나 기록을 삭제하고 Home으로 이동할 수 있어요.
                    </AppText>
                    <AppText>{formatRunDate(active.startedAtMs)}</AppText>
                    <RunMetrics
                      durationMs={active.activeDurationMs}
                      distanceMeters={active.distanceMeters}
                      pace={calculateAveragePaceSecondsPerKm(
                        active.activeDurationMs,
                        active.distanceMeters,
                      )}
                    />
                    <AppButton
                      label="러닝으로 돌아가기"
                      disabled={recovery.working}
                      onPress={() => recovery.continueRun(active.id)}
                    />
                    <AppButton
                      label="기록 삭제 후 Home으로"
                      variant="danger"
                      disabled={recovery.working}
                      onPress={() => recovery.remove(active.id)}
                    />
                  </View>
                )}
                {!!records.length && (
                  <AppText>
                    이전 러닝이 정상적으로 종료되지 않았습니다.{'\n'}마지막으로 저장된 기록을
                    보관하거나 삭제할 수 있습니다.
                  </AppText>
                )}
                {recovery.inspection.kind === 'required' && recovery.inspection.ambiguous && (
                  <AppText tone="muted">
                    추적 소유권이 불명확해 자동으로 이어가지 않아요. 기존 기록은 변경하지 않았어요.
                  </AppText>
                )}
                {records.map((record) => (
                  <View key={record.id} style={styles.record}>
                    <AppText>{formatRunDate(record.startedAtMs)}</AppText>
                    <RunMetrics
                      durationMs={record.activeDurationMs}
                      distanceMeters={record.distanceMeters}
                      pace={calculateAveragePaceSecondsPerKm(
                        record.activeDurationMs,
                        record.distanceMeters,
                      )}
                    />
                    <AppButton
                      label="기록 종료 및 저장"
                      disabled={recovery.working}
                      onPress={() => recovery.save(record.id)}
                    />
                    <AppButton
                      label="기록 삭제"
                      variant="danger"
                      disabled={recovery.working}
                      onPress={() => recovery.remove(record.id)}
                    />
                  </View>
                ))}
                {recovery.working && <ActivityIndicator accessibilityLabel="복구 처리 중" />}
                {recovery.error && (
                  <>
                    <AppText accessibilityRole="alert">{recovery.error}</AppText>
                    <AppButton
                      label="상태 다시 확인"
                      disabled={recovery.working}
                      onPress={recovery.refresh}
                    />
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  dialog: {
    maxHeight: '85%',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    borderRadius: Radius.lg,
  },
  content: { padding: Spacing.xl, gap: Spacing.md },
  record: { gap: Spacing.md, paddingVertical: Spacing.md },
});
