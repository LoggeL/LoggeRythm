import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Genre } from '../../api/types';
import type { RemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import type { SearchGenreRouteParams } from '../../screens/searchModel';
import { layout, spacing } from '../../theme';
import { SectionHeader } from '../ui';
import { GenreTileGrid, GenreTileGridSkeleton } from './GenreTiles';
import { SearchRemoteBoundary } from './SearchRemoteStates';

interface SearchGenreBrowseProps {
  /** Container anchor (`search-genre-browse`), owned by the screen. */
  testID: string;
  /** State-id prefix (`search-genres` → `-loading`, `-error`, `-empty` ...). */
  id: string;
  genres: readonly Genre[];
  genresState: RemoteVisualState;
  retryBusy: boolean;
  onRetry: () => void;
  onOpenGenre: (params: SearchGenreRouteParams) => void;
}

/** The idle search state: a grid of genre tiles to browse before typing. */
export function SearchGenreBrowse({
  testID,
  id,
  genres,
  genresState,
  retryBusy,
  onRetry,
  onOpenGenre,
}: SearchGenreBrowseProps) {
  const title = strings.search.browseTitle;
  return (
    <View testID={testID} style={styles.browse}>
      <SectionHeader title={title} />
      <SearchRemoteBoundary
        id={id}
        state={genresState}
        loadingLabel={strings.search.browseLoading}
        emptyLabel={strings.search.browsePrompt}
        offlineLabel={strings.search.remoteOffline(title)}
        errorLabel={strings.search.remoteLoadFailed(title)}
        cachedOfflineLabel={strings.search.remoteCachedOffline(title)}
        cachedErrorLabel={strings.search.remoteCachedRefreshFailed(title)}
        refreshingLabel={strings.search.remoteRefreshing(title)}
        staleLabel={strings.search.remoteStale(title)}
        retryLabel={strings.search.retrySection(title)}
        retryBusy={retryBusy}
        onRetry={onRetry}
        loadingFallback={(props) => <GenreTileGridSkeleton {...props} />}
      >
        <GenreTileGrid
          genres={genres}
          tileTestID={(genre) => `search-genre-${genre.id}`}
          tileAccessibilityLabel={(genre) => strings.search.openGenre(genre.name)}
          onOpenGenre={(genre) => onOpenGenre({ genreId: genre.id, name: genre.name })}
        />
      </SearchRemoteBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  browse: { gap: layout.headerGap, paddingTop: spacing.md },
});
