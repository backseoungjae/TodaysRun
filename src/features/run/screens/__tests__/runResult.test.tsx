import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import { Text } from 'react-native';
import RunResultScreen from '../RunResultScreen';
import { getCompletedRun, getRunPath } from '../../services/runResultService';
import type { RunRecord } from '@/database/databaseTypes';

jest.mock('../../services/runResultService');
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
const record: RunRecord = {
  id: 'zero',
  status: 'completed',
  startedAtMs: 1000,
  endedAtMs: 1002,
  activeDurationMs: 2,
  committedDurationMs: 2,
  activeSinceMs: null,
  distanceMeters: 0,
  lastCheckpointAtMs: 1002,
  lastSavedAtMs: 1002,
  segmentIndex: null,
  stateRevision: 4,
  completionReason: 'normal',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCompletedRun).mockResolvedValue(record);
  jest.mocked(getRunPath).mockResolvedValue([]);
});
it('0km·짧은 기록과 좌표 없는 지도를 안전하게 읽기 전용으로 표시한다', async () => {
  await renderRouter(
    { 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/run-result/zero?source=finish' },
  );
  expect(await screen.findByText('저장 완료')).toBeOnTheScreen();
  expect(screen.getByText('0.00')).toBeOnTheScreen();
  expect(screen.getByText(`--'--"`)).toBeOnTheScreen();
  expect(screen.getByText('저장된 GPS 경로가 없어요.')).toBeOnTheScreen();
  expect(screen.getByLabelText('러닝 지도')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '재개' })).toBeNull();
  expect(screen.queryByRole('button', { name: '종료' })).toBeNull();
  expect(screen.queryByRole('button', { name: /삭제/ })).toBeNull();
});
it('좌표 하나의 상세도 안전하게 조회한다', async () => {
  jest
    .mocked(getRunPath)
    .mockResolvedValue([{ latitude: 0, longitude: 0, timestampMs: 1001, segmentId: 0 }]);
  await renderRouter(
    { 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/run-result/zero?source=activity' },
  );
  expect(await screen.findByText('0.00')).toBeOnTheScreen();
  expect(screen.queryByText('저장 완료')).toBeNull();
  expect(screen.queryByText('저장된 GPS 경로가 없어요.')).toBeNull();
});
it('유효하지 않은 runId는 가짜 기록을 표시하지 않고 재시도를 제공한다', async () => {
  jest.mocked(getCompletedRun).mockRejectedValueOnce(new Error('not-found'));
  await renderRouter(
    { 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/run-result/missing' },
  );
  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  expect(screen.queryByText('저장 완료')).toBeNull();
  await userEvent.setup().press(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(await screen.findByText('0.00')).toBeOnTheScreen();
});
it('완료 직후 뒤로가기는 Home으로 돌아가며 종료된 Running을 남기지 않는다', async () => {
  const result = renderRouter({
    index: () => <Text>Home 화면</Text>,
    running: () => <Text>Running 화면</Text>,
    'run-result/[runId]': RunResultScreen,
  });
  await result;
  await act(async () => router.push('/running'));
  await act(async () =>
    router.replace({
      pathname: '/run-result/[runId]',
      params: { runId: 'zero', source: 'finish' },
    }),
  );
  await screen.findByText('저장 완료');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Home으로' }));
  expect(result.getPathname()).toBe('/');
  expect(screen.queryByText('Running 화면')).toBeNull();
});
it('Activity 상세 뒤로가기는 Activity이며 저장 완료 알림을 표시하지 않는다', async () => {
  const result = renderRouter(
    { activity: () => <Text>Activity 화면</Text>, 'run-result/[runId]': RunResultScreen },
    { initialUrl: '/activity' },
  );
  await result;
  await act(async () =>
    router.push({ pathname: '/run-result/[runId]', params: { runId: 'zero', source: 'activity' } }),
  );
  await screen.findByText('0.00');
  expect(screen.queryByText('저장 완료')).toBeNull();
  await userEvent.setup().press(screen.getByRole('button', { name: 'Activity로' }));
  expect(result.getPathname()).toBe('/activity');
});
