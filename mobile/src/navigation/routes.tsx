import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import MiniPlayer from '../components/MiniPlayer';
import { ActionButton } from '../components/ui/ActionButton';
import { AppText } from '../components/ui/AppText';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { navigateToSearch } from '../navigationActions';
import { playlistIdFromRouteValue, safeRouteLabel } from '../navigationLinks';
import AlbumScreen from '../screens/AlbumScreen';
import ArtistScreen from '../screens/ArtistScreen';
import type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
} from '../screens/catalogModel';
import DiscoverScreen from '../screens/DiscoverScreen';
import GenreScreen from '../screens/GenreScreen';
import type { HomeMixRouteParams } from '../screens/homeModel';
import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import type { LibraryPlaylistRouteParams } from '../screens/libraryModel';
import MixScreen from '../screens/MixScreen';
import NowPlayingScreen from '../screens/NowPlayingScreen';
import PartyScreen, { InvalidPartyLink } from '../screens/PartyScreen';
import { normalizePartyCode } from '../party/partyCode';
import PlaylistScreen from '../screens/PlaylistScreen';
import ProfileScreen from '../screens/ProfileScreen';
import InsightsScreen from '../screens/InsightsScreen';
import QueueScreen from '../screens/QueueScreen';
import RadarScreen from '../screens/RadarScreen';
import RadioScreen from '../screens/RadioScreen';
import SearchScreen from '../screens/SearchScreen';
import UserProfileScreen, { type UserProfileRouteParams } from '../screens/UserProfileScreen';
import { spotifySharedTextCoordinator } from '../share/sharedTextRuntime';
import { colors, spacing } from '../theme';
import { PlayerErrorBanner, PlayerNoticeWithoutMiniPlayer } from './playerOverlays';
import { rootNavigation } from './rootNavigation';
import type { RootStackParams, SectionStackParams } from './types';
import { useApprovedAccountScope } from './useApprovedAccountScope';

/**
 * Route wrappers: the only place that knows both React Navigation and the
 * screens. Each wrapper subscribes to the locale and translates navigation
 * props into memoized plain `onOpenX` callbacks, so screens stay free of
 * navigation types, avoid prop-identity churn, and are testable as plain functions.
 */
type SectionProps<Name extends keyof SectionStackParams> = NativeStackScreenProps<
  SectionStackParams,
  Name
>;

function useSectionCallbacks<Name extends keyof SectionStackParams>(
  navigation: NativeStackNavigationProp<SectionStackParams, Name>,
) {
  const onOpenAlbum = useCallback(
    (params: AlbumRouteParams) => navigation.push('Album', params),
    [navigation],
  );
  const onOpenArtist = useCallback(
    (params: ArtistRouteParams) => navigation.push('Artist', params),
    [navigation],
  );
  const onOpenGenre = useCallback(
    (params: GenreRouteParams) => navigation.push('Genre', params),
    [navigation],
  );
  const onOpenPlaylist = useCallback(
    (params: LibraryPlaylistRouteParams) => navigation.push('Playlist', params),
    [navigation],
  );
  const onOpenSummaryPlaylist = useCallback(
    (params: { playlistId: number; name: string }) =>
      navigation.push('Playlist', { kind: 'playlist', ...params }),
    [navigation],
  );
  const onOpenMix = useCallback(
    (params: HomeMixRouteParams) => navigation.push('Mix', params),
    [navigation],
  );
  const onOpenRadar = useCallback(
    () => navigation.push('Radar'),
    [navigation],
  );
  const onOpenSearch = useCallback(
    () => navigateToSearch(rootNavigation),
    [],
  );
  const onOpenUser = useCallback(
    (params: UserProfileRouteParams) => navigation.push('UserProfile', params),
    [navigation],
  );
  const onDeleted = useCallback(
    () => navigation.goBack(),
    [navigation],
  );
  return {
    onOpenAlbum,
    onOpenArtist,
    onOpenGenre,
    onOpenPlaylist,
    onOpenSummaryPlaylist,
    onOpenMix,
    onOpenRadar,
    onOpenSearch,
    onOpenUser,
    onDeleted,
  };
}

