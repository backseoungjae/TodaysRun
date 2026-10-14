import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { RunRecord } from '@/database/databaseTypes';
import { Screen } from '@/shared/ui/components/Screen';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { RunMetrics } from '../components/RunMetrics';
import { RunMap, type PathPoint } from '../components/RunMap';
import { calculateAveragePaceSecondsPerKm } from '../domain/runMetrics';
import { getCompletedRun, getRunPath } from '../services/runResultService';
import { formatRunDate } from '../services/runDisplay';

export default function RunResultScreen() {
  const { runId, source } = useLocalSearchParams<{ runId: string; source?: string }>();
  const id = typeof runId === 'string' ? runId : '';
  const fromActivity = source === 'activity';
  const destination = fromActivity ? '/activity' : '/';
  const back = useCallback(() => router.dismissTo(destination), [destination]);
  const [result, setResult] = useState<{
    id: string;
    record: RunRecord | null;
    path: PathPoint[];
    error: string | null;
  } | null>(null);
  const record = result?.id === id ? result.record : null;
  const error = result?.id === id ? result.error : null;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(async () => {
        if (!id) throw new Error('invalid-id');
        const value = await getCompletedRun(id);
        const path = await getRunPath(id);
        return { value, path };
      })
      .then(
        ({ value, path }) => {
          if (live) setResult({ id, record: value, path, error: null });
        },
        () => {
          if (live)
            setResult({
              id,
              record: null,
              path: [],
              error: '완료된 기록을 읽지 못했어요. 기록이 없거나 조회에 실패했어요.',
            });
        },
      );
    return () => {
      live = false;
    };
  }, [id, retry]);
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        back();
        return true;
      });
      return () => listener.remove();
    }, [back]),
  );
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: '러닝 결과',
          gestureEnabled: false,
          headerLeft: () => <AppButton label="뒤로" variant="secondary" onPress={back} />,
        }}
      />
      <AppText variant="title">러닝 결과</AppText>
      {record ? (
        <>
          {!fromActivity && <AppText>저장 완료</AppText>}
          <AppText>{formatRunDate(record.startedAtMs)}</AppText>
          <RunMetrics
            durationMs={record.activeDurationMs}
            distanceMeters={record.distanceMeters}
            pace={calculateAveragePaceSecondsPerKm(record.activeDurationMs, record.distanceMeters)}
          />
          <View style={styles.map}>
            <RunMap
              key={id}
              current={result?.path.at(-1) ?? null}
              path={result?.path ?? []}
              sheetFraction={0}
              fitPath
            />
          </View>
          {!result?.path.length && <AppText tone="muted">저장된 GPS 경로가 없어요.</AppText>}
        </>
      ) : error ? (
        <AppText accessibilityRole="alert">{error}</AppText>
      ) : (
        <>
          <ActivityIndicator accessibilityLabel="기록 상세 불러오는 중" />
          <AppText>저장된 기록을 불러오고 있어요…</AppText>
        </>
      )}
      {error && (
        <AppButton
          label="다시 불러오기"
          onPress={() => {
            setResult(null);
            setRetry((value) => value + 1);
          }}
        />
      )}
      <AppButton
        label={fromActivity ? 'Activity로' : 'Home으로'}
        variant="secondary"
        onPress={back}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  map: { height: 320, position: 'relative', overflow: 'hidden' },
});
