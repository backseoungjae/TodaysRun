import { useCallback, useMemo, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { settingsService } from '@/features/settings/settingsService';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';
import { confirmLocationPermission, locationAdapter } from '../services/locationAdapter';
import { createRunPreparation } from '../services/runPreparation';
import type { PreparationState } from '../services/preparationTypes';

function announcePrepared() {
  Alert.alert(
    '위치 준비 완료',
    '위치와 카운트다운을 확인했어요. 아직 러닝을 시작하거나 저장하지 않았어요.',
  );
}

export function useRunPreparation() {
  const [state, setState] = useState<PreparationState>({ status: 'idle' });
  const preparation = useMemo(
    () =>
      createRunPreparation(
        {
          location: locationAdapter,
          backgroundEnabled: async () => (await settingsService.get()).backgroundTrackingEnabled,
          confirm: confirmLocationPermission,
          now: Date.now,
          isAppActive: () => AppState.currentState === 'active',
          onPrepared: announcePrepared,
        },
        PROPOSED_GPS_POLICY,
        setState,
      ),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const listener = AppState.addEventListener('change', (next) => {
        const current = preparation.getState().status;
        if (next !== 'active' && (current === 'waitingForLocation' || current === 'countdown'))
          preparation.cancel();
      });
      return () => {
        listener.remove();
        preparation.cancel();
      };
    }, [preparation]),
  );
  return { state, start: preparation.start, cancel: preparation.cancel };
}
