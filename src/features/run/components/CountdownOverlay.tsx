import { Modal, StyleSheet, View } from 'react-native';
import { AppText } from '@/shared/ui/components/AppText';
import { AppButton } from '@/shared/ui/components/AppButton';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { useUiTheme } from '@/shared/ui/useUiTheme';

export function CountdownOverlay({ seconds, onCancel }: { seconds: number; onCancel(): void }) {
  const { colors } = useUiTheme();
  return (
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppText variant="heading">위치 준비 완료</AppText>
        <AppText testID="countdown-value" accessibilityLiveRegion="assertive" style={styles.number}>
          {seconds}
        </AppText>
        <AppButton label="카운트다운 취소" onPress={onCancel} variant="secondary" />
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xxl },
  number: { fontSize: 96, lineHeight: 120, fontWeight: '700' },
});
