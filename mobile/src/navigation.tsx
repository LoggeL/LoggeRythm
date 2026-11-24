import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, type NavigationState } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import { trackArtistLabel } from './api/trackArtists';
import DevicePickerHost from './components/connect/DevicePickerSheet';
import MiniPlayer from './components/MiniPlayer';
import { TrackPresentationProvider } from './components/player/TrackPresentationProvider';
import { connectSession } from './connect/connectRuntime';
import { useEffectivePlayback } from './connect/effectivePlaybackState';
import { useReducedMotion } from './hooks/useReducedMotion';
import { strings } from './localization';
import { useLocaleRevision } from './localization/LocaleProvider';
import { partyErrorDetail } from './party/partyErrors';
import { partySession } from './party/partyRuntime';
import { reportPlayerNotice } from './player/notices';
import {
  LogoutButton,
  buildSectionScreenOptions,
  navTheme,
} from './navigation/headerChrome';
import { PlayerErrorBanner, PlayerNoticeWithoutMiniPlayer } from './navigation/playerOverlays';
import { PlayerStartupError, PlayerStartupStatus } from './navigation/PlayerStartup';
import {
  openSpotifyImport,
  resolveActiveTvRoute,
  rootNavigation,
} from './navigation/rootNavigation';
import {
  NowPlayingRoute,
  PartyRoute,
  PlaylistInviteRoute,
  ProfileRoute,
  QueueRoute,
} from './navigation/routes';
import {
  DiscoverNavigator,
  HomeNavigator,
  LibraryNavigator,
  RadioNavigator,
  SearchNavigator,
} from './navigation/sectionNavigators';
import { TabBarIcon, renderHiddenTabBar, tabBarScreenOptions } from './navigation/tabBar';
import type { AppTabParams, RootStackParams } from './navigation/types';
import { useApprovedAccountScope } from './navigation/useApprovedAccountScope';
import { useNavigationRestoration } from './navigation/useNavigationRestoration';
import { usePlayerBootstrap } from './navigation/usePlayerBootstrap';
import { appLinking } from './navigationLinking';
import {
  TAB_BACK_BEHAVIOR,
  buildTransientModalScreenOptions,
} from './navigationPolicy';
import { spotifySharedTextCoordinator } from './share/sharedTextRuntime';
import { attachMediaPlayFromSearchIntake } from './voice/voicePlaybackRuntime';
import {
  TvShellLayout,
  tvFocusRegistry,
  useTvEnvironment,
  type TvNavDestinationKey,
  type TvNavNowPlayingSummary,
  type TvNavPrimaryKey,
} from './tv';
import {
  androidUpdateAttention,
  useAndroidUpdateSnapshot,
} from './update/androidUpdateStore';

/**
 * The navigator topology and nothing else: bottom tabs (each a section stack
 * from navigation/sectionNavigators) inside a root stack with the transient
 * Profile / NowPlaying / Queue routes, wrapped with `TvShellHost` so Android
 * TV presents the persistent left `TvNavigationRail` while phones keep the
 * bottom tab bar 100% untouched.
 *
 * The tab order, `tabBarButtonTestID`s and route names below are contracts
 * (navigation.searchUx.test.ts scans this file; QA scripts tap the test IDs).
 */
export type { AppTabParams, RootStackParams, SectionStackParams } from './navigation/types';
export {
  openAlbumInActiveTab,
  openArtistInActiveTab,
  openTrackAlbum,
  openTrackArtist,
  resolveActiveTabName,
  resolveActiveTvRoute,
  type AppTabName,
  type TrackDetailNavigationResult,
} from './navigation/rootNavigation';

const Tab = createBottomTabNavigator<AppTabParams>();
const RootStack = createNativeStackNavigator<RootStackParams>();

const TABS_SCREEN_OPTIONS: NativeStackNavigationOptions = { headerShown: false };
const renderHomeIcon = ({ focused }: { focused: boolean }) => (
  <TabBarIcon focused={focused} name="home" />
);
const renderDiscoverIcon = ({ focused }: { focused: boolean }) => (
  <TabBarIcon focused={focused} name="compass-outline" />
);
const renderSearchIcon = ({ focused }: { focused: boolean }) => (
  <TabBarIcon focused={focused} name="magnify" />
);
const renderRadioIcon = ({ focused }: { focused: boolean }) => (
  <TabBarIcon focused={focused} name="radio" />
);
const renderLibraryIcon = ({ focused }: { focused: boolean }) => (
  <TabBarIcon focused={focused} name="bookshelf" />
);
const renderLogoutHeaderRight = () => <LogoutButton />;

function openNowPlayingFromVoice(): void {
  if (!rootNavigation.isReady()) return;
  const activeRoute = resolveActiveTvRoute(rootNavigation.getRootState());
  if (activeRoute !== 'NowPlaying') {
    tvFocusRegistry.pushCheckpoint('tv-now-playing');
  }
  rootNavigation.navigate('NowPlaying');
}

