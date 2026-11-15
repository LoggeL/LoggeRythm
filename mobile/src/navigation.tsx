import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MiniPlayer from './components/MiniPlayer';
import { TrackPresentationProvider } from './components/player/TrackPresentationProvider';
import { strings } from './localization';
import { useLocaleRevision } from './localization/LocaleProvider';
import { LogoutButton, navTheme, sectionScreenOptions } from './navigation/headerChrome';
import { PlayerErrorBanner, PlayerNoticeWithoutMiniPlayer } from './navigation/playerOverlays';
import { PlayerStartupError, PlayerStartupStatus } from './navigation/PlayerStartup';
import { openSpotifyImport, rootNavigation } from './navigation/rootNavigation';
import { NowPlayingRoute, ProfileRoute, QueueRoute } from './navigation/routes';
import {
  DiscoverNavigator,
  HomeNavigator,
  LibraryNavigator,
  RadioNavigator,
  SearchNavigator,
} from './navigation/sectionNavigators';
import { TabBarIcon, tabBarScreenOptions } from './navigation/tabBar';
import type { AppTabParams, RootStackParams } from './navigation/types';
import { useApprovedAccountScope } from './navigation/useApprovedAccountScope';
import { useNavigationRestoration } from './navigation/useNavigationRestoration';
import { usePlayerBootstrap } from './navigation/usePlayerBootstrap';
import { appLinking } from './navigationLinking';
import { transientModalScreenOptions } from './navigationPolicy';
import { spotifySharedTextCoordinator } from './share/sharedTextRuntime';

/**
 * The navigator topology and nothing else: bottom tabs (each a section stack
 * from navigation/sectionNavigators) inside a root stack with the transient
 * Profile / NowPlaying / Queue routes. Everything else lives in
 * src/navigation/: route wrappers (routes.tsx), header chrome, tab bar look,
 * player overlays, and the bootstrap / restoration hooks.
 *
 * The tab order, `tabBarButtonTestID`s and route names below are contracts
 * (navigation.searchUx.test.ts scans this file; QA scripts tap the test IDs).
 */
export type { AppTabParams, RootStackParams, SectionStackParams } from './navigation/types';
export {
  openTrackAlbum,
  openTrackArtist,
  type TrackDetailNavigationResult,
} from './navigation/rootNavigation';

const Tab = createBottomTabNavigator<AppTabParams>();
const RootStack = createNativeStackNavigator<RootStackParams>();

function Tabs() {
  useLocaleRevision();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.fill}>
      <Tab.Navigator initialRouteName="HomeTab" screenOptions={tabBarScreenOptions(insets.bottom)}>
        <Tab.Screen
          name="HomeTab"
          component={HomeNavigator}
          options={{
            title: strings.navigation.home,
            tabBarButtonTestID: 'tab-home',
            tabBarAccessibilityLabel: strings.navigation.home,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="home" />,
          }}
        />
        <Tab.Screen
          name="DiscoverTab"
          component={DiscoverNavigator}
          options={{
            title: strings.navigation.discover,
            tabBarButtonTestID: 'tab-discover',
            tabBarAccessibilityLabel: strings.navigation.discover,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="compass-outline" />,
          }}
        />
        <Tab.Screen
          name="SearchTab"
          component={SearchNavigator}
          options={{
            title: strings.navigation.search,
            tabBarButtonTestID: 'tab-search',
            tabBarAccessibilityLabel: strings.navigation.search,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="magnify" />,
          }}
        />
        <Tab.Screen
          name="RadioTab"
          component={RadioNavigator}
          options={{
            title: strings.navigation.radio,
            tabBarButtonTestID: 'tab-radio',
            tabBarAccessibilityLabel: strings.navigation.radio,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="radio" />,
          }}
        />
        <Tab.Screen
          name="LibraryTab"
          component={LibraryNavigator}
          options={{
            title: strings.navigation.library,
            tabBarButtonTestID: 'tab-library',
            tabBarAccessibilityLabel: strings.navigation.library,
            tabBarIcon: ({ focused }) => <TabBarIcon focused={focused} name="bookshelf" />,
          }}
        />
      </Tab.Navigator>
      <PlayerErrorBanner />
      <PlayerNoticeWithoutMiniPlayer />
      <MiniPlayer />
    </View>
  );
}

/** Authenticated navigator, gated until the native MediaController is connected. */
export default function RootNavigator() {
  useLocaleRevision();
  const accountScope = useApprovedAccountScope();
  const player = usePlayerBootstrap(accountScope);
  const restoration = useNavigationRestoration(accountScope);
  const [navigationReady, setNavigationReady] = useState(false);

  useEffect(() => {
    if (!navigationReady) return undefined;
    return spotifySharedTextCoordinator.attachNavigator(accountScope, openSpotifyImport);
  }, [accountScope, navigationReady]);

  const retry = () => {
    setNavigationReady(false);
    player.retry();
  };

  if (player.error) return <PlayerStartupError error={player.error} retry={retry} />;
  if (!player.ready || !restoration.ready) return <PlayerStartupStatus />;

  return (
    <View style={styles.fill}>
      <TrackPresentationProvider>
        <NavigationContainer
          ref={rootNavigation}
          theme={navTheme}
          linking={appLinking}
          initialState={restoration.initialState}
          onReady={() => setNavigationReady(true)}
          onStateChange={restoration.persist}
        >
          <RootStack.Navigator screenOptions={sectionScreenOptions}>
            <RootStack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <RootStack.Screen
              name="Profile"
              component={ProfileRoute}
              options={{ title: strings.navigation.profile, headerRight: () => <LogoutButton /> }}
            />
            <RootStack.Screen
              name="NowPlaying"
              component={NowPlayingRoute}
              options={transientModalScreenOptions}
            />
            <RootStack.Screen
              name="Queue"
              component={QueueRoute}
              options={transientModalScreenOptions}
            />
          </RootStack.Navigator>
        </NavigationContainer>
      </TrackPresentationProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
