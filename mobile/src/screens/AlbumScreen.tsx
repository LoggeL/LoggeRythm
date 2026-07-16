import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  CatalogActionButton,
  CatalogHeroArtwork,
  CatalogTrackRow,
} from '../components/catalog/CatalogCards';
import { CatalogTrackList } from '../components/catalog/CatalogTrackList';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogRuntimeError,
} from '../components/catalog/CatalogStates';
import { showTrackActions } from '../components/trackActions';
import { musicQueries } from '../data';
import { playTracks } from '../player/controller';
import { colors, metrics } from '../theme';
import {
  albumHasContent,
  albumRuntimeMinutes,
  assertAlbumScreenContract,
  catalogTestIdSegment,
  playbackSelection,
  releaseYear,
  requireCatalogId,
  trackContextKey,
  type AlbumScreenContract,
} from './catalogModel';
import { catalogFailureMessage } from './catalogFeedback';
import { catalogStrings } from './catalogStrings';

export type AlbumScreenProps = AlbumScreenContract;
export type { AlbumRouteParams, ArtistRouteParams } from './catalogModel';

export default function AlbumScreen(props: AlbumScreenProps) {
  assertAlbumScreenContract(props);
  const albumId = requireCatalogId(props.albumId, 'album id');
  const album = useQuery(musicQueries.album(albumId));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const gate = (
    <CatalogPageGate
      id="album"
      hasData={album.data !== undefined}
      isPending={album.isPending}
      isFetching={album.isFetching}
      isStale={album.isStale}
      fetchStatus={album.fetchStatus}
      error={album.error}
      loadingLabel={catalogStrings.album.loading}
      onRetry={() => void album.refetch()}
    />
  );
  if (album.data === undefined) return gate;

  const detail = album.data;
  const year = releaseYear(detail.release_date);
  const runtimeMinutes = albumRuntimeMinutes(detail.tracks);
  const artistId = String(detail.artist_id).trim();

  const play = (index: number) => {
    let selected: ReturnType<typeof playbackSelection>;
    try {
      selected = playbackSelection(detail.tracks, index);
    } catch (error) {
      setRuntimeError(catalogFailureMessage('playback', error));
      return;
    }
    setRuntimeError(null);
    void playTracks(selected.tracks, selected.startIndex, {
      context: { type: 'album', id: albumId, label: detail.title },
    }).catch((error) =>
      setRuntimeError(catalogFailureMessage('playback', error)),
    );
  };

  return (
    <View testID="album-screen" style={styles.container}>
      <CatalogTrackList
        id="album"
        tracks={detail.tracks}
        refreshing={album.isFetching && !album.isPending}
        refreshAccessibilityLabel={catalogStrings.common.refreshing}
        onRefresh={() => void album.refetch()}
        header={
          <View style={styles.headerContent}>
            <View style={styles.hero}>
              <CatalogHeroArtwork uri={detail.cover} />
              <View style={styles.heroMeta}>
                <Text style={styles.eyebrow}>{catalogStrings.album.typeLabel}</Text>
                <Text testID="album-title" accessibilityRole="header" style={styles.title}>
                  {detail.title}
                </Text>
                {artistId.length > 0 ? (
                  <Pressable
                    testID={`album-artist-${catalogTestIdSegment(artistId)}`}
                    accessibilityRole="button"
                    accessibilityLabel={catalogStrings.common.openArtist(detail.artist)}
                    onPress={() => props.onOpenArtist({ artistId, name: detail.artist })}
                    style={({ pressed }) => [styles.artistButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.artist}>{catalogStrings.album.byArtist(detail.artist)}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.artist}>{catalogStrings.album.byArtist(detail.artist)}</Text>
                )}
                <View style={styles.metaLine}>
                  {year ? <Text style={styles.meta}>{catalogStrings.common.releaseYear(year)}</Text> : null}
                  <Text style={styles.meta}>{catalogStrings.common.tracks(detail.nb_tracks)}</Text>
                  {runtimeMinutes !== null ? (
                    <Text testID="album-runtime" style={styles.meta}>
                      {catalogStrings.album.runtime(runtimeMinutes)}
                    </Text>
                  ) : null}
                </View>
                <CatalogActionButton
                  testID="album-play-all"
                  label={catalogStrings.common.playAll}
                  disabled={detail.tracks.length === 0}
                  onPress={() => play(0)}
                />
              </View>
            </View>

            <CatalogRuntimeError id="album" message={runtimeError} />
            <CatalogContentStatus
              id="album"
              hasData
              isPending={album.isPending}
              isFetching={album.isFetching}
              isStale={album.isStale}
              fetchStatus={album.fetchStatus}
              error={album.error}
              onRetry={() => void album.refetch()}
            />

            <View testID="album-track-list" style={styles.trackSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                {catalogStrings.album.tracks}
              </Text>
            </View>
          </View>
        }
        empty={
          !albumHasContent(detail) ? (
            <Text testID="album-empty" style={styles.empty}>{catalogStrings.album.empty}</Text>
          ) : null
        }
        renderTrack={(track, index) => (
          <CatalogTrackRow
            track={track}
            index={index}
            testID={`album-track-${trackContextKey(track, index)}`}
            occurrence={{
              queueContext: { type: 'album', id: albumId },
              originalContextOrder: index,
            }}
            onPress={() => play(index)}
            onLongPress={() => showTrackActions(track, setRuntimeError)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerContent: { gap: 22, paddingTop: 22 },
  hero: {
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 20,
  },
  heroMeta: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  eyebrow: { color: colors.accentSoft, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: '900', textAlign: 'center' },
  artistButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  artist: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  metaLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  meta: { color: colors.textSecondary, fontSize: 13 },
  trackSection: { gap: 4, paddingBottom: 4 },
  sectionTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', paddingHorizontal: 16, marginBottom: 4 },
  empty: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, paddingHorizontal: 16 },
  pressed: { opacity: 0.72 },
});
