import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { useUiTheme } from '@/shared/ui/useUiTheme';

export function RunSheet({
  children,
  status,
  disabled,
  onPause,
  onResume,
  onFinish,
  onSnap,
  containerHeight,
}: {
  children: React.ReactNode;
  status: 'RUNNING' | 'PAUSED' | null;
  disabled: boolean;
  onPause(): void;
  onResume(): void;
  onFinish(): void;
  onSnap?(index: number): void;
  containerHeight?: number;
}) {
  const [index, setIndex] = useState(1);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const snapPoints = useMemo(() => {
    const available = Math.max(1, (containerHeight || windowHeight) - insets.top - insets.bottom);
    const expanded = available * 0.7;
    // 작은 화면·큰 글씨에서도 지표와 48dp 제어 버튼을 사용할 최소 높이를 확보한다.
    return [Math.min(expanded, Math.max(available * 0.3, 244 * fontScale)), expanded];
  }, [containerHeight, windowHeight, fontScale, insets.top, insets.bottom]);
  const { colors } = useUiTheme();
  return (
    <BottomSheet
      index={index}
      onChange={(next) => {
        setIndex(next);
        onSnap?.(next);
      }}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      enableOverDrag={false}
      topInset={insets.top}
      bottomInset={insets.bottom}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.muted }}
    >
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, index === 0 && styles.compact]}
      >
        {index !== 0 && (
          <AppText variant="heading">
            {status === 'PAUSED' ? '일시정지' : status === 'RUNNING' ? '러닝 중' : '러닝 시작 전'}
          </AppText>
        )}
        {children}
        <View style={styles.buttons}>
          {status === 'PAUSED' ? (
            <>
              <AppButton label="재개" disabled={disabled} onPress={onResume} />
              <AppButton label="종료" variant="danger" disabled={disabled} onPress={onFinish} />
            </>
          ) : (
            <AppButton label="일시정지" disabled={disabled || status === null} onPress={onPause} />
          )}
        </View>
        <AppText variant="caption" tone="muted">
          현재는 앱이 화면에 있을 때만 위치를 수집해요. 백그라운드 기록은 아직 지원하지 않아요.
        </AppText>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
const styles = StyleSheet.create({
  content: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl },
  buttons: { flexDirection: 'row', gap: Spacing.md },
  compact: { paddingVertical: Spacing.xs, gap: Spacing.xs },
});
