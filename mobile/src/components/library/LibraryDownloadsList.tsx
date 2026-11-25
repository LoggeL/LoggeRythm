import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import type { OfflinePlaylistBrowseSummary } from '../../offline/browse';
import {
  libraryTestIdSegment,
  type LibraryAlbumRouteParams,
  type LibraryArtistRouteParams,
  type LibraryPlaylistRouteParams,
} from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import type { AccountOfflineAvailability } from '../../screens/offlineScreenModel';
import { colors, layout, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import StandardTrackRow from '../track/StandardTrackRow';
import { AppText, Artwork, EmptyState, TrackRowSkeleton } from '../ui';
import { InlineNotice } from './InlineNotice';
import { LibraryRow } from './LibraryRows';

export interface LibraryDownloadsListProps {
  availability: AccountOfflineAvailability;
  playlists: readonly OfflinePlaylistBrowseSummary[];
  /** Verified downloaded tracks for this account (single-track, album, or liked downloads). */
  tracks?: readonly Track[];
  apiBase: string;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
  onPlayTrack?: (tracks: readonly Track[], index: number) => void;
  onOpenTrackActions?: (track: Track) => void;
  onOpenAlbum?: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist?: (params: LibraryArtistRouteParams) => void;
}

/** Account-filtered local collection rendered inside the fixed Downloads section. */
export function LibraryDownloadsList({
  availability,
  playlists,
  tracks = [],
  apiBase,
  onOpenPlaylist,
  onPlayTrack,
  onOpenTrackActions,
  onOpenAlbum,
  onOpenArtist,
}: LibraryDownloadsListProps) {
  if (availability === 'loading') {
    return (
      <TrackRowSkeleton
        testID="library-downloads-loading"
        accessibilityLabel={libraryStrings.library.downloadsLoading}
        count={2}
      />
    );
  }
  if (availability === 'unavailable') {
    return (
      <InlineNotice
        testID="library-downloads-unavailable"
        tone="neutral"
        title={libraryStrings.library.downloadsUnavailable}
        message={libraryStrings.library.downloadsUnavailableBody}
        style={styles.gutter}
      />
    );
  }
  if (playlists.length === 0 && tracks.length === 0) {
    return (
      <EmptyState
        testID="library-downloads-empty"
        icon="download-circle-outline"
        title={libraryStrings.library.noDownloads}
        message={libraryStrings.library.noDownloadsBody}
      />
    );
  }

  return (
    <View testID="library-downloads-list">
      {playlists.map((playlist) => {
        const downloaded = playlist.offline.downloadedOccurrences;
        const total = playlist.offline.totalOccurrences;
        const partial = playlist.offline.status !== 'complete';
        return (
          <LibraryRow
            key={playlist.id}
            testID={`library-download-${playlist.id}`}
            accessibilityLabel={libraryStrings.library.openDownload(
              playlist.name,
              downloaded,
              total,
            )}
            onPress={() => onOpenPlaylist({
              kind: 'playlist',
              playlistId: playlist.id,
              name: playlist.name,
            })}
            artwork={
              <Artwork
                uri={playlist.cover_url === null
                  ? null
                  : resolveServerUrl(playlist.cover_url, apiBase)}
                size={layout.artwork.md}
                icon="playlist-music"
              />
            }
            title={playlist.name}
            subtitle={
              <AppText
                testID={`library-download-${playlist.id}-status`}
                accessibilityLiveRegion="polite"
                variant="callout"
                color={partial ? 'warning' : 'secondary'}
                numberOfLines={2}
              >
                {partial
                  ? libraryStrings.library.partialDownload(
                      downloaded,
                      total,
                      playlist.offline.failedOccurrences,
                    )
                  : libraryStrings.library.downloadedPlaylist(downloaded, total)}
              </AppText>
            }
            trailing={
              <AppIcon
                name={partial ? 'alert-circle-outline' : 'check-circle'}
                color={partial ? colors.warning : colors.success}
                size={22}
              />
            }
          />
        );
      })}
      {tracks.length > 0 && onPlayTrack !== undefined ? (
        <View testID="library-downloads-songs" style={styles.songsSection}>
          <View style={styles.songsHeader}>
            <AppText variant="overline" color="muted">
              {libraryStrings.library.downloadedSongs}
            </AppText>
            <AppText variant="caption" color="muted">
              {libraryStrings.library.downloadedSongsCount(tracks.length)}
            </AppText>
          </View>
          {tracks.map((track, index) => (
            <StandardTrackRow
              key={`dl-track-${track.id}-${index}`}
              track={track}
              testID={`library-download-track-${libraryTestIdSegment(track.id)}-${index}`}
              onPlay={() => onPlayTrack(tracks, index)}
              onActions={onOpenTrackActions ? () => onOpenTrackActions(track) : undefined}
              onOpenAlbum={onOpenAlbum ?? (() => undefined)}
              onOpenArtist={onOpenArtist ?? (() => undefined)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gutter: { marginHorizontal: layout.pagePadding },
  songsSection: { marginTop: spacing.md, gap: spacing.xs },
  songsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.pagePadding,
  },
});
