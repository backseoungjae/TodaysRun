import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { AppText } from './AppText';
import { Radius } from '../tokens/radius';
import { Spacing, TouchTarget } from '../tokens/spacing';
import { useUiTheme } from '../useUiTheme';

type AppButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  shape?: 'rounded' | 'circle';
};

export function AppButton({
  label,
  variant = 'primary',
  shape = 'rounded',
  disabled = false,
  accessibilityLabel = label,
  accessibilityState,
  style,
  ...props
}: AppButtonProps) {
  const { colors } = useUiTheme();
  const backgroundColor = disabled
    ? colors.disabled
    : variant === 'primary'
      ? colors.primary
      : colors.surface;
  const color = disabled
    ? colors.onDisabled
    : variant === 'danger'
      ? colors.danger
      : variant === 'primary'
        ? colors.onPrimary
        : colors.text;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, disabled: Boolean(disabled) }}
      disabled={disabled}
      style={(state) => [
        styles.button,
        shape === 'circle' && styles.circle,
        { backgroundColor, borderColor: colors.border, opacity: state.pressed ? 0.75 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <AppText variant={shape === 'circle' ? 'title' : 'button'} style={{ color }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TouchTarget,
    minWidth: TouchTarget,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: { width: 224, minHeight: 224, borderRadius: Radius.round },
});
