import { StyleSheet, View } from 'react-native';
import { RunMap } from '../components/RunMap';
import { RunSheet } from '../components/RunSheet';
import { AppText } from '@/shared/ui/components/AppText';
import { RunMetrics } from '../components/RunMetrics';
import { useStore } from 'zustand';
import { runStore } from '../store/runStore';
import { useRunningActions } from '../hooks/useRunningActions';
import { AppButton } from '@/shared/ui/components/AppButton';
import { router } from 'expo-router';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { useState } from 'react';

function RunningMap({
  sheetFraction,
  containerHeight,
}: {
  sheetFraction: number;
  containerHeight: number;
}) {
  const current = useStore(runStore, (state) => state.current);
  const path = useStore(runStore, (state) => state.path);
  return (
    <RunMap
      current={current}
      path={path}
      sheetFraction={sheetFraction}
      containerHeight={containerHeight}
    />
  );
}
function RunningMetrics({ compact }: { compact: boolean }) {
  const durationMs = useStore(runStore, (state) => state.durationMs);
  const distanceMeters = useStore(runStore, (state) => state.distanceMeters);
  const pace = useStore(runStore, (state) => state.pace);
  return (
    <RunMetrics
      durationMs={durationMs}
      distanceMeters={distanceMeters}
      pace={pace}
      compact={compact}
    />
  );
}

export default function RunningScreen() {
  const [sheetIndex, setSheetIndex] = useState(1);
  const [containerHeight, setContainerHeight] = useState(0);
  const { status, busy, error, id, pause, resume, finish, showResult } = useRunningActions();
  if (!id || status === null)
    return (
      <View style={styles.empty}>
        <AppText>진행 중인 러닝이 없어요. Home에서 시작해 주세요.</AppText>
        <AppButton label="Home으로" onPress={() => router.dismissTo('/')} />
      </View>
    );
  return (
    <View
      collapsable={false}
      style={styles.root}
      onLayout={(event) => setContainerHeight(event.nativeEvent.layout.height)}
    >
      <RunningMap sheetFraction={sheetIndex === 0 ? 0.3 : 0.7} containerHeight={containerHeight} />
      <RunSheet
        key={id}
        status={status === 'COMPLETED' ? null : status}
        disabled={busy}
        onPause={pause}
        onResume={resume}
        onFinish={finish}
        onSnap={setSheetIndex}
        containerHeight={containerHeight}
      >
        <RunningMetrics compact={sheetIndex === 0} />
        {error && <AppText accessibilityRole="alert">{error}</AppText>}
        {status === 'COMPLETED' && (
          <AppButton label="저장된 결과 보기" onPress={() => showResult(id)} />
        )}
      </RunSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
});
