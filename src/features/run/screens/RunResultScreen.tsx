import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { RunRecord } from '@/database/databaseTypes';
import { Screen } from '@/shared/ui/components/Screen';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { RunMetrics } from '../components/RunMetrics';
import { calculateAveragePaceSecondsPerKm } from '../domain/runMetrics';
import { getCompletedRun } from '../services/runResultService';

export default function RunResultScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const id = typeof runId === 'string' ? runId : '';
  const [result, setResult] = useState<{
    id: string;
    record: RunRecord | null;
    error: string | null;
  } | null>(null);
  const record = result?.id === id ? result.record : null;
  const error = result?.id === id ? result.error : null;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => {
        if (!id) throw new Error('invalid-id');
        return getCompletedRun(id);
      })
      .then(
        (value) => {
          if (live) setResult({ id, record: value, error: null });
        },
        () => {
          if (live)
            setResult({
              id,
              record: null,
              error: '완료된 기록을 읽지 못했어요. 다시 시도해 주세요.',
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
        router.dismissTo('/');
        return true;
      });
      return () => listener.remove();
    }, []),
  );
  return (
    <Screen>
      <AppText variant="title">러닝 결과</AppText>
      {record ? (
        <>
          <AppText>저장 완료</AppText>
          <AppText>{new Date(record.startedAtMs).toLocaleString('ko-KR')}</AppText>
          <RunMetrics
            durationMs={record.activeDurationMs}
            distanceMeters={record.distanceMeters}
            pace={calculateAveragePaceSecondsPerKm(record.activeDurationMs, record.distanceMeters)}
          />
        </>
      ) : (
        <AppText>{error ?? '저장된 기록을 불러오고 있어요…'}</AppText>
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
      <AppButton label="Home으로" variant="secondary" onPress={() => router.dismissTo('/')} />
    </Screen>
  );
}