function Tabs() {
  const localeRevision = useLocaleRevision();
  const insets = useSafeAreaInsets();
  const tv = useTvEnvironment();

  const screenOptions = useMemo(
    () => tabBarScreenOptions(insets.bottom),
    [insets.bottom],
  );
  const tabOptions = useMemo<Record<keyof AppTabParams, BottomTabNavigationOptions>>(
    () => ({
      HomeTab: {
        title: strings.navigation.home,
        tabBarButtonTestID: 'tab-home',
        tabBarAccessibilityLabel: strings.navigation.home,
        tabBarIcon: renderHomeIcon,
      },
      DiscoverTab: {
        title: strings.navigation.discover,
        tabBarButtonTestID: 'tab-discover',
        tabBarAccessibilityLabel: strings.navigation.discover,
        tabBarIcon: renderDiscoverIcon,
      },
      SearchTab: {
        title: strings.navigation.search,
        tabBarButtonTestID: 'tab-search',
        tabBarAccessibilityLabel: strings.navigation.search,
        tabBarIcon: renderSearchIcon,
      },
      RadioTab: {
        title: strings.navigation.radio,
        tabBarButtonTestID: 'tab-radio',
        tabBarAccessibilityLabel: strings.navigation.radio,
        tabBarIcon: renderRadioIcon,
      },
      LibraryTab: {
        title: strings.navigation.library,
        tabBarButtonTestID: 'tab-library',
        tabBarAccessibilityLabel: strings.navigation.library,
        tabBarIcon: renderLibraryIcon,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- localized tab labels follow localeRevision
    [localeRevision],
  );

  return (
    <View style={styles.fill}>
      <Tab.Navigator
        initialRouteName="HomeTab"
        backBehavior={TAB_BACK_BEHAVIOR}
        screenOptions={screenOptions}
        tabBar={tv.isTv ? renderHiddenTabBar : undefined}
      >
        <Tab.Screen
          name="HomeTab"
          component={HomeNavigator}
          options={tabOptions.HomeTab}
        />
        <Tab.Screen
          name="DiscoverTab"
          component={DiscoverNavigator}
          options={tabOptions.DiscoverTab}
        />
        <Tab.Screen
          name="SearchTab"
          component={SearchNavigator}
          options={tabOptions.SearchTab}
        />
        <Tab.Screen
          name="RadioTab"
          component={RadioNavigator}
          options={tabOptions.RadioTab}
        />
        <Tab.Screen
          name="LibraryTab"
          component={LibraryNavigator}
          options={tabOptions.LibraryTab}
        />
      </Tab.Navigator>
      <PlayerErrorBanner hasTabBar={!tv.isTv} />
      <PlayerNoticeWithoutMiniPlayer hasTabBar={!tv.isTv} />
      <MiniPlayer hasTabBar={!tv.isTv} />
    </View>
  );
}

interface TvShellChromeProps {
  activeRoute: TvNavDestinationKey;
  children: React.ReactNode;
}

/**
 * Mounted ONLY when `useTvEnvironment().isTv` is true, so phone mode pays zero
 * subscriptions or extra views. Wires the persistent left `TvNavigationRail`
 * to `rootNavigation` and preserves D-Pad focus checkpoints across modals.
 */
function TvShellChrome({ activeRoute, children }: TvShellChromeProps) {
  const effective = useEffectivePlayback();
  const updateAttention = androidUpdateAttention(useAndroidUpdateSnapshot());

  const nowPlaying = useMemo<TvNavNowPlayingSummary | null>(() => {
    const track = effective.track;
    if (track === null) return null;
    return {
      title: track.title,
      artist: trackArtistLabel(track),
      isPlaying: effective.playing,
    };
  }, [effective.playing, effective.track]);

  const handleSelectTab = useCallback((tab: TvNavPrimaryKey) => {
    if (!rootNavigation.isReady()) return;
    rootNavigation.navigate('Tabs', { screen: tab });
  }, []);

  const handleOpenNowPlaying = useCallback(() => {
    if (!rootNavigation.isReady()) return;
    if (activeRoute !== 'NowPlaying') {
      tvFocusRegistry.pushCheckpoint('tv-now-playing');
    }
    rootNavigation.navigate('NowPlaying');
  }, [activeRoute]);

  const handleOpenQueue = useCallback(() => {
    if (!rootNavigation.isReady()) return;
    if (activeRoute !== 'Queue') {
      tvFocusRegistry.pushCheckpoint('tv-queue');
    }
    rootNavigation.navigate('Queue');
  }, [activeRoute]);

  const handleOpenProfile = useCallback(() => {
    if (!rootNavigation.isReady()) return;
    if (activeRoute !== 'Profile') {
      tvFocusRegistry.pushCheckpoint('tv-profile');
    }
    rootNavigation.navigate('Profile');
  }, [activeRoute]);

  return (
    <TvShellLayout
      activeRoute={activeRoute}
      onSelectTab={handleSelectTab}
      onOpenNowPlaying={handleOpenNowPlaying}
      onOpenQueue={handleOpenQueue}
      onOpenProfile={handleOpenProfile}
      nowPlaying={nowPlaying}
      profileAttention={updateAttention !== 'none'}
    >
      {children}
    </TvShellLayout>
  );
}

/**
 * Adaptive shell wrapper: renders children untouched on phones and wraps the
 * navigator with `TvShellLayout` + `TvNavigationRail` on Android TV.
 */
export function TvShellHost({
  activeRoute,
  children,
}: {
  activeRoute: TvNavDestinationKey;
  children: React.ReactNode;
}) {
  const tv = useTvEnvironment();
  if (!tv.isTv) {
    return <>{children}</>;
  }
  return <TvShellChrome activeRoute={activeRoute}>{children}</TvShellChrome>;
}

function openPartyFromRoot(code: string): void {
  if (!rootNavigation.isReady()) return;
  rootNavigation.navigate('Party', { code });
}

/**
 * Starts the personal Connect WebSocket session and restores any active Jam
 * once the authenticated player is ready. Failures surface as visible notices.
 */
function RealtimeSessionsHost({ accountScope }: { accountScope: string }) {
  useEffect(() => {
    void connectSession().start();
    void partySession()
      .restoreActive()
      .catch((error: unknown) => {
        reportPlayerNotice(
          'bookkeeping',
          'party-restore',
          strings.party.defaultName,
          strings.party.restoreActiveFailed(partyErrorDetail(error)),
        );
      });
    return () => {
      connectSession().stop();
    };
  }, [accountScope]);
  return null;
}

/** Authenticated navigator, gated until the native MediaController is connected. */
export default function RootNavigator() {
  const localeRevision = useLocaleRevision();
  const reducedMotion = useReducedMotion();
  const accountScope = useApprovedAccountScope();
  const player = usePlayerBootstrap(accountScope);
  const restoration = useNavigationRestoration(accountScope);
  const [navigationReady, setNavigationReady] = useState(false);
  const [activeTvRoute, setActiveTvRoute] = useState<TvNavDestinationKey>('HomeTab');

  useEffect(() => {
    if (!navigationReady) return undefined;
    return spotifySharedTextCoordinator.attachNavigator(accountScope, openSpotifyImport);
  }, [accountScope, navigationReady]);

  useEffect(() => {
    if (!navigationReady) return undefined;
    return attachMediaPlayFromSearchIntake(accountScope, openNowPlayingFromVoice);
  }, [accountScope, navigationReady]);

  const retry = useCallback(() => {
    setNavigationReady(false);
    player.retry();
  }, [player]);

  const handleNavigationReady = useCallback(() => {
    setNavigationReady(true);
    if (rootNavigation.isReady()) {
      setActiveTvRoute(resolveActiveTvRoute(rootNavigation.getRootState()));
    }
  }, []);

  const handleStateChange = useCallback(
    (state: NavigationState | undefined) => {
      restoration.persist(state);
      const nextRoute = resolveActiveTvRoute(state);
      setActiveTvRoute((current) => (current === nextRoute ? current : nextRoute));
    },
    [restoration],
  );

  const rootScreenOptions = useMemo(
    () => buildSectionScreenOptions(reducedMotion),
    [reducedMotion],
  );
  const modalScreenOptions = useMemo(
    () => buildTransientModalScreenOptions(reducedMotion),
    [reducedMotion],
  );
  const profileScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: strings.navigation.profile,
      headerRight: renderLogoutHeaderRight,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- localized title tracks localeRevision
    [localeRevision],
  );
  const partyScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({ title: strings.party.defaultName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- localized title tracks localeRevision
    [localeRevision],
  );
  const playlistInviteScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({ title: strings.navigation.playlistInvite }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- localized title tracks localeRevision
    [localeRevision],
  );

  if (player.error) return <PlayerStartupError error={player.error} retry={retry} />;
  if (!player.ready || !restoration.ready) return <PlayerStartupStatus />;

  return (
    <View style={styles.fill}>
      <TrackPresentationProvider>
        <RealtimeSessionsHost accountScope={accountScope} />
        <NavigationContainer
          ref={rootNavigation}
          theme={navTheme}
          linking={appLinking}
          initialState={restoration.initialState}
          onReady={handleNavigationReady}
          onStateChange={handleStateChange}
        >
          <TvShellHost activeRoute={activeTvRoute}>
            <RootStack.Navigator screenOptions={rootScreenOptions}>
              <RootStack.Screen name="Tabs" component={Tabs} options={TABS_SCREEN_OPTIONS} />
              <RootStack.Screen
                name="Profile"
                component={ProfileRoute}
                options={profileScreenOptions}
              />
              <RootStack.Screen
                name="NowPlaying"
                component={NowPlayingRoute}
                options={modalScreenOptions}
              />
              <RootStack.Screen
                name="Queue"
                component={QueueRoute}
                options={modalScreenOptions}
              />
              <RootStack.Screen
                name="Party"
                component={PartyRoute}
                options={partyScreenOptions}
              />
              <RootStack.Screen
                name="PlaylistInvite"
                component={PlaylistInviteRoute}
                options={playlistInviteScreenOptions}
              />
            </RootStack.Navigator>
          </TvShellHost>
        </NavigationContainer>
        <DevicePickerHost onOpenParty={openPartyFromRoot} />
      </TrackPresentationProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
