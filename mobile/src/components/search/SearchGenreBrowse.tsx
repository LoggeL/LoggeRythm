import React from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
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
  /** Optional 16:9 Android TV layout overrides. */
  columns?: number;
  tileHeight?: number;
  paddingHorizontal?: number;
  gap?: number;
  titleStyle?: TextStyle;
  onTileFocus?: (focusKey: string) => void;
  tvMode?: boolean;
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
  columns,
  tileHeight,
  paddingHorizontal,
  gap,
  titleStyle,
  onTileFocus,
  tvMode = false,
}: SearchGenreBrowseProps) {
  const title = strings.search.browseTitle;
  return (
    <View testID={testID} style={styles.browse}>
      <SectionHeader
        title={title}
        style={paddingHorizontal === undefined ? undefined : { paddingHorizontal }}
      />
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
        tvMode={tvMode}
        loadingFallback={(props) => (
          <GenreTileGridSkeleton
            {...props}
            columns={columns}
            tileHeight={tileHeight}
            paddingHorizontal={paddingHorizontal}
            gap={gap}
          />
        )}
      >
        <GenreTileGrid
          genres={genres}
          columns={columns}
          tileHeight={tileHeight}
          paddingHorizontal={paddingHorizontal}
          gap={gap}
          titleStyle={titleStyle}
          onTileFocus={onTileFocus}
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
