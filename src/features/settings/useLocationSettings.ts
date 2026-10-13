import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { locationAdapter } from '@/features/run/services/locationAdapter';
import type { LocationPermission } from '@/features/run/services/preparationTypes';
import { settingsService } from './settingsService';

type SettingsSnapshot = {
  foreground: LocationPermission;
  background: LocationPermission;
  backgroundTrackingEnabled: boolean;
};

export function useLocationSettings() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  const generation = useRef(0);
  const writing = useRef(false);
  const settingsAbort = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (focused.current) setSnapshot(null);
    try {
      const [foreground, background, settings] = await Promise.all([
        locationAdapter.getPermission('foreground'),
        locationAdapter.getPermission('background'),
        settingsService.get(),
      ]);
      if (focused.current && request === generation.current) {
        setSnapshot({ foreground, background, ...settings });
        setError(null);
      }
    } catch {
      if (focused.current && request === generation.current)
        setError('권한이나 앱 설정을 읽지 못했어요. 다시 확인해 주세요.');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setSaving(writing.current);
      void refresh();
      const listener = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        focused.current = false;
        generation.current++;
        settingsAbort.current?.abort();
        listener.remove();
      };
    }, [refresh]),
  );

  const setBackground = async (enabled: boolean) => {
    if (writing.current) return;
    writing.current = true;
    setSaving(true);
    try {
      await settingsService.setBackgroundTrackingEnabled(enabled);
      await refresh();
    } catch {
      if (focused.current) setError('설정을 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      writing.current = false;
      if (focused.current) setSaving(false);
    }
  };
  const openSettings = async () => {
    if (settingsAbort.current) return;
    const controller = new AbortController();
    settingsAbort.current = controller;
    try {
      await locationAdapter.openSettings(controller.signal);
      if (!controller.signal.aborted) await refresh();
    } catch {
      if (focused.current && !controller.signal.aborted) setError('기기 설정을 열지 못했어요.');
    } finally {
      if (settingsAbort.current === controller) settingsAbort.current = null;
    }
  };
  return { snapshot, error, saving, refresh, setBackground, openSettings };
}
