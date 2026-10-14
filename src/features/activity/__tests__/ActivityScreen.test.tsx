import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, Text } from 'react-native';
import { router } from 'expo-router';
import ActivityScreen from '../ActivityScreen';
import { runHistoryService } from '@/features/run/services/runHistoryService';
import type { RunRecord } from '@/database/databaseTypes';

jest.mock('@/features/run/services/runHistoryService', () => ({
  runHistoryService: { list: jest.fn(), remove: jest.fn() },
}));
const record = (id = 'zero', startedAtMs = 100_000): RunRecord => ({
  id,
  status: 'completed',
  startedAtMs,
  endedAtMs: startedAtMs + 1000,
  activeDurationMs: 1000,
  committedDurationMs: 1000,
  activeSinceMs: null,
  distanceMeters: 0,
  lastCheckpointAtMs: startedAtMs + 1000,
  lastSavedAtMs: startedAtMs + 1000,
  segmentIndex: null,
  stateRevision: 4,
  completionReason: 'normal',
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(runHistoryService.list).mockResolvedValue([]);
  jest.mocked(runHistoryService.remove).mockResolvedValue(undefined);
});
const alertButton = async (alert: jest.SpyInstance, text: string) => {
  await act(async () => {
    alert.mock.calls
      .at(-1)?.[2]
      ?.find((button: { text: string }) => button.text === text)
      ?.onPress?.();
  });
};
it('빈 목록은 Empty State를 표시한다', async () => {
  await renderRouter({ index: ActivityScreen });
  expect(await screen.findByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();
});
it('조회 대기와 실패·재시도를 표시한다', async () => {
  jest.mocked(runHistoryService.list).mockImplementationOnce(() => new Promise(() => {}));
  await renderRouter({ index: ActivityScreen });
  expect(screen.getByLabelText('기록 불러오는 중')).toBeOnTheScreen();
  await screen.unmount();
  jest.mocked(runHistoryService.list).mockRejectedValueOnce(new Error('disk'));
  await renderRouter({ index: ActivityScreen });
  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(await screen.findByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();
});
it('0km 완료 기록을 표시하고 카드 선택은 Activity 상세로 이동한다', async () => {
  jest.mocked(runHistoryService.list).mockResolvedValue([record()]);
  const result = renderRouter({
    index: ActivityScreen,
    'run-result/[runId]': () => <Text>상세</Text>,
  });
  await result;
  expect(await screen.findByText('0.00')).toBeOnTheScreen();
  expect(screen.getByText(`--'--"`)).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: /러닝 기록 보기/ }));
  expect(result.getPathname()).toBe('/run-result/zero');
  expect(result.getSearchParams()).toMatchObject({ source: 'activity' });
});
it('화면 재진입 때 최신 목록을 재조회한다', async () => {
  jest.mocked(runHistoryService.list).mockResolvedValueOnce([record()]).mockResolvedValueOnce([]);
  await renderRouter({ index: ActivityScreen, settings: () => <Text>다른 화면</Text> });
  await screen.findByText('0.00');
  await act(async () => router.push('/settings'));
  await act(async () => router.back());
  expect(await screen.findByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();
  expect(runHistoryService.list).toHaveBeenCalledTimes(2);
});
it('삭제 취소는 DB 삭제와 상세 이동을 하지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  jest.mocked(runHistoryService.list).mockResolvedValue([record()]);
  const result = renderRouter({ index: ActivityScreen });
  await result;
  await screen.findByText('0.00');
  await userEvent.setup().press(screen.getByRole('button', { name: /러닝 기록 삭제/ }));
  await alertButton(alert, '취소');
  expect(runHistoryService.remove).not.toHaveBeenCalled();
  expect(result.getPathname()).toBe('/');
});
it('삭제 성공 뒤 목록을 다시 조회한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  jest.mocked(runHistoryService.list).mockResolvedValueOnce([record()]).mockResolvedValue([]);
  await renderRouter({ index: ActivityScreen });
  await screen.findByText('0.00');
  await userEvent.setup().press(screen.getByRole('button', { name: /러닝 기록 삭제/ }));
  await alertButton(alert, '삭제');
  expect(await screen.findByText('아직 러닝 기록이 없어요')).toBeOnTheScreen();
  expect(runHistoryService.remove).toHaveBeenCalledWith('zero');
});
it('삭제 실패는 기존 카드를 유지하고 오류를 표시한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  jest.mocked(runHistoryService.list).mockResolvedValue([record()]);
  jest.mocked(runHistoryService.remove).mockRejectedValue(new Error('disk'));
  await renderRouter({ index: ActivityScreen });
  await screen.findByText('0.00');
  await userEvent.setup().press(screen.getByRole('button', { name: /러닝 기록 삭제/ }));
  await alertButton(alert, '삭제');
  expect(await screen.findByText(/기록을 삭제하지 못했어요/)).toBeOnTheScreen();
  expect(screen.getByText('0.00')).toBeOnTheScreen();
});
it('삭제 대기 중 연속 입력과 중복 확인 콜백을 차단한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  jest.mocked(runHistoryService.list).mockResolvedValue([record()]);
  let resolve!: () => void;
  jest.mocked(runHistoryService.remove).mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await renderRouter({ index: ActivityScreen });
  await screen.findByText('0.00');
  const button = screen.getByRole('button', { name: /러닝 기록 삭제/ });
  await userEvent.setup().press(button);
  await userEvent.setup().press(button);
  expect(alert).toHaveBeenCalledTimes(1);
  await alertButton(alert, '삭제');
  await alertButton(alert, '삭제');
  await waitFor(() => expect(runHistoryService.remove).toHaveBeenCalledTimes(1));
  expect(button).toBeDisabled();
  await act(async () => resolve());
});
