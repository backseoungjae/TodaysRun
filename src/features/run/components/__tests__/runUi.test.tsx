import * as Reanimated from 'react-native-reanimated';
import { act, render, screen, userEvent, fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { RunMap, pathSegments, type PathPoint } from '../RunMap';
import { RunSheet } from '../RunSheet';
import { RunMetrics } from '../RunMetrics';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  useAnimatedReaction: jest.fn(),
}));
jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    ...jest.requireActual('@gorhom/bottom-sheet/mock'),
    default: ({ children, onChange }: { children: ReactNode; onChange(index: number): void }) => (
      <View testID="run-sheet" {...{ onChange }}>
        {children}
      </View>
    ),
  };
});
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
const point = (timestampMs: number, segmentId = 0): PathPoint => ({
  latitude: 0,
  longitude: 0,
  timestampMs,
  segmentId,
});
it('네이티브 지도가 준비되기 전에는 패딩을 변경하지 않는다', async () => {
  const view = await render(<RunMap current={null} path={[]} containerHeight={700} />);
  expect(screen.getByLabelText('러닝 지도').props.mapPadding).toBeUndefined();
  await view.rerender(<RunMap current={null} path={[]} containerHeight={800} />);
  expect(screen.getByLabelText('러닝 지도').props.mapPadding).toBeUndefined();
  await fireEvent(screen.getByLabelText('러닝 지도'), 'mapReady');
  expect(screen.getByLabelText('러닝 지도').props.mapPadding.bottom).toBe(560);
});
it.each([
  { path: [], count: 0 },
  { path: [point(1)], count: 0 },
  { path: [point(1), point(2), point(3, 1), point(4, 1)], count: 2 },
])('좌표 개수와 구간에 관계없이 지도 렌더링이 안전하다: %j', async ({ path, count }) => {
  await render(<RunMap current={path[0] ?? null} path={path} />);
  expect(screen.getByLabelText('러닝 지도')).toBeOnTheScreen();
  expect(pathSegments(path).length).toBe(count);
});
it('PAUSED 시트는 시간·거리·페이스와 재개·종료를 제공한다', async () => {
  const resume = jest.fn();
  const finish = jest.fn();
  await render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 24, left: 0, right: 0 }}>
      <RunSheet
        status="PAUSED"
        disabled={false}
        onPause={jest.fn()}
        onResume={resume}
        onFinish={finish}
      >
        <RunMetrics durationMs={65_000} distanceMeters={1_000} pace={65} />
      </RunSheet>
    </SafeAreaInsetsContext.Provider>,
  );
  expect(screen.getByText('1.00')).toBeOnTheScreen();
  expect(screen.getAllByText('1:05')).toHaveLength(2);
  const sheet = screen.getByTestId('run-sheet');
  await fireEvent(sheet, 'change', 0);
  await fireEvent(sheet, 'change', 1);
  expect(screen.getAllByText('1:05')).toHaveLength(2);
  expect(resume).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
  await userEvent.setup().press(screen.getByRole('button', { name: '재개' }));
  await userEvent.setup().press(screen.getByRole('button', { name: '종료' }));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledTimes(1);
});

it('끝점 드래그가 change 콜백 없이 끝나도 지표·지도 레이아웃을 동기화한다', async () => {
  const reaction = jest.mocked(Reanimated.useAnimatedReaction);
  const snap = jest.fn(),
    pause = jest.fn();
  await render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: 24, left: 0, right: 0 }}>
      <RunSheet
        status="RUNNING"
        disabled={false}
        onPause={pause}
        onResume={jest.fn()}
        onFinish={jest.fn()}
        onSnap={snap}
      >
        <RunMetrics durationMs={65000} distanceMeters={1000} pace={65} />
      </RunSheet>
    </SafeAreaInsetsContext.Provider>,
  );
  expect(screen.getByText('러닝 중')).toBeOnTheScreen();
  const notify = reaction.mock.calls.at(-1)?.[1];
  if (!notify) throw new Error('missing sheet position observer');
  await act(async () => notify(0.4, 1));
  expect(screen.getByText('러닝 중')).toBeOnTheScreen();
  expect(snap).not.toHaveBeenCalled();
  await act(async () => notify(0, 0.4));
  expect(screen.queryByText('러닝 중')).toBeNull();
  expect(snap).toHaveBeenCalledWith(0);
  expect(screen.getByText('1.00')).toBeOnTheScreen();
  expect(screen.getAllByText('1:05')).toHaveLength(2);
  expect(pause).not.toHaveBeenCalled();
  await act(async () => notify(1, 0));
  expect(screen.getByText('러닝 중')).toBeOnTheScreen();
  expect(snap).toHaveBeenLastCalledWith(1);
});

afterEach(() => jest.restoreAllMocks());
