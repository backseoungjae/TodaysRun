import { StyleSheet, View } from 'react-native';
import { AppText } from '@/shared/ui/components/AppText';
import { Screen } from '@/shared/ui/components/Screen';
import { Spacing } from '@/shared/ui/tokens/spacing';

export default function ActivityScreen() {
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        러닝 기록
      </AppText>
      <View style={styles.empty}>
        <AppText variant="heading">아직 러닝 기록이 없어요</AppText>
        <AppText tone="muted" style={styles.center}>
          첫 러닝을 마치면 이곳에 기록이 쌓여요.
        </AppText>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xxxl,
  },
  center: { textAlign: 'center' },
});
