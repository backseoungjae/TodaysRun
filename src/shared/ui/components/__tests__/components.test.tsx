import { render, screen, userEvent } from '@testing-library/react-native';
import { View } from 'react-native';
import { AppButton } from '../AppButton';
import { AppText } from '../AppText';
import { IconButton } from '../IconButton';

describe('공통 UI', () => {
  it('텍스트를 렌더링하고 접근성 제목을 전달한다', async () => {
    await render(
      <AppText variant="heading" accessibilityRole="header">
        오늘의 러닝
      </AppText>,
    );
    expect(screen.getByRole('header', { name: '오늘의 러닝' })).toBeOnTheScreen();
  });

  it('버튼을 누르면 전달된 동작을 실행한다', async () => {
    const onPress = jest.fn();
    await render(<AppButton label="확인" onPress={onPress} />);
    await userEvent.setup().press(screen.getByRole('button', { name: '확인' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('비활성화된 버튼은 동작을 실행하지 않는다', async () => {
    const onPress = jest.fn();
    await render(<AppButton label="전체 기록 삭제" disabled onPress={onPress} />);
    const button = screen.getByRole('button', { name: '전체 기록 삭제' });
    expect(button).toBeDisabled();
    await userEvent.setup().press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('아이콘 버튼의 접근성 이름으로 조작할 수 있다', async () => {
    const onPress = jest.fn();
    await render(
      <IconButton accessibilityLabel="메뉴 열기" onPress={onPress}>
        <View />
      </IconButton>,
    );
    await userEvent.setup().press(screen.getByRole('button', { name: '메뉴 열기' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