export function HomeRoute({ navigation }: SectionProps<'Home'>) {
  useLocaleRevision();
  const {
    onOpenAlbum,
    onOpenArtist,
    onOpenGenre,
    onOpenSummaryPlaylist,
    onOpenMix,
    onOpenRadar,
    onOpenSearch,
  } = useSectionCallbacks(navigation);
  return (
    <HomeScreen
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      onOpenGenre={onOpenGenre}
      onOpenPlaylist={onOpenSummaryPlaylist}
      onOpenMix={onOpenMix}
      onOpenRadar={onOpenRadar}
      onOpenSearch={onOpenSearch}
    />
  );
}

export function SearchRoute({ navigation }: SectionProps<'Search'>) {
  useLocaleRevision();
  const accountScope = useApprovedAccountScope();
  const focused = useIsFocused();
  const { onOpenAlbum, onOpenArtist, onOpenGenre } = useSectionCallbacks(navigation);

  useEffect(() => {
    if (!focused) return undefined;
    return spotifySharedTextCoordinator.attachSearchOwner(accountScope);
  }, [accountScope, focused]);

  return (
    <SearchScreen
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      onOpenGenre={onOpenGenre}
    />
  );
}

export function DiscoverRoute({ navigation }: SectionProps<'Discover'>) {
  useLocaleRevision();
  const {
    onOpenAlbum,
    onOpenArtist,
    onOpenGenre,
    onOpenSummaryPlaylist,
  } = useSectionCallbacks(navigation);
  return (
    <DiscoverScreen
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      onOpenGenre={onOpenGenre}
      onOpenPlaylist={onOpenSummaryPlaylist}
    />
  );
}

export function RadioRoute() {
  useLocaleRevision();
  return <RadioScreen />;
}

