import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getRunService } from '../services/runRuntime';
import { getRecoveryService } from '../services/recoveryRuntime';
import type { RecoveryInspection } from '../services/runRecovery';

type BootstrapState = { checking: boolean; inspection: RecoveryInspection; error: string | null };
export function useRunBootstrap() {
  const navigation = useRootNavigationState();
  const shouldInspect =
    Platform.OS === 'android' &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
  const [state, setState] = useState<BootstrapState>({
    checking: shouldInspect,
    inspection: { kind: 'none' },
    error: null,
  });
  const [working, setWorking] = useState(false);
  const live = useRef(false),
    generation = useRef(0),
    busy = useRef(false),
    alertVisible = useRef(false);
  const inspect = useCallback(async () => {
    if (!shouldInspect) return;
    const request = ++generation.current;
    try {
      const service = await getRecoveryService();
      const inspection = await service.inspect();
      if (!live.current || request !== generation.current) return;
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
  }, [shouldInspect]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    if (!shouldInspect) return;
    if (!navigation?.key) return;
    live.current = true;
    void Promise.resolve().then(() => {
      if (live.current) return inspect();
    });
    return () => {
      live.current = false;
      invalidate();
    };
  }, [navigation?.key, inspect, invalidate, shouldInspect]);
  const perform = async (action: 'save' | 'remove', id: string) => {
    if (!shouldInspect || busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      const service = await getRecoveryService();
      let result: unknown;
      if (action === 'remove' && state.inspection.kind === 'owned') {
        const inspection = await service.inspect();
        if (inspection.kind !== 'owned' || inspection.record.id !== id) {
          if (live.current) setState({ checking: false, inspection, error: null });
          return;
        }
        const running = await getRunService();
        await running.attach(id);
        await running.discard(id);
        result = true;
      } else {
        result = action === 'save' ? await service.save(id) : await service.remove(id);
      }
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
  const continueRun = async (id: string) => {
    if (!shouldInspect || busy.current || state.inspection.kind !== 'owned') return;
    busy.current = true;
    setWorking(true);
    try {
      const inspection = await (await getRecoveryService()).inspect();
      if (!live.current) return;
      if (inspection.kind !== 'owned' || inspection.record.id !== id) {
        setState({ checking: false, inspection, error: null });
        return;
      }
      await (await getRunService()).attach(id);
      if (!live.current) return;
      router.replace('/running');
      setState({ checking: false, inspection: { kind: 'none' }, error: null });
    } catch {
      if (live.current)
        setState((previous) => ({
          ...previous,
          error: '진행 중인 러닝을 열지 못했어요. 상태를 다시 확인해 주세요.',
        }));
    } finally {
      busy.current = false;
      if (live.current) setWorking(false);
    }
  };
  const remove = (id: string) => {
    if (!shouldInspect || alertVisible.current || busy.current) return;
    alertVisible.current = true;
    const unlock = () => {
      alertVisible.current = false;
    };
    Alert.alert(
      state.inspection.kind === 'owned'
        ? '진행 중인 러닝을 삭제하시겠습니까?'
        : '미완료 기록을 삭제하시겠습니까?',
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
    visible:
      shouldInspect && (state.checking || state.inspection.kind !== 'none' || state.error !== null),
    refresh: () => {
      if (shouldInspect && !busy.current) {
        setState((previous) => ({ ...previous, checking: true, error: null }));
        void inspect();
      }
    },
    save: (id: string) => void perform('save', id),
    continueRun: (id: string) => void continueRun(id),
    remove,
  };
}
