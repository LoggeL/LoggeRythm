import React from 'react';
import { StyleSheet, View } from 'react-native';
import { resolveServerUrl } from '../../api/url';
import type { OfflinePlaylistBrowseSummary } from '../../offline/browse';
import type { LibraryPlaylistRouteParams } from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import type { AccountOfflineAvailability } from '../../screens/offlineScreenModel';
import { colors, layout } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, Artwork, EmptyState, TrackRowSkeleton } from '../ui';
import { InlineNotice } from './InlineNotice';
import { LibraryRow } from './LibraryRows';

export interface LibraryDownloadsListProps {
  availability: AccountOfflineAvailability;
  playlists: readonly OfflinePlaylistBrowseSummary[];
  apiBase: string;
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
}

/** Account-filtered local collection rendered inside the fixed Downloads section. */
export function LibraryDownloadsList({
  availability,
  playlists,
  apiBase,
  onOpenPlaylist,
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
  if (playlists.length === 0) {
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
    </View>
  );
}

const styles = StyleSheet.create({
  gutter: { marginHorizontal: layout.pagePadding },
});
