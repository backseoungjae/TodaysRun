import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRunPreparation } from '@/features/run/hooks/useRunPreparation';
import { CountdownOverlay } from '@/features/run/components/CountdownOverlay';
import { preparationMessage } from '@/features/run/services/preparationMessages';
import { useStore } from 'zustand';
import { runStore } from '@/features/run/store/runStore';
import { router } from 'expo-router';
import { AppButton } from '@/shared/ui/components/AppButton';
import { AppText } from '@/shared/ui/components/AppText';
import { Screen } from '@/shared/ui/components/Screen';
import { Spacing } from '@/shared/ui/tokens/spacing';

export default function HomeScreen() {
  const { state, start, cancel } = useRunPreparation();
  const activeStatus = useStore(runStore, (value) => value.status);
  const runError = useStore(runStore, (value) => value.error);
  const runBusy = useStore(runStore, (value) => value.busy);
  const busy =
    state.status === 'checkingPermission' ||
    state.status === 'waitingForLocation' ||
    state.status === 'starting';
  return (
    <Screen>
      <View style={styles.greeting}>
        <AppText variant="caption" tone="muted">
          오늘도 나만의 속도로
        </AppText>
        <AppText variant="title" accessibilityRole="header">
          반가워요!{'\n'}오늘도 함께 달려요.
        </AppText>
      </View>
      <View style={styles.start}>
        {activeStatus === 'RUNNING' || activeStatus === 'PAUSED' ? (
          <AppButton
            label="진행 중인 러닝으로"
            disabled={runBusy}
            onPress={() => router.navigate('/running')}
          />
        ) : busy ? (
          <>
            <ActivityIndicator size="large" accessibilityLabel="위치 준비 중" />
            <AppText>
              {state.status === 'checkingPermission'
                ? '시작 조건 확인 중…'
                : state.status === 'starting'
                  ? '러닝 시작 기록을 저장하고 있어요…'
                  : '정확한 GPS 위치를 기다리고 있어요…'}
            </AppText>
            <AppButton label="준비 취소" variant="secondary" onPress={cancel} />
          </>
        ) : state.status === 'failed' ? (
          <>
            <AppText accessibilityRole="alert" style={styles.center}>
              {preparationMessage(state.reason)}
            </AppText>
            <AppButton label="재시도" onPress={() => void start()} />
            <AppButton label="취소" variant="secondary" onPress={cancel} />
          </>
        ) : (
          <AppButton
            label="START"
            shape="circle"
            onPress={() => void start()}
            disabled={state.status === 'countdown'}
            accessibilityHint="위치 권한과 GPS 준비를 확인합니다. 아직 운동은 저장되지 않습니다."
          />
        )}
        <AppText tone="muted" style={styles.center}>
          위치를 준비한 뒤 카운트다운이 끝나면{'\n'}러닝 기록을 시작해요.
        </AppText>
      </View>
      {runError && <AppText accessibilityRole="alert">{runError}</AppText>}
      {state.status === 'countdown' && (
        <CountdownOverlay seconds={state.seconds} onCancel={cancel} />
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  greeting: { gap: Spacing.sm },
  start: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  center: { textAlign: 'center' },
});
