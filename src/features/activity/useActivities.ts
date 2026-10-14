import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { RunRecord } from '@/database/databaseTypes';
import { runHistoryService } from '@/features/run/services/runHistoryService';

export function useActivities() {
  const [records, setRecords] = useState<RunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const focused = useRef(false);
  const generation = useRef(0);
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (focused.current) {
      setRecords(null);
      setError(null);
    }
    try {
      const values = await runHistoryService.list();
      if (focused.current && request === generation.current) setRecords(values);
    } catch {
      if (focused.current && request === generation.current)
        setError('기록을 불러오지 못했어요. 다시 시도해 주세요.');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      return () => {
        focused.current = false;
        generation.current++;
      };
    }, [refresh]),
  );
  const remove = (record: RunRecord) => {
    if (locked.current) return;
    locked.current = true;
    let confirmed = false;
    const unlock = () => {
      locked.current = false;
    };
    Alert.alert(
      '이 기록을 삭제하시겠습니까?',
      '러닝 기록과 GPS 경로가 삭제되며 복구할 수 없어요.',
      [
        { text: '취소', style: 'cancel', onPress: unlock },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            if (confirmed) return;
            confirmed = true;
            setDeleting(record.id);
            void runHistoryService
              .remove(record.id)
              .then(async () => {
                await refresh();
              })
              .catch(() => {
                if (focused.current) setError('기록을 삭제하지 못했어요. 다시 시도해 주세요.');
              })
              .finally(() => {
                unlock();
                if (focused.current) setDeleting(null);
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
  return { records, error, deleting, refresh, remove };
}
