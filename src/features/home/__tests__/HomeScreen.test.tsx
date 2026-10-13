import { render, screen, userEvent } from '@testing-library/react-native';
import HomeScreen from '../HomeScreen';
import { useRunPreparation } from '@/features/run/hooks/useRunPreparation';

jest.mock('@/features/run/hooks/useRunPreparation');
const mockPreparation = jest.mocked(useRunPreparation);
const start = jest.fn().mockResolvedValue(undefined);
const cancel = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockPreparation.mockReturnValue({ state: { status: 'idle' }, start, cancel });
});

it('START를 표시하고 위치 준비만 요청하며 아직 러닝이 저장되지 않음을 안내한다', async () => {
  await render(<HomeScreen />);
  const start = screen.getByRole('button', { name: 'START' });
  expect(start).toBeEnabled();
  await userEvent.setup().press(start);
  expect(mockPreparation().start).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/아직 운동을 시작하거나 저장하지 않아요/)).toBeOnTheScreen();
});

it('위치 준비 중 START 대신 로딩과 취소를 표시한다', async () => {
  mockPreparation.mockReturnValue({ state: { status: 'waitingForLocation' }, start, cancel });
  await render(<HomeScreen />);
  expect(screen.queryByRole('button', { name: 'START' })).toBeNull();
  expect(screen.getByLabelText('위치 준비 중')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: '준비 취소' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('타임아웃 안내에서 재시도와 취소를 제공한다', async () => {
  mockPreparation.mockReturnValue({
    state: { status: 'failed', reason: 'location-timeout' },
    start,
    cancel,
  });
  await render(<HomeScreen />);
  expect(screen.getByText(/15초 동안/)).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: '재시도' }));
  expect(start).toHaveBeenCalledTimes(1);
  await userEvent.setup().press(screen.getByRole('button', { name: '취소' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('Home 위 카운트다운에서 취소할 수 있다', async () => {
  mockPreparation.mockReturnValue({ state: { status: 'countdown', seconds: 3 }, start, cancel });
  await render(<HomeScreen />);
  expect(screen.getByText('3')).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole('button', { name: '카운트다운 취소' }));
  expect(cancel).toHaveBeenCalledTimes(1);
});
