import type { PropsWithChildren } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { AppButton } from '@/shared/ui/components/AppButton';
import { AppText } from '@/shared/ui/components/AppText';
import { Screen } from '@/shared/ui/components/Screen';
import { Radius } from '@/shared/ui/tokens/radius';
import { Spacing } from '@/shared/ui/tokens/spacing';
import { useUiTheme } from '@/shared/ui/useUiTheme';
import appConfig from '../../../app.json';

function SettingSection({ title, children }: PropsWithChildren<{ title: string }>) {
  const { colors } = useUiTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        설정
      </AppText>
      <SettingSection title="위치 권한">
        <AppText tone="muted">권한 상태를 아직 확인하지 않았어요.</AppText>
        <AppButton label="기기 설정 열기" variant="secondary" disabled />
        <AppText variant="caption" tone="muted">
          위치 권한 확인과 설정 이동 기능은 준비 중이에요.
        </AppText>
      </SettingSection>
      <SettingSection title="백그라운드 기록">
        <View style={styles.row}>
          <AppText style={styles.rowLabel}>백그라운드 기록 사용</AppText>
          <Switch
            value={false}
            disabled
            accessibilityState={{ disabled: true, checked: false }}
            accessibilityLabel="백그라운드 기록 사용"
            accessibilityHint="기능 준비 중이며 현재 값을 저장하지 않습니다."
          />
        </View>
        <AppText variant="caption" tone="muted">
          기능 준비 중이에요. 표시된 값은 저장된 설정이 아니에요.
        </AppText>
      </SettingSection>
      <SettingSection title="데이터 초기화">
        <AppText tone="muted">러닝 기록과 경로를 삭제하는 기능이에요.</AppText>
        <AppButton label="전체 기록 삭제" variant="danger" disabled />
        <AppText variant="caption" tone="muted">
          기록 저장과 삭제 기능은 준비 중이에요.
        </AppText>
      </SettingSection>
      <SettingSection title="앱 소개">
        <AppText>TodaysRun · {appConfig.expo.version}</AppText>
        <AppText tone="muted">달리기에 집중하고, 기록은 정확하게.</AppText>
        <AppText variant="caption" tone="muted">
          로그인 없이 기기 안에 기록하는 러닝 앱을 만들고 있어요.
        </AppText>
      </SettingSection>
    </Screen>
  );
}
const styles = StyleSheet.create({
  section: { padding: Spacing.xl, gap: Spacing.md, borderRadius: Radius.lg, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowLabel: { flex: 1 },
});
