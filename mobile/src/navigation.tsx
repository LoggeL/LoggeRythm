import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DarkTheme,
  NavigationContainer,
  createNavigationContainerRef,
  useIsFocused,
  type InitialState,
  type NavigatorScreenParams,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useActiveMediaItem } from '@rntp/player';
import type { Track } from './api/types';
import { useAuth } from './auth/AuthContext';
import { presentError, type UserFacingError } from './auth/presentationError';
import { tryResolveServerUrl } from './api/url';
import { DEFAULT_API_BASE, normalizeApiBase } from './config';
import { musicCacheScope } from './data';
import { ensurePlayer } from './player/setup';
import { initializeOfflineDownloads } from './offline/runtime';
import { cancelBrowseTreePublication, refreshBrowseTree } from './player/browseTree';
import { clearPlayerError, usePlayerError } from './player/errors';
import { reportPlayerNotice } from './player/notices';
import MiniPlayer, { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from './components/MiniPlayer';
import PlayerNoticeBanner from './components/PlayerNoticeBanner';
import BrandLockup from './components/BrandLockup';
import AppIcon from './components/AppIcon';
import { TrackPresentationProvider } from './components/player/TrackPresentationProvider';
import HomeScreen from './screens/HomeScreen';
import MixScreen from './screens/MixScreen';
import RadarScreen from './screens/RadarScreen';
import SearchScreen from './screens/SearchScreen';
import DiscoverScreen from './screens/DiscoverScreen';
import RadioScreen from './screens/RadioScreen';
import LibraryScreen from './screens/LibraryScreen';
import AlbumScreen from './screens/AlbumScreen';
import GenreScreen from './screens/GenreScreen';
import ArtistScreen from './screens/ArtistScreen';
import PlaylistScreen from './screens/PlaylistScreen';
import ProfileScreen from './screens/ProfileScreen';
import NowPlayingScreen from './screens/NowPlayingScreen';
import QueueScreen from './screens/QueueScreen';
import type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
} from './screens/catalogModel';
import type { LibraryPlaylistRouteParams } from './screens/libraryModel';
import type { HomeMixRouteParams } from './screens/homeModel';
import {
  playlistIdFromRouteValue,
  safeRouteLabel,
  trackAlbumRoute,
  trackArtistRoute,
} from './navigationLinks';
import { appLinking } from './navigationLinking';
import {
  persistNavigationState,
  readNavigationStateUnlessLinked,
} from './navigationPersistence';
import { transientModalScreenOptions } from './navigationPolicy';
import { strings } from './localization';
import { useLocaleRevision } from './localization/LocaleProvider';
import { spotifySharedTextCoordinator } from './share/sharedTextRuntime';
import { colors, metrics } from './theme';

export type SectionStackParams = {
  Home: undefined;
  Search: undefined;
  Discover: undefined;
  Radio: undefined;
  Library: undefined;
  Mix: HomeMixRouteParams;
  Radar: undefined;
  Album: AlbumRouteParams;
  Genre: GenreRouteParams;
  Artist: ArtistRouteParams;
  Playlist: LibraryPlaylistRouteParams;
};

export type AppTabParams = {
  HomeTab: NavigatorScreenParams<SectionStackParams> | undefined;
  SearchTab: NavigatorScreenParams<SectionStackParams> | undefined;
  DiscoverTab: NavigatorScreenParams<SectionStackParams> | undefined;
  RadioTab: NavigatorScreenParams<SectionStackParams> | undefined;
  LibraryTab: NavigatorScreenParams<SectionStackParams> | undefined;
};

export type RootStackParams = {
  Tabs: NavigatorScreenParams<AppTabParams> | undefined;
  Profile: undefined;
  NowPlaying: undefined;
  Queue: undefined;
};

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.backgroundElevated,
    text: colors.textPrimary,
    primary: colors.accent,
    border: colors.border,
    notification: colors.danger,
  },
};

const rootNavigation = createNavigationContainerRef<RootStackParams>();
const SectionStack = createNativeStackNavigator<SectionStackParams>();
const Tab = createBottomTabNavigator<AppTabParams>();
const RootStack = createNativeStackNavigator<RootStackParams>();

