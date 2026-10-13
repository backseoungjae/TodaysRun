import { StyleSheet, View } from 'react-native';
import { AppButton } from '@/shared/ui/components/AppButton';
import { AppText } from '@/shared/ui/components/AppText';
import { Screen } from '@/shared/ui/components/Screen';
import { Spacing } from '@/shared/ui/tokens/spacing';

export default function HomeScreen() {
  return (
    <Screen>
      <View style={styles.greeting}>
        <AppText variant="caption" tone="muted">
          오늘도 나만의 속도로
        </AppText>
        <AppText variant="title" accessibilityRole="header">
          반가워요!{'\n'}오늘도 함께 달려요.
        </AppText>
      </View>
      <View style={styles.start}>
        <AppButton
          label="START"
          shape="circle"
          disabled
          accessibilityHint="러닝 기능 준비 중으로 아직 시작할 수 없습니다."
        />
        <AppText tone="muted" style={styles.center}>
          러닝 기능을 준비하고 있어요.{'\n'}지금은 운동을 시작할 수 없어요.
        </AppText>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  greeting: { gap: Spacing.sm },
  start: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  center: { textAlign: 'center' },
});
