import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import RootNavigator from './src/navigation';
import LoginScreen from './src/screens/LoginScreen';
import { colors } from './src/theme';

function Gate() {
  const { user, bootstrapping } = useAuth();

  if (bootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  return user ? <RootNavigator /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