export type TrackDetailNavigationResult = 'opened' | 'invalid-track' | 'not-ready';

/** Route global track actions through one typed, validated catalog stack. */
export function openTrackAlbum(track: Track): TrackDetailNavigationResult {
  const params = trackAlbumRoute(track);
  if (params === null) return 'invalid-track';
  if (!rootNavigation.isReady()) return 'not-ready';
  rootNavigation.navigate('Tabs', {
    screen: 'DiscoverTab',
    params: { screen: 'Album', params },
  });
  return 'opened';
}

export function openTrackArtist(track: Track): TrackDetailNavigationResult {
  const params = trackArtistRoute(track);
  if (params === null) return 'invalid-track';
  if (!rootNavigation.isReady()) return 'not-ready';
  rootNavigation.navigate('Tabs', {
    screen: 'DiscoverTab',
    params: { screen: 'Artist', params },
  });
  return 'opened';
}

function openSpotifyImport(): boolean {
  if (!rootNavigation.isReady()) return false;
  rootNavigation.navigate('Tabs', {
    screen: 'SearchTab',
    params: { screen: 'Search' },
  });
  return true;
}

type SectionProps<Name extends keyof SectionStackParams> = NativeStackScreenProps<
  SectionStackParams,
  Name
>;

function useApprovedAccountScope(): string {
  const { user } = useAuth();
  if (user === null || !user.is_approved) {
    throw new Error('Authenticated navigation requires an approved account');
  }
  return musicCacheScope(normalizeApiBase(DEFAULT_API_BASE), user.id);
}

function HomeRoute({ navigation }: SectionProps<'Home'>) {
  useLocaleRevision();
  return (
    <HomeScreen
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
      onOpenGenre={(params) => navigation.push('Genre', params)}
      onOpenPlaylist={(params) =>
        navigation.push('Playlist', { kind: 'playlist', ...params })
      }
      onOpenMix={(params) => navigation.push('Mix', params)}
      onOpenRadar={() => navigation.push('Radar')}
    />
  );
}

function SearchRoute({ navigation }: SectionProps<'Search'>) {
  useLocaleRevision();
  const accountScope = useApprovedAccountScope();
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return undefined;
    return spotifySharedTextCoordinator.attachSearchOwner(accountScope);
  }, [accountScope, focused]);

  return (
    <SearchScreen
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
      onOpenGenre={(params) => navigation.push('Genre', params)}
    />
  );
}

function DiscoverRoute({ navigation }: SectionProps<'Discover'>) {
  useLocaleRevision();
  return (
    <DiscoverScreen
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
      onOpenGenre={(params) => navigation.push('Genre', params)}
      onOpenPlaylist={(params) =>
        navigation.push('Playlist', { kind: 'playlist', ...params })
      }
    />
  );
}

function RadioRoute() {
  useLocaleRevision();
  return <RadioScreen />;
}

