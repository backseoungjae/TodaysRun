import { useCallback, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { settingsService } from '@/features/settings/settingsService';
import { PROPOSED_GPS_POLICY } from '../domain/gpsPolicy';
import { confirmLocationPermission, locationAdapter } from '../services/locationAdapter';
import { createRunPreparation } from '../services/runPreparation';
import type { PreparationState } from '../services/preparationTypes';
import { startPreparedRun } from '../services/runRuntime';

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
          onPrepared: startPreparedRun,
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