export function LibraryRoute({ navigation }: SectionProps<'Library'>) {
  useLocaleRevision();
  const { onOpenPlaylist, onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <LibraryScreen
      onOpenPlaylist={onOpenPlaylist}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function AlbumRoute({ route, navigation }: SectionProps<'Album'>) {
  useLocaleRevision();
  const { onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <AlbumScreen
      {...route.params}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function MixRoute({ route, navigation }: SectionProps<'Mix'>) {
  useLocaleRevision();
  const { onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <MixScreen
      {...route.params}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function RadarRoute({ navigation }: SectionProps<'Radar'>) {
  useLocaleRevision();
  const { onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <RadarScreen
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function GenreRoute({ route, navigation }: SectionProps<'Genre'>) {
  useLocaleRevision();
  const { onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <GenreScreen
      {...route.params}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function ArtistRoute({ route, navigation }: SectionProps<'Artist'>) {
  useLocaleRevision();
  const { onOpenAlbum, onOpenArtist } = useSectionCallbacks(navigation);
  return (
    <ArtistScreen
      {...route.params}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

/** Deep links and restored state are untrusted: accept only a well-formed playlist route. */
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

export function PlaylistRoute({ route, navigation }: SectionProps<'Playlist'>) {
  const localeRevision = useLocaleRevision();
  const { onOpenAlbum, onOpenArtist, onOpenUser, onDeleted } = useSectionCallbacks(navigation);
  const params = useMemo(
    () => normalizedPlaylistParams(route.params),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback labels follow locale
    [route.params, localeRevision],
  );
  const handleInvalidBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
  }, [navigation]);

  if (params === null) {
    return (
      <View testID="invalid-content-link" style={styles.invalidLink}>
        <AppText variant="title" align="center" accessibilityRole="header">
          {strings.navigation.invalidLinkTitle}
        </AppText>
        <AppText color="secondary" align="center" accessibilityRole="alert">
          {strings.navigation.invalidLinkBody}
        </AppText>
        <ActionButton
          testID="invalid-content-link-back"
          label={strings.navigation.invalidLinkBack}
          onPress={handleInvalidBack}
        />
      </View>
    );
  }
  return (
    <PlaylistScreen
      {...params}
      onDeleted={onDeleted}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      onOpenUser={onOpenUser}
    />
  );
}

export function UserProfileRoute({ route, navigation }: SectionProps<'UserProfile'>) {
  useLocaleRevision();
  const { onOpenPlaylist, onOpenArtist } = useSectionCallbacks(navigation);
  const userId = playlistIdFromRouteValue(route.params?.userId);
  const handleInvalidBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
  }, [navigation]);

  if (userId === null) {
    return (
      <View testID="invalid-content-link" style={styles.invalidLink}>
        <AppText variant="title" align="center" accessibilityRole="header">
          {strings.navigation.invalidLinkTitle}
        </AppText>
        <AppText color="secondary" align="center" accessibilityRole="alert">
          {strings.navigation.invalidLinkBody}
        </AppText>
        <ActionButton
          testID="invalid-content-link-back"
          label={strings.navigation.invalidLinkBack}
          onPress={handleInvalidBack}
        />
      </View>
    );
  }

  return (
    <UserProfileScreen
      userId={userId}
      name={safeRouteLabel(route.params?.name, strings.profile.publicProfileTitle)}
      onOpenPlaylist={onOpenPlaylist}
      onOpenArtist={onOpenArtist}
    />
  );
}

export function ProfileRoute() {
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

export function InsightsRoute() {
  useLocaleRevision();
  const onOpenArtist = useCallback((params: ArtistRouteParams) => {
    rootNavigation.navigate('Tabs', {
      screen: 'HomeTab',
      params: { screen: 'Artist', params },
    });
  }, []);
  const onOpenAlbum = useCallback((params: AlbumRouteParams) => {
    rootNavigation.navigate('Tabs', {
      screen: 'HomeTab',
      params: { screen: 'Album', params },
    });
  }, []);
  return (
    <View style={styles.fill}>
      <InsightsScreen onOpenArtist={onOpenArtist} onOpenAlbum={onOpenAlbum} />
      <PlayerErrorBanner hasTabBar={false} />
      <PlayerNoticeWithoutMiniPlayer hasTabBar={false} />
      <MiniPlayer hasTabBar={false} />
    </View>
  );
}

export function NowPlayingRoute(
  props: NativeStackScreenProps<RootStackParams, 'NowPlaying'>,
) {
  useLocaleRevision();
  return <NowPlayingScreen {...props} />;
}

export function QueueRoute(props: NativeStackScreenProps<RootStackParams, 'Queue'>) {
  useLocaleRevision();
  return <QueueScreen {...props} />;
}

/** Launcher shortcut (`loggerythm://party/start`): opens active Jam or starts a fresh one. */
export function PartyStartRoute({
  navigation,
}: NativeStackScreenProps<RootStackParams, 'PartyStart'>) {
  useLocaleRevision();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
  }, [navigation]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ partySession, startPartyFromQueue }, { partyErrorDetail }] = await Promise.all([
        import('../party/partyRuntime'),
        import('../party/partyErrors'),
      ]);
      try {
        const existingCode = partySession().getSnapshot().code;
        if (existingCode !== null) {
          if (active) navigation.replace('Party', { code: existingCode });
          return;
        }
        const created = await startPartyFromQueue();
        if (active) navigation.replace('Party', { code: created.code });
      } catch (cause) {
        if (active) setError(strings.party.startPartyFailed(partyErrorDetail(cause)));
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, navigation]);

  if (error !== null) {
    return (
      <View testID="party-start-error" style={styles.invalidLink}>
        <AppText variant="section" align="center">{strings.party.defaultName}</AppText>
        <AppText variant="callout" color="danger" align="center">{error}</AppText>
        <ActionButton
          testID="party-start-retry"
          label={strings.common.retry}
          onPress={() => {
            setError(null);
            setAttempt((count) => count + 1);
          }}
        />
        <ActionButton
          testID="party-start-close"
          variant="secondary"
          label={strings.party.back}
          onPress={close}
        />
      </View>
    );
  }

  return (
    <View testID="party-start-loading" style={styles.invalidLink}>
      <ActivityIndicator color={colors.accent} size="large" />
      <AppText variant="callout" color="secondary" align="center">
        {strings.party.startingParty}
      </AppText>
    </View>
  );
}

/** Party links are untrusted: only a well-formed code opens (and joins) a party. */
export function PartyRoute({ route, navigation }: NativeStackScreenProps<RootStackParams, 'Party'>) {
  useLocaleRevision();
  const code = normalizePartyCode(route.params?.code);
  const close = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
  }, [navigation]);
  if (code === null) return <InvalidPartyLink onClose={close} />;
  return (
    <View style={styles.fill}>
      <PartyScreen code={code} onClose={close} />
      <PlayerErrorBanner hasTabBar={false} />
      <PlayerNoticeWithoutMiniPlayer hasTabBar={false} />
      <MiniPlayer hasTabBar={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  invalidLink: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
});
