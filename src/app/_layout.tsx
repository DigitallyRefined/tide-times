import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, View } from 'react-native';
import { MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const webHeaderOptions =
  Platform.OS === 'web'
    ? {
        headerTitleContainerStyle: {
          flex: 1,
          maxWidth: MaxContentWidth,
          marginHorizontal: 'auto',
          marginStart: 'auto',
          marginEnd: 'auto',
        },
        headerRightContainerStyle: { flexGrow: 0, flexBasis: 'auto' },
      }
    : null;

export default function RootLayout() {
  const colors = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          ...webHeaderOptions,
        }}
      />
    </View>
  );
}