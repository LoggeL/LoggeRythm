import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from './auth/AuthContext';
import { ensurePlayer } from './player/setup';
import { publishBrowseTree } from './player/browseTree';
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
  return (
    <Pressable onPress={() => void logout()} hitSlop={12}>
      <Text style={{ color: colors.textDim, fontSize: 14 }}>Log out</Text>
    </Pressable>
  );
}

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
      }}
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

function Tabs() {
  return (
    <View style={{ flex: 1 }}>
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
          options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🔍</Text> }}
        />
        <Tab.Screen
          name="LibraryTab"
          component={LibraryNavigator}
          options={{
            headerShown: false,
            title: 'Library',
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📚</Text>,
          }}
        />
      </Tab.Navigator>
      <MiniPlayer />
    </View>
  );
}

/** Root navigator for the authenticated app; boots the player + Android Auto tree. */
export default function RootNavigator() {
  useEffect(() => {
    (async () => {
      await ensurePlayer();
      // Populate the Android Auto / CarPlay browse tree from the library.
      publishBrowseTree().catch((e) => console.warn('browse tree publish failed:', e.message));
    })();
  }, []);

  return (
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
  );
}
