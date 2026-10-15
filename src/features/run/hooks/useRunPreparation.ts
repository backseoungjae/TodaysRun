import { useCallback, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { settingsService } from '@/features/settings/settingsService';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';
import { confirmLocationPermission, locationAdapter } from '../services/locationAdapter';
import { createRunPreparation } from '../services/runPreparation';
import type { PreparationState } from '../services/preparationTypes';
import { prepareRunNotifications } from '../services/runNotifications';
import { startPreparedRun } from '../services/runRuntime';

export function useRunPreparation() {
  const [state, setState] = useState<PreparationState>({ status: 'idle' });
  const preparation = useMemo(
    () =>
      createRunPreparation(
        {
          location: locationAdapter,
          // Android는 사용자가 시작한 위치 알림 서비스로 앱 전환 중에도 기록한다.
          requiresBackgroundPermission: Platform.OS !== 'android',
          backgroundEnabled: async () => (await settingsService.get()).backgroundTrackingEnabled,
          enableBackground: () => settingsService.setBackgroundTrackingEnabled(true),
          confirm: confirmLocationPermission,
          now: Date.now,
          isAppActive: () => AppState.currentState === 'active',
          onPrepared: startPreparedRun,
          prepareNotifications: prepareRunNotifications,
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
  const start = async () => {
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setState({ status: 'failed', reason: 'expo-go-unsupported' });
      return;
    }
    await preparation.start();
  };
  return { state, start, cancel: preparation.cancel };
}
