import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { useRunBootstrap } from '../useRunBootstrap';
import { RunRecoveryDialog } from '../../components/RunRecoveryDialog';
import { getRecoveryService } from '../../services/recoveryRuntime';
import { getRunService } from '../../services/runRuntime';
import type { RunRecord } from '@/database/databaseTypes';
import type { RecoveryInspection } from '../../services/runRecovery';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'bare' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), dismissTo: jest.fn() },
  useRootNavigationState: () => ({ key: 'root' }),
}));
jest.mock('../../services/recoveryRuntime', () => ({ getRecoveryService: jest.fn() }));
jest.mock('../../services/runRuntime', () => ({ getRunService: jest.fn() }));
const row: RunRecord = {
  id: 'recovery',
  status: 'running',
  startedAtMs: 100000,
  endedAtMs: null,
  activeDurationMs: 5000,
  committedDurationMs: 0,
  activeSinceMs: 100000,
  distanceMeters: 0,
  lastCheckpointAtMs: 105000,
  lastSavedAtMs: 105000,
  segmentIndex: null,
  stateRevision: 2,
  completionReason: null,
};
const inspect = jest.fn<Promise<RecoveryInspection>, []>(),
  save = jest.fn(),
  remove = jest.fn(),
  attach = jest.fn();
const originalPlatform = Platform.OS;
function Harness() {
  const recovery = useRunBootstrap();
  return <RunRecoveryDialog recovery={recovery} />;
}
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  jest.resetAllMocks();
  inspect.mockResolvedValue({ kind: 'required', records: [row], ambiguous: false });
  jest.mocked(getRecoveryService).mockResolvedValue({ inspect, save, remove });
  jest
    .mocked(getRunService)
    .mockResolvedValue({ ...jest.mocked(getRunService).mock.results[0]?.value, attach });
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalPlatform, configurable: true });
  jest.restoreAllMocks();
});
it('선택 전 복구 모달이 표시되고 기록을 임의로 저장·삭제하지 않는다', async () => {
  await render(<Harness />);
  expect(await screen.findByText('기록 종료 및 저장')).toBeOnTheScreen();
  expect(screen.getByText(/이전 러닝이 정상적으로 종료되지 않았습니다/)).toBeOnTheScreen();
  expect(save).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
it('저장 성공 후에만 실제 runId 결과 화면으로 이동한다', async () => {
  await render(<Harness />);
  await screen.findByText('기록 종료 및 저장');
  save.mockResolvedValue({ ...row, status: 'completed' });
  inspect.mockResolvedValue({ kind: 'none' });
  await fireEvent.press(screen.getByRole('button', { name: '기록 종료 및 저장' }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/run-result/[runId]',
      params: { runId: 'recovery', source: 'finish' },
    }),
  );
  expect(save).toHaveBeenCalledWith('recovery');
});
it('저장 실패는 선택을 유지하고 재시도를 제공한다', async () => {
  await render(<Harness />);
  await screen.findByText('기록 종료 및 저장');
  save.mockRejectedValueOnce(new Error('disk')).mockResolvedValue({ ...row, status: 'completed' });
  await fireEvent.press(screen.getByRole('button', { name: '기록 종료 및 저장' }));
  expect(await screen.findByText(/기록을 종료·저장하지 못했어요/)).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
  inspect.mockResolvedValue({ kind: 'none' });
  await fireEvent.press(screen.getByRole('button', { name: '기록 종료 및 저장' }));
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/run-result/[runId]',
      params: { runId: 'recovery', source: 'finish' },
    }),
  );
  expect(save).toHaveBeenCalledTimes(2);
});
it('삭제 취소 시 데이터와 복구 선택을 유지한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<Harness />);
  await screen.findByText('기록 삭제');
  await fireEvent.press(screen.getByRole('button', { name: '기록 삭제' }));
  await act(async () =>
    alert.mock.calls[0][2]?.find((button) => button.text === '취소')?.onPress?.(),
  );
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByText('기록 종료 및 저장')).toBeOnTheScreen();
});
it('삭제 확인 성공 후 Home으로 이동한다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<Harness />);
  await screen.findByText('기록 삭제');
  remove.mockResolvedValue(true);
  inspect.mockResolvedValue({ kind: 'none' });
  await fireEvent.press(screen.getByRole('button', { name: '기록 삭제' }));
  await act(async () =>
    alert.mock.calls[0][2]?.find((button) => button.text === '삭제')?.onPress?.(),
  );
  expect(remove).toHaveBeenCalledWith('recovery');
  expect(router.dismissTo).toHaveBeenCalledWith('/');
});
it('삭제 실패 후에는 Home으로 이동하지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<Harness />);
  await screen.findByText('기록 삭제');
  remove.mockRejectedValueOnce(new Error('disk'));
  await fireEvent.press(screen.getByRole('button', { name: '기록 삭제' }));
  await act(async () =>
    alert.mock.calls[0][2]?.find((button) => button.text === '삭제')?.onPress?.(),
  );
  expect(await screen.findByText(/기록을 삭제하지 못했어요/)).toBeOnTheScreen();
  expect(router.dismissTo).not.toHaveBeenCalled();
});
it('복구 처리 중 연속 선택은 한 번만 실행하고 버튼을 비활성화한다', async () => {
  let resolve: (value: RunRecord) => void = () => {};
  save.mockImplementation(
    () =>
      new Promise<RunRecord>((r) => {
        resolve = r;
      }),
  );
  await render(<Harness />);
  await screen.findByText('기록 종료 및 저장');
  const button = screen.getByRole('button', { name: '기록 종료 및 저장' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  inspect.mockResolvedValue({ kind: 'none' });
  await act(async () => resolve({ ...row, status: 'completed' }));
});
it('같은 프로세스의 러닝은 선택 후에만 다시 연결한다', async () => {
  inspect.mockResolvedValue({ kind: 'owned', record: row });
  attach.mockResolvedValue(undefined);
  await render(<Harness />);
  const button = await screen.findByRole('button', { name: '러닝으로 돌아가기' });
  expect(attach).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '기록 삭제 후 Home으로' })).toBeOnTheScreen();
  await fireEvent.press(button);
  await waitFor(() => expect(attach).toHaveBeenCalledWith('recovery'));
  expect(router.replace).toHaveBeenCalledWith('/running');
  expect(screen.queryByText('기록 종료 및 저장')).toBeNull();
});
it('시작 검사 실패는 기록을 건드리지 않고 상태 재조회를 제공한다', async () => {
  inspect.mockRejectedValueOnce(new Error('native'));
  await render(<Harness />);
  expect(
    await screen.findByText(/러닝 상태나 남은 위치 Task를 확인하지 못했어요/),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: '상태 다시 확인' }));
  expect(await screen.findByText('기록 종료 및 저장')).toBeOnTheScreen();
  expect(save).not.toHaveBeenCalled();
});
