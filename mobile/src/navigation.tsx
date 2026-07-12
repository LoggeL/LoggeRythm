import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from './auth/AuthContext';
import { ensurePlayer } from './player/setup';
import { cancelBrowseTreePublication, refreshBrowseTree } from './player/browseTree';
import { clearPlayerError, reportPlayerError, usePlayerError } from './player/errors';
import MiniPlayer from './components/MiniPlayer';
import SearchScreen from './screens/SearchScreen';
import LibraryScreen from './screens/LibraryScreen';
import PlaylistScreen from './screens/PlaylistScreen';
import NowPlayingScreen from './screens/NowPlayingScreen';
import { colors } from './theme';

export type LibraryStackParams = {
  LibraryHome: undefined;
  Playlist:
    | { kind: 'playlist'; id: number; name: string }
    | { kind: 'liked'; name: string };
};

export type RootStackParams = {
  Tabs: undefined;
  NowPlaying: undefined;
};

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    primary: colors.accent,
    border: colors.border,
  },
};

const LibraryStack = createNativeStackNavigator<LibraryStackParams>();
const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootStackParams>();

function LogoutButton() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } catch (error) {
      Alert.alert('Logout failed', (error as Error).message);
      setBusy(false);
    }
  };
  return (
    <Pressable accessibilityRole="button" onPress={() => void onLogout()} disabled={busy} hitSlop={12}>
      <Text style={styles.logout}>{busy ? 'Logging out…' : 'Log out'}</Text>
    </Pressable>
  );
}

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }}
    >
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{ title: 'Library', headerRight: () => <LogoutButton /> }}
      />
      <LibraryStack.Screen
        name="Playlist"
        component={PlaylistScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
    </LibraryStack.Navigator>
  );
}

function PlayerErrorBanner() {
  const error = usePlayerError();
  if (!error) return null;
  return (
    <View style={styles.errorBanner} accessibilityRole="alert">
      <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={clearPlayerError} hitSlop={10}>
        <Text style={styles.dismiss}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

function Tabs() {
  return (
    <View style={styles.fill}>
      <Tab.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textDim,
        }}
      >
        <Tab.Screen
          name="Search"
          component={SearchScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⌕</Text> }}
        />
        <Tab.Screen
          name="LibraryTab"
          component={LibraryNavigator}
          options={{
            headerShown: false,
            title: 'Library',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>♫</Text>,
          }}
        />
      </Tab.Navigator>
      <PlayerErrorBanner />
      <MiniPlayer />
    </View>
  );
}

function PlayerStartupError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={styles.startupState}>
      <Text style={styles.startupTitle}>Audio player couldn’t start</Text>
      <Text style={styles.startupMessage}>{message}</Text>
      <Pressable accessibilityRole="button" style={styles.retryButton} onPress={retry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

/** Authenticated navigator, gated until the native player setup request succeeds. */
export default function RootNavigator() {
  const [playerReady, setPlayerReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    // Commit the authenticated gate first, then ask RNTP to connect Media3.
    // RNTP's setup call is synchronous but completes its MediaController
    // connection asynchronously; its getters tolerate that connection window.
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mounted) return;
      try {
        ensurePlayer();
        if (!mounted) return;
        setPlayerReady(true);
        void refreshBrowseTree()
          .then(() => {
            if (mounted) console.info('[LoggeRythm] Android Auto library ready');
          })
          .catch((error) => {
            if (mounted) reportPlayerError('Android Auto library failed to load', error);
          });
      } catch (error) {
        if (mounted) setStartupError((error as Error).message);
      }
    });
    return () => {
      mounted = false;
      task.cancel();
      cancelBrowseTreePublication();
    };
  }, [attempt]);

  const retry = () => {
    setPlayerReady(false);
    setStartupError(null);
    setAttempt((value) => value + 1);
  };

  if (startupError) return <PlayerStartupError message={startupError} retry={retry} />;
  if (!playerReady) {
    return (
      <View style={styles.startupState}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.startupMessage}>Preparing native audio…</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <NavigationContainer theme={navTheme}>
        <RootStack.Navigator>
          <RootStack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
          <RootStack.Screen
            name="NowPlaying"
            component={NowPlayingScreen}
            options={{ headerShown: false, presentation: 'modal' }}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  logout: { color: colors.textDim, fontSize: 14 },
  errorBanner: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 126,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.surfaceAlt,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: { color: colors.error, fontSize: 12, flex: 1 },
  dismiss: { color: colors.text, fontSize: 12, fontWeight: '700' },
  startupState: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: 28,
    gap: 14,
  },
  startupTitle: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  startupMessage: { color: colors.error, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { backgroundColor: colors.accent, borderRadius: 22, paddingHorizontal: 28, paddingVertical: 12 },
  retryText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
