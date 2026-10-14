import { useCallback, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useStore } from 'zustand';
import { runStore } from '@/features/run/store/runStore';
import { runHistoryService } from '@/features/run/services/runHistoryService';

export function useRecordDeletion() {
  const active = useStore(
    runStore,
    (state) => state.busy || state.status === 'RUNNING' || state.status === 'PAUSED',
  );
  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async (clearError = true) => {
    const request = ++generation.current;
    if (focused.current) setChecking(true);
    try {
      const reason = await runHistoryService.deletionBlock();
      if (focused.current && request === generation.current) {
        setBlocked(reason);
        if (clearError) setError(null);
      }
    } catch {
      if (focused.current && request === generation.current) {
        setBlocked('기록 상태를 확인한 후 삭제할 수 있어요.');
        setError('기록 상태를 확인하지 못했어요. 다시 확인해 주세요.');
      }
    } finally {
      if (focused.current && request === generation.current) setChecking(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        focused.current = false;
        generation.current++;
        listener.remove();
      };
    }, [refresh]),
  );
  const removeAll = () => {
    if (locked.current || active || checking || blocked) return;
    locked.current = true;
    let confirmed = false;
    const unlock = () => {
      locked.current = false;
    };
    Alert.alert(
      '전체 기록을 삭제하시겠습니까?',
      '모든 러닝 기록과 GPS 경로를 삭제하며 복구할 수 없어요. 앱 설정은 유지돼요.',
      [
        { text: '취소', style: 'cancel', onPress: unlock },
        {
          text: '전체 삭제',
          style: 'destructive',
          onPress: () => {
            if (confirmed) return;
            confirmed = true;
            setDeleting(true);
            setMessage(null);
            setError(null);
            void runHistoryService
              .removeAll()
              .then(() => {
                if (focused.current)
                  setMessage('모든 러닝 기록과 경로를 삭제했어요. 앱 설정은 유지돼요.');
              })
              .catch((error) => {
                if (focused.current)
                  setError(
                    error instanceof Error && /러닝|미완료/.test(error.message)
                      ? error.message
                      : '전체 기록을 삭제하지 못했어요. 다시 시도해 주세요.',
                  );
              })
              .finally(() => {
                unlock();
                if (focused.current) setDeleting(false);
                void refresh(false);
              });
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (!confirmed) unlock();
        },
      },
    );
  };
  return {
    disabled: active || checking || blocked !== null || deleting,
    checking,
    blocked,
    deleting,
    message,
    error,
    refresh,
    removeAll,
  };
}
