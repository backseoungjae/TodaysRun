import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, Text } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaFrameContext } from 'react-native-safe-area-context';
import RunningScreen from '../RunningScreen';
import RunResultScreen from '../RunResultScreen';
import { runStore } from '../../store/runStore';
import { getRunService } from '../../services/runRuntime';
import { getCompletedRun, getRunPath } from '../../services/runResultService';
import type { RunRecord } from '@/database/databaseTypes';

jest.mock('@gorhom/bottom-sheet', () => ({
  __esModule: true,
  ...jest.requireActual('@gorhom/bottom-sheet/mock'),
}));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: View,
    Marker: View,
    Polyline: View,
    PROVIDER_GOOGLE: 'google',
  };
});
jest.mock('../../services/runRuntime', () => ({
  getRunService: jest.fn(),
  acknowledgeRunningScreen: jest.fn(),
}));
jest.mock('../../services/runResultService');
const finish = jest.fn();
const pause = jest.fn();
const resume = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getRunPath).mockResolvedValue([]);
  runStore.setState({
    id: 'run-1',
    status: 'PAUSED',
    durationMs: 5_000,
    distanceMeters: 10,
    pace: 500,
    current: null,
    path: [],
    busy: false,
    error: null,
  });
  jest.mocked(getRunService).mockResolvedValue({
    attach: jest.fn(),
    hasActiveRun: () => false,
    manageRecords: async <T,>(operation: () => Promise<T>) => operation(),
    start: jest.fn(),
    pause,
    resume,
    finish,
    checkpoint: jest.fn(),
    setForeground: jest.fn(),
    dispose: jest.fn(),
    drain: jest.fn(),
  });
});
afterEach(() => {
  runStore.setState({
    id: null,
    status: null,
    durationMs: 0,
    distanceMeters: 0,
    pace: null,
    current: null,
    path: [],
    busy: false,
    error: null,
  });
  jest.restoreAllMocks();
});
function RunningHarness() {
  return (
    <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width: 390, height: 800 }}>
      <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 24, left: 0, right: 0 }}>
        <RunningScreen />
      </SafeAreaInsetsContext.Provider>
    </SafeAreaFrameContext.Provider>
  );
}
it('Finish Alert 취소는 PAUSED를 유지하며 종료 저장을 호출하지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await renderRouter({ index: RunningHarness });
  await userEvent.setup().press(screen.getByRole('button', { name: '종료' }));
  expect(alert).toHaveBeenCalledWith(
    '러닝을 종료하시겠습니까?',
    expect.any(String),
    expect.any(Array),
    expect.any(Object),
  );
  await act(async () => {
    alert.mock.calls[0][2]?.find((button) => button.text === '취소')?.onPress?.();
  });
  expect(finish).not.toHaveBeenCalled();
  expect(runStore.getState().status).toBe('PAUSED');
});
it('Finish 확인 후 저장 성공이 반환되어야 결과로 이동한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  finish.mockResolvedValue('run-1');
  const result = renderRouter({
    index: RunningHarness,
    'run-result/[runId]': () => <Text>결과 조회</Text>,
  });
  await result;
  await userEvent.setup().press(screen.getByRole('button', { name: '종료' }));
  await act(async () => {
    alert.mock.calls[0][2]?.find((button) => button.text === '종료')?.onPress?.();
  });
  expect(await screen.findByText('결과 조회')).toBeOnTheScreen();
  expect(result.getPathname()).toBe('/run-result/run-1');
});
it('종료 저장 실패 시 결과로 이동하지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  finish.mockRejectedValue(new Error('disk-full'));
  const result = renderRouter({
    index: RunningHarness,
    'run-result/[runId]': () => <Text>결과 조회</Text>,
  });
  await result;
  await userEvent.setup().press(screen.getByRole('button', { name: '종료' }));
  await act(async () => {
    alert.mock.calls[0][2]?.find((button) => button.text === '종료')?.onPress?.();
  });
  expect(result.getPathname()).toBe('/');
  expect(screen.queryByText('결과 조회')).toBeNull();
});
it('결과 화면은 SQLite 조회 데이터만 표시한다', async () => {
  const record: RunRecord = {
    id: 'run-1',
    status: 'completed',
    startedAtMs: 100_000,
    endedAtMs: 160_000,
    activeDurationMs: 60_000,
    committedDurationMs: 60_000,
    activeSinceMs: null,
    distanceMeters: 1_000,
    lastCheckpointAtMs: 160_000,
    lastSavedAtMs: 160_000,
    segmentIndex: 0,
    stateRevision: 4,
    completionReason: 'normal',
  };
  jest.mocked(getCompletedRun).mockResolvedValue(record);
  await renderRouter(
    { 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/run-result/run-1' },
  );
  expect(await screen.findByText('저장 완료')).toBeOnTheScreen();
  expect(screen.getByText('1.00')).toBeOnTheScreen();
  expect(getCompletedRun).toHaveBeenCalledWith('run-1');
});
it('완료 기록 조회 실패 시 임의의 완료 데이터를 표시하지 않는다', async () => {
  jest.mocked(getCompletedRun).mockRejectedValue(new Error('missing'));
  await renderRouter(
    { 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/run-result/run-1' },
  );
  expect(await screen.findByText(/완료된 기록을 읽지 못했어요/)).toBeOnTheScreen();
  expect(screen.queryByText('저장 완료')).toBeNull();
});