function LibraryRoute({ navigation }: SectionProps<'Library'>) {
  useLocaleRevision();
  return (
    <LibraryScreen
      onOpenPlaylist={(params) => navigation.push('Playlist', params)}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function AlbumRoute({ route, navigation }: SectionProps<'Album'>) {
  useLocaleRevision();
  return (
    <AlbumScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function MixRoute({ route, navigation }: SectionProps<'Mix'>) {
  useLocaleRevision();
  return (
    <MixScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function RadarRoute({ navigation }: SectionProps<'Radar'>) {
  useLocaleRevision();
  return (
    <RadarScreen
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function GenreRoute({ route, navigation }: SectionProps<'Genre'>) {
  useLocaleRevision();
  return (
    <GenreScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function ArtistRoute({ route, navigation }: SectionProps<'Artist'>) {
  useLocaleRevision();
  return (
    <ArtistScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

function normalizedPlaylistParams(value: unknown): LibraryPlaylistRouteParams | null {
  const candidate = value as Partial<LibraryPlaylistRouteParams> | null;
  const owned = value as { playlistId?: unknown; name?: unknown } | null;
  const playlistId = playlistIdFromRouteValue(owned?.playlistId);
  if (playlistId !== null) {
    return {
      kind: 'playlist',
      playlistId,
      name:
        candidate?.kind === 'playlist'
          ? safeRouteLabel(owned?.name, strings.navigation.playlists)
          : strings.navigation.playlists,
    };
  }
  if (candidate?.kind === 'liked') {
    return {
      kind: 'liked',
      name: safeRouteLabel(candidate.name, strings.navigation.likedSongs),
    };
  }
  return null;
}

function PlaylistRoute({ route, navigation }: SectionProps<'Playlist'>) {
  useLocaleRevision();
  const params = normalizedPlaylistParams(route.params);
  if (params === null) {
    return (
      <View testID="invalid-content-link" style={styles.invalidLink}>
        <Text accessibilityRole="header" style={styles.invalidLinkTitle}>
          {strings.navigation.invalidLinkTitle}
        </Text>
        <Text accessibilityRole="alert" style={styles.invalidLinkBody}>
          {strings.navigation.invalidLinkBody}
        </Text>
        <Pressable
          testID="invalid-content-link-back"
          accessibilityRole="button"
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
          }}
          style={styles.invalidLinkButton}
        >
          <Text style={styles.invalidLinkButtonText}>{strings.navigation.invalidLinkBack}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <PlaylistScreen
      {...params}
      onDeleted={() => navigation.goBack()}
      onOpenAlbum={(album) => navigation.push('Album', album)}
      onOpenArtist={(artist) => navigation.push('Artist', artist)}
    />
  );
}

function ProfileButton() {
  const { user } = useAuth();
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatarValue = user?.avatar_url ?? null;
  const avatar =
    avatarValue && failedAvatar !== avatarValue
      ? tryResolveServerUrl(avatarValue, normalizeApiBase(DEFAULT_API_BASE))
      : null;
  const initial = (user?.display_name?.trim() || user?.email || '?').slice(0, 1).toUpperCase();

  const openProfile = () => {
    if (!rootNavigation.isReady()) {
      Alert.alert(strings.navigation.profileUnavailable);
      return;
    }
    rootNavigation.navigate('Profile');
  };

  return (
    <Pressable
      testID="profile-access"
      accessibilityRole="button"
      accessibilityLabel={strings.navigation.openProfile}
      onPress={openProfile}
      hitSlop={6}
      style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
    >
      {avatar ? (
        <Image
          accessible={false}
          source={{ uri: avatar }}
          onError={() => setFailedAvatar(avatarValue)}
          style={styles.profileAvatar}
        />
      ) : (
        <Text accessible={false} style={styles.profileInitial}>{initial}</Text>
      )}
    </Pressable>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } catch (error) {
      Alert.alert(
        strings.auth.logoutFailed,
        presentError(error, strings.auth.logoutFailedMessage).message,
      );
      setBusy(false);
    }
  };
  return (
    <Pressable
      testID="logout-button"
      accessibilityRole="button"
      accessibilityLabel={busy ? strings.auth.signingOut : strings.auth.signOut}
      accessibilityState={{ disabled: busy, busy }}
      onPress={() => void onLogout()}
      disabled={busy}
      hitSlop={8}
      style={styles.logoutButton}
    >
      <Text style={styles.logout}>{busy ? strings.auth.signingOut : strings.auth.signOut}</Text>
    </Pressable>
  );
}

function RootHeaderTitle({ title }: { title: string }) {
  return (
    <BrandLockup
      compact
      horizontal
      accessibilityRole="header"
      accessibilityLabel={`${strings.common.appName}, ${title}`}
    />
  );
}

const sectionScreenOptions = {
  headerStyle: { backgroundColor: colors.backgroundElevated },
  headerTintColor: colors.textPrimary,
  headerShadowVisible: false,
};

function detailScreens() {
  return (
    <>
      <SectionStack.Screen
        name="Mix"
        component={MixRoute}
        options={({ route }) => ({
          title: route.params.title || strings.home.mixes,
          headerRight: () => <ProfileButton />,
        })}
      />
      <SectionStack.Screen
        name="Radar"
        component={RadarRoute}
        options={{
          title: strings.home.releaseRadar,
          headerRight: () => <ProfileButton />,
        }}
      />
      <SectionStack.Screen
        name="Album"
        component={AlbumRoute}
        options={({ route }) => ({
          title: route.params.title || strings.navigation.album,
          headerRight: () => <ProfileButton />,
        })}
      />
      <SectionStack.Screen
        name="Genre"
        component={GenreRoute}
        options={({ route }) => ({
          title: route.params.name || strings.navigation.genre,
          headerRight: () => <ProfileButton />,
        })}
      />
      <SectionStack.Screen
        name="Artist"
        component={ArtistRoute}
        options={({ route }) => ({
          title: route.params.name || strings.navigation.artist,
          headerRight: () => <ProfileButton />,
        })}
      />
      <SectionStack.Screen
        name="Playlist"
        component={PlaylistRoute}
        options={({ route }) => ({
          title: route.params?.name || strings.navigation.playlists,
          headerRight: () => <ProfileButton />,
        })}
      />
    </>
  );
}

function brandedRootOptions(title: string) {
  return {
    headerTitle: () => <RootHeaderTitle title={title} />,
    headerRight: () => <ProfileButton />,
  };
}

function HomeNavigator() {
  useLocaleRevision();
  return (
    <SectionStack.Navigator initialRouteName="Home" screenOptions={sectionScreenOptions}>
      <SectionStack.Screen name="Home" component={HomeRoute} options={brandedRootOptions(strings.navigation.home)} />
      {detailScreens()}
    </SectionStack.Navigator>
  );
}

function SearchNavigator() {
  useLocaleRevision();
  return (
    <SectionStack.Navigator initialRouteName="Search" screenOptions={sectionScreenOptions}>
      <SectionStack.Screen name="Search" component={SearchRoute} options={brandedRootOptions(strings.navigation.search)} />
      {detailScreens()}
    </SectionStack.Navigator>
  );
}

function DiscoverNavigator() {
  useLocaleRevision();
  return (
    <SectionStack.Navigator initialRouteName="Discover" screenOptions={sectionScreenOptions}>
      <SectionStack.Screen name="Discover" component={DiscoverRoute} options={brandedRootOptions(strings.navigation.discover)} />
      {detailScreens()}
    </SectionStack.Navigator>
  );
}

function RadioNavigator() {
  useLocaleRevision();
  return (
    <SectionStack.Navigator initialRouteName="Radio" screenOptions={sectionScreenOptions}>
      <SectionStack.Screen name="Radio" component={RadioRoute} options={brandedRootOptions(strings.navigation.radio)} />
      {detailScreens()}
    </SectionStack.Navigator>
  );
}

function LibraryNavigator() {
  useLocaleRevision();
  return (
    <SectionStack.Navigator initialRouteName="Library" screenOptions={sectionScreenOptions}>
      <SectionStack.Screen name="Library" component={LibraryRoute} options={brandedRootOptions(strings.navigation.library)} />
      {detailScreens()}
    </SectionStack.Navigator>
  );
}

function PlayerErrorBanner({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const error = usePlayerError();
  const insets = useSafeAreaInsets();
  if (!error) return null;
  return (
    <View
      testID="player-error-banner"
      style={[
        styles.errorBanner,
        {
          bottom:
            (hasTabBar ? TAB_BAR_HEIGHT : 0) +
            insets.bottom +
            MINI_PLAYER_HEIGHT +
            8,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={styles.errorText} numberOfLines={3}>{error}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.player.playerErrorDismiss}
        onPress={clearPlayerError}
        hitSlop={8}
        style={styles.dismissButton}
      >
        <Text style={styles.dismiss}>{strings.common.dismiss}</Text>
      </Pressable>
    </View>
  );
}

function PlayerNoticeWithoutMiniPlayer({ hasTabBar = true }: { hasTabBar?: boolean }) {
  const item = useActiveMediaItem();
  const insets = useSafeAreaInsets();
  if (item !== undefined && item !== null) return null;
  return (
    <PlayerNoticeBanner
      bottom={(hasTabBar ? TAB_BAR_HEIGHT : 0) + insets.bottom + 8}
    />
  );
}

function TabIcon({
  color,
  name,
}: {
  color: string;
  name: React.ComponentProps<typeof AppIcon>['name'];
}) {
  return <AppIcon color={color} name={name} size={24} />;
}

function Tabs() {
  useLocaleRevision();
  return (
    <View style={styles.fill}>
      <Tab.Navigator
        initialRouteName="HomeTab"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tab.Screen
          name="HomeTab"
          component={HomeNavigator}
          options={{
            title: strings.navigation.home,
            tabBarButtonTestID: 'tab-home',
            tabBarAccessibilityLabel: strings.navigation.home,
            tabBarIcon: ({ color }) => <TabIcon color={color} name="home" />,
          }}
        />
        <Tab.Screen
          name="SearchTab"
          component={SearchNavigator}
          options={{
            title: strings.navigation.search,
            tabBarButtonTestID: 'tab-search',
            tabBarAccessibilityLabel: strings.navigation.search,
            tabBarIcon: ({ color }) => <TabIcon color={color} name="magnify" />,
          }}
        />
        <Tab.Screen
          name="DiscoverTab"
          component={DiscoverNavigator}
          options={{
            title: strings.navigation.discover,
            tabBarButtonTestID: 'tab-discover',
            tabBarAccessibilityLabel: strings.navigation.discover,
            tabBarIcon: ({ color }) => <TabIcon color={color} name="compass-outline" />,
          }}
        />
        <Tab.Screen
          name="RadioTab"
          component={RadioNavigator}
          options={{
            title: strings.navigation.radio,
            tabBarButtonTestID: 'tab-radio',
            tabBarAccessibilityLabel: strings.navigation.radio,
            tabBarIcon: ({ color }) => <TabIcon color={color} name="radio" />,
          }}
        />
        <Tab.Screen
          name="LibraryTab"
          component={LibraryNavigator}
          options={{
            title: strings.navigation.library,
            tabBarButtonTestID: 'tab-library',
            tabBarAccessibilityLabel: strings.navigation.library,
            tabBarIcon: ({ color }) => <TabIcon color={color} name="bookshelf" />,
          }}
        />
      </Tab.Navigator>
      <PlayerErrorBanner />
      <PlayerNoticeWithoutMiniPlayer />
      <MiniPlayer />
    </View>
  );
}

function ProfileRoute() {
  useLocaleRevision();
  return (
    <View style={styles.fill}>
      <ProfileScreen />
      <PlayerErrorBanner hasTabBar={false} />
      <PlayerNoticeWithoutMiniPlayer hasTabBar={false} />
      <MiniPlayer hasTabBar={false} />
    </View>
  );
}

function NowPlayingRoute(
  props: NativeStackScreenProps<RootStackParams, 'NowPlaying'>,
) {
  useLocaleRevision();
  return <NowPlayingScreen {...props} />;
}

function QueueRoute(props: NativeStackScreenProps<RootStackParams, 'Queue'>) {
  useLocaleRevision();
  return <QueueScreen {...props} />;
}

function PlayerStartupError({ error, retry }: { error: UserFacingError; retry: () => void }) {
  return (
    <View testID="player-startup-error" style={styles.startupState} accessibilityViewIsModal>
      <BrandLockup compact />
      <Text accessibilityRole="header" style={styles.startupTitle}>
        {strings.player.startFailedTitle}
      </Text>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.startupError}>
        {error.message}
      </Text>
      <Pressable
        testID="player-startup-retry"
        accessibilityRole="button"
        accessibilityLabel={strings.common.retry}
        style={styles.retryButton}
        onPress={retry}
      >
        <Text style={styles.retryText}>{strings.common.retry}</Text>
      </Pressable>
    </View>
  );
}

/** Authenticated navigator, gated until the native MediaController is connected. */
export default function RootNavigator() {
  useLocaleRevision();
  const accountScope = useApprovedAccountScope();
  const [playerReady, setPlayerReady] = useState(false);
  const [startupError, setStartupError] = useState<UserFacingError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [navigationReady, setNavigationReady] = useState(false);
  const [restoration, setRestoration] = useState<{
    scope: string | null;
    ready: boolean;
    state: InitialState | undefined;
  }>({ scope: null, ready: false, state: undefined });

  useEffect(() => {
    let active = true;
    void readNavigationStateUnlessLinked(
      AsyncStorage,
      accountScope,
      () => Linking.getInitialURL(),
    )
      .then((state) => {
        if (active) {
          setRestoration({ scope: accountScope, ready: true, state: state ?? undefined });
        }
      })
      .catch(() => {
        if (active) {
          console.error('[LoggeRythm] navigation restoration failed');
          setRestoration({ scope: accountScope, ready: true, state: undefined });
        }
      });
    return () => {
      active = false;
    };
  }, [accountScope]);

  useEffect(() => {
    if (!navigationReady) return undefined;
    return spotifySharedTextCoordinator.attachNavigator(accountScope, openSpotifyImport);
  }, [accountScope, navigationReady]);

  useEffect(() => {
    let mounted = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mounted) return;
      void initializeOfflineDownloads(accountScope)
        .then(() => {
          if (!mounted) return undefined;
          return ensurePlayer();
        })
        .then(() => {
          if (!mounted) return;
          setPlayerReady(true);
          void refreshBrowseTree()
            .then(() => {
              if (mounted) console.info('[LoggeRythm] Android Auto library ready');
            })
            .catch(() => {
              if (!mounted) return;
              reportPlayerNotice(
                'bookkeeping',
                'auto-library-refresh',
                strings.player.autoLibraryFailed,
                strings.player.autoLibraryRefreshFailedMessage,
              );
            });
        })
        .catch((error) => {
          if (mounted) setStartupError(presentError(error, strings.player.startFailedMessage));
        });
    });
    return () => {
      mounted = false;
      task.cancel();
      cancelBrowseTreePublication();
    };
  }, [accountScope, attempt]);

  const retry = () => {
    setPlayerReady(false);
    setStartupError(null);
    setNavigationReady(false);
    setAttempt((value) => value + 1);
  };

  if (startupError) return <PlayerStartupError error={startupError} retry={retry} />;
  if (!playerReady || restoration.scope !== accountScope || !restoration.ready) {
    return (
      <View
        testID="player-startup-status"
        style={styles.startupState}
        accessibilityRole="progressbar"
        accessibilityLabel={strings.player.preparing}
        accessibilityLiveRegion="polite"
      >
        <BrandLockup compact />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.startupStatus}>{strings.player.preparing}</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <TrackPresentationProvider>
        <NavigationContainer
          ref={rootNavigation}
          theme={navTheme}
          linking={appLinking}
          initialState={restoration.state}
          onReady={() => setNavigationReady(true)}
          onStateChange={(state) => {
            if (state === undefined) return;
            void persistNavigationState(AsyncStorage, accountScope, state).catch(() => {
              console.error('[LoggeRythm] navigation persistence failed');
            });
          }}
        >
          <RootStack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.backgroundElevated }, headerTintColor: colors.textPrimary }}>
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
  profileButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    borderRadius: metrics.minimumTouchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  profileAvatar: { width: '100%', height: '100%' },
  profileInitial: { color: colors.textPrimary, fontSize: 17, fontWeight: '900' },
  invalidLink: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: colors.background,
  },
  invalidLinkTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  invalidLinkBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  invalidLinkButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    borderRadius: 24,
    paddingHorizontal: 22,
    backgroundColor: colors.accent,
  },
  invalidLinkButtonText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  logoutButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  logout: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  errorBanner: {
    position: 'absolute',
    left: 8,
    right: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceElevated,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 3,
    elevation: 8,
  },
  errorText: { color: colors.danger, fontSize: 12, flex: 1 },
  dismissButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  dismiss: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  tabIcon: { fontSize: 18, fontWeight: '700' },
  startupState: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: 28,
    gap: 14,
  },
  startupTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  startupStatus: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  startupError: { color: colors.danger, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: {
    minHeight: metrics.minimumTouchTarget,
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  retryText: { color: colors.onAccent, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
