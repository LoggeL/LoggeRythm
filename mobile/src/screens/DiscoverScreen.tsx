import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import {
  CatalogAlbumCard,
  CatalogGenreCard,
  CatalogPlaylistCard,
  CatalogTrackCard,
  HorizontalCatalogRail,
} from '../components/catalog/CatalogCards';
import { CatalogRuntimeError, CatalogSection } from '../components/catalog/CatalogStates';
import { showTrackActions } from '../components/trackActions';
import { useAuth } from '../auth/AuthContext';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { playTracks } from '../player/controller';
import { colors } from '../theme';
import {
  assertDiscoverRouteCallbacks,
  catalogTestIdSegment,
  playbackSelection,
  trackContextKey,
  type DiscoverRouteCallbacks,
} from './catalogModel';
import { catalogFailureMessage } from './catalogFeedback';
import { catalogStrings } from './catalogStrings';

export type DiscoverScreenProps = DiscoverRouteCallbacks;
export type {
  AlbumRouteParams,
  ArtistRouteParams,
  GenreRouteParams,
  PublicPlaylistRouteParams,
} from './catalogModel';

export default function DiscoverScreen(props: DiscoverScreenProps) {
  assertDiscoverRouteCallbacks(props);
  const { onOpenAlbum, onOpenArtist, onOpenGenre, onOpenPlaylist } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('DiscoverScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const charts = useQuery(musicQueries.charts());
  const genres = useQuery(musicQueries.genres());
  const releases = useQuery(musicQueries.newReleases());
  const playlists = useQuery(musicQueries.publicPlaylists(scope));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const queries = [charts, genres, releases, playlists];
  const refreshing = queries.some((query) => query.isFetching && !query.isPending);

  const refresh = () => {
    void Promise.allSettled(queries.map((query) => query.refetch()));
  };

  const playContext = (tracks: Track[], index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: { type: 'chart', id: 'discover', label: catalogStrings.discover.charts },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  };

  return (
    <View testID="discover-screen" style={styles.container}>
      <ScrollView
        testID="discover-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            accessibilityLabel={catalogStrings.common.refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Text testID="discover-title" accessibilityRole="header" style={styles.title}>
            {catalogStrings.discover.title}
          </Text>
          <Text style={styles.subtitle}>{catalogStrings.discover.subtitle}</Text>
        </View>
        <CatalogRuntimeError id="discover" message={runtimeError} />

        <CatalogSection
          id="charts"
          title={catalogStrings.discover.charts}
          hasData={charts.data !== undefined}
          empty={(charts.data?.length ?? 0) === 0}
          isPending={charts.isPending}
          isFetching={charts.isFetching}
          isStale={charts.isStale}
          fetchStatus={charts.fetchStatus}
          error={charts.error}
          onRetry={() => void charts.refetch()}
        >
          <HorizontalCatalogRail
            id="discover-charts"
            data={charts.data ?? []}
            keyExtractor={(track, index) => `${track.id}:${index}`}
            renderItem={(track, index) => (
              <CatalogTrackCard
                track={track}
                rank={index + 1}
                testID={`discover-chart-${trackContextKey(track, index)}`}
                occurrence={{
                  queueContext: { type: 'chart', id: 'discover' },
                  originalContextOrder: index,
                }}
                onPress={() => playContext(charts.data ?? [], index)}
                onLongPress={() =>
                  showTrackActions(track, (message) => setRuntimeError(message))
                }
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
              />
            )}
          />
        </CatalogSection>

        <CatalogSection
          id="genres"
          title={catalogStrings.discover.genres}
          hasData={genres.data !== undefined}
          empty={(genres.data?.length ?? 0) === 0}
          isPending={genres.isPending}
          isFetching={genres.isFetching}
          isStale={genres.isStale}
          fetchStatus={genres.fetchStatus}
          error={genres.error}
          onRetry={() => void genres.refetch()}
        >
          <HorizontalCatalogRail
            id="discover-genres"
            data={genres.data ?? []}
            keyExtractor={(genre) => genre.id}
            renderItem={(genre) => (
              <CatalogGenreCard
                genre={genre}
                testID={`discover-genre-${catalogTestIdSegment(genre.id)}`}
                onPress={() => onOpenGenre({ genreId: genre.id, name: genre.name })}
              />
            )}
          />
        </CatalogSection>

        <CatalogSection
          id="new-releases"
          title={catalogStrings.discover.newReleases}
          hasData={releases.data !== undefined}
          empty={(releases.data?.length ?? 0) === 0}
          isPending={releases.isPending}
          isFetching={releases.isFetching}
          isStale={releases.isStale}
          fetchStatus={releases.fetchStatus}
          error={releases.error}
          onRetry={() => void releases.refetch()}
        >
          <HorizontalCatalogRail
            id="discover-new-releases"
            data={releases.data ?? []}
            keyExtractor={(album) => album.id}
            renderItem={(album) => (
              <CatalogAlbumCard
                album={album}
                testID={`discover-album-${catalogTestIdSegment(album.id)}`}
                onPress={() => onOpenAlbum({ albumId: album.id, title: album.title })}
              />
            )}
          />
        </CatalogSection>

        <CatalogSection
          id="community-playlists"
          title={catalogStrings.discover.communityPlaylists}
          hasData={playlists.data !== undefined}
          empty={(playlists.data?.length ?? 0) === 0}
          isPending={playlists.isPending}
          isFetching={playlists.isFetching}
          isStale={playlists.isStale}
          fetchStatus={playlists.fetchStatus}
          error={playlists.error}
          onRetry={() => void playlists.refetch()}
        >
          <HorizontalCatalogRail
            id="discover-community-playlists"
            data={playlists.data ?? []}
            keyExtractor={(playlist) => String(playlist.id)}
            renderItem={(playlist) => (
              <CatalogPlaylistCard
                playlist={playlist}
                coverUrl={
                  playlist.cover_url === null
                    ? null
                    : resolveServerUrl(playlist.cover_url, apiBase)
                }
                testID={`discover-playlist-${catalogTestIdSegment(playlist.id)}`}
                onPress={() => onOpenPlaylist({ playlistId: playlist.id, name: playlist.name })}
              />
            )}
          />
        </CatalogSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: 30, paddingTop: 24, paddingBottom: 144 },
  hero: { gap: 7, paddingHorizontal: 16 },
  title: { color: colors.textPrimary, fontSize: 32, lineHeight: 38, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, maxWidth: 420 },
});
