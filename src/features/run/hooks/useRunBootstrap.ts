import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import { getRunService } from '../services/runRuntime';
import { getRecoveryService } from '../services/recoveryRuntime';
import type { RecoveryInspection } from '../services/runRecovery';

type BootstrapState = { checking: boolean; inspection: RecoveryInspection; error: string | null };
export function useRunBootstrap() {
  const navigation = useRootNavigationState();
  const [state, setState] = useState<BootstrapState>({
    checking: Platform.OS === 'android',
    inspection: { kind: 'none' },
    error: null,
  });
  const [working, setWorking] = useState(false);
  const live = useRef(false),
    generation = useRef(0),
    busy = useRef(false),
    alertVisible = useRef(false);
  const inspect = useCallback(async () => {
    const request = ++generation.current;
    try {
      const service = await getRecoveryService();
      const inspection = await service.inspect();
      if (!live.current || request !== generation.current) return;
      if (inspection.kind === 'owned') {
        await (await getRunService()).attach(inspection.record.id);
        if (!live.current || request !== generation.current) return;
        router.replace('/running');
      }
      setState({ checking: false, inspection, error: null });
    } catch {
      if (live.current && request === generation.current)
        setState((previous) => ({
          ...previous,
          checking: false,
          error:
            '러닝 상태나 남은 위치 Task를 확인하지 못했어요. 기록을 보존하며 다시 확인해 주세요.',
        }));
    }
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!navigation?.key || Platform.OS !== 'android') return;
    live.current = true;
    void Promise.resolve().then(() => {
      if (live.current) return inspect();
    });
    return () => {
      live.current = false;
      invalidate();
    };
  }, [navigation?.key, inspect, invalidate]);
  const perform = async (action: 'save' | 'remove', id: string) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      const service = await getRecoveryService();
      const result = action === 'save' ? await service.save(id) : await service.remove(id);
      if (!result) return;
      const inspection = await service.inspect();
      if (!live.current) return;
      setState({ checking: false, inspection, error: null });
      if (inspection.kind === 'none') {
        if (action === 'save')
          router.replace({
            pathname: '/run-result/[runId]',
            params: { runId: id, source: 'finish' },
          });
        else router.dismissTo('/');
      }
    } catch {
      if (live.current)
        setState((previous) => ({
          ...previous,
          error:
            action === 'save'
              ? '기록을 종료·저장하지 못했어요. 기존 기록을 보존하며 다시 시도해 주세요.'
              : '기록을 삭제하지 못했어요. 기존 기록을 보존하며 다시 시도해 주세요.',
        }));
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  };
  const remove = (id: string) => {
    if (alertVisible.current || busy.current) return;
    alertVisible.current = true;
    const unlock = () => {
      alertVisible.current = false;
    };
    Alert.alert(
      '미완료 기록을 삭제하시겠습니까?',
      '해당 러닝과 GPS 경로가 삭제되며 복구할 수 없어요.',
      [
        { text: '취소', style: 'cancel', onPress: unlock },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            unlock();
            void perform('remove', id);
          },
        },
      ],
      { cancelable: true, onDismiss: unlock },
    );
  };
  return {
    ...state,
    working,
    visible: state.checking || state.inspection.kind === 'required' || state.error !== null,
    refresh: () => {
      if (!busy.current) {
        setState((previous) => ({ ...previous, checking: true, error: null }));
        void inspect();
      }
    },
    save: (id: string) => void perform('save', id),
    remove,
  };
}
