import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import MiniPlayer from '../components/MiniPlayer';
import { ActionButton } from '../components/ui/ActionButton';
import { AppText } from '../components/ui/AppText';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import { navigateToSearch } from '../navigationActions';
import { playlistIdFromRouteValue, safeRouteLabel } from '../navigationLinks';
import AlbumScreen from '../screens/AlbumScreen';
import ArtistScreen from '../screens/ArtistScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import GenreScreen from '../screens/GenreScreen';
import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import type { LibraryPlaylistRouteParams } from '../screens/libraryModel';
import MixScreen from '../screens/MixScreen';
import NowPlayingScreen from '../screens/NowPlayingScreen';
import PlaylistScreen from '../screens/PlaylistScreen';
import ProfileScreen from '../screens/ProfileScreen';
import QueueScreen from '../screens/QueueScreen';
import RadarScreen from '../screens/RadarScreen';
import RadioScreen from '../screens/RadioScreen';
import SearchScreen from '../screens/SearchScreen';
import { spotifySharedTextCoordinator } from '../share/sharedTextRuntime';
import { colors, spacing } from '../theme';
import { PlayerErrorBanner, PlayerNoticeWithoutMiniPlayer } from './playerOverlays';
import { rootNavigation } from './rootNavigation';
import type { RootStackParams, SectionStackParams } from './types';
import { useApprovedAccountScope } from './useApprovedAccountScope';

/**
 * Route wrappers: the only place that knows both React Navigation and the
 * screens. Each wrapper subscribes to the locale and translates navigation
 * props into the screen's plain `onOpenX` callbacks, so screens stay free of
 * navigation types and are testable as plain functions.
 */
type SectionProps<Name extends keyof SectionStackParams> = NativeStackScreenProps<
  SectionStackParams,
  Name
>;

export function HomeRoute({ navigation }: SectionProps<'Home'>) {
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
      onOpenSearch={() => navigateToSearch(rootNavigation)}
    />
  );
}

export function SearchRoute({ navigation }: SectionProps<'Search'>) {
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

export function DiscoverRoute({ navigation }: SectionProps<'Discover'>) {
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

export function RadioRoute() {
  useLocaleRevision();
  return <RadioScreen />;
}

export function LibraryRoute({ navigation }: SectionProps<'Library'>) {
  useLocaleRevision();
  return (
    <LibraryScreen
      onOpenPlaylist={(params) => navigation.push('Playlist', params)}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

export function AlbumRoute({ route, navigation }: SectionProps<'Album'>) {
  useLocaleRevision();
  return (
    <AlbumScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

export function MixRoute({ route, navigation }: SectionProps<'Mix'>) {
  useLocaleRevision();
  return (
    <MixScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

export function RadarRoute({ navigation }: SectionProps<'Radar'>) {
  useLocaleRevision();
  return (
    <RadarScreen
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

export function GenreRoute({ route, navigation }: SectionProps<'Genre'>) {
  useLocaleRevision();
  return (
    <GenreScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
    />
  );
}

export function ArtistRoute({ route, navigation }: SectionProps<'Artist'>) {
  useLocaleRevision();
  return (
    <ArtistScreen
      {...route.params}
      onOpenAlbum={(params) => navigation.push('Album', params)}
      onOpenArtist={(params) => navigation.push('Artist', params)}
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
  useLocaleRevision();
  const params = normalizedPlaylistParams(route.params);
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
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else rootNavigation.navigate('Tabs', { screen: 'HomeTab', params: { screen: 'Home' } });
          }}
        />
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
