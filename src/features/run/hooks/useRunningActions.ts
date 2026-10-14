import { useCallback, useEffect, useRef } from 'react';
import { Alert, BackHandler } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useStore } from 'zustand';
import { runStore } from '../store/runStore';
import { acknowledgeRunningScreen, getRunService } from '../services/runRuntime';

export function useRunningActions() {
  const status = useStore(runStore, (state) => state.status);
  const busy = useStore(runStore, (state) => state.busy);
  const error = useStore(runStore, (state) => state.error);
  const id = useStore(runStore, (state) => state.id);
  const alertVisible = useRef(false);
  useEffect(() => {
    acknowledgeRunningScreen();
  }, []);
  useFocusEffect(
    useCallback(() => {
      const listener = BackHandler.addEventListener('hardwareBackPress', () => {
        if (runStore.getState().status !== 'RUNNING' && runStore.getState().status !== 'PAUSED')
          return false;
        Alert.alert('러닝 기록 중', '러닝을 종료하려면 일시정지 후 종료를 선택해 주세요.');
        return true;
      });
      return () => listener.remove();
    }, []),
  );
  const perform = async (action: 'pause' | 'resume') => {
    try {
      await (await getRunService())[action]();
    } catch {
      /* 오류는 Service의 표시 상태로 전달한다. */
    }
  };
  const showResult = (runId: string) => {
    try {
      router.replace({ pathname: '/run-result/[runId]', params: { runId, source: 'finish' } });
    } catch {
      runStore.setState({ error: '결과 화면을 열지 못했어요. 저장된 결과를 다시 열어 주세요.' });
    }
  };
  const finish = () => {
    if (alertVisible.current || busy || status !== 'PAUSED') return;
    alertVisible.current = true;
    Alert.alert(
      '러닝을 종료하시겠습니까?',
      '기록을 저장한 후 결과를 보여드려요.',
      [
        {
          text: '취소',
          style: 'cancel',
          onPress: () => {
            alertVisible.current = false;
          },
        },
        {
          text: '종료',
          onPress: () => {
            alertVisible.current = false;
            void getRunService()
              .then((service) => service.finish())
              .then((runId) => {
                if (runId) showResult(runId);
              })
              .catch(() => {});
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          alertVisible.current = false;
        },
      },
    );
  };
  return {
    status,
    busy,
    error,
    id,
    pause: () => void perform('pause'),
    resume: () => void perform('resume'),
    finish,
    showResult,
  };
}
