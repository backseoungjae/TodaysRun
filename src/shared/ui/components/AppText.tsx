import { Text, type TextProps } from 'react-native';
import { Typography } from '../tokens/typography';
import { useUiTheme } from '../useUiTheme';

type AppTextProps = TextProps & {
  variant?: keyof typeof Typography;
  tone?: 'text' | 'muted' | 'danger';
};

export function AppText({ variant = 'body', tone = 'text', style, ...props }: AppTextProps) {
  const { colors } = useUiTheme();
  return <Text {...props} style={[Typography[variant], { color: colors[tone] }, style]} />;
}
