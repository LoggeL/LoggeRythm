import React from 'react';
import { StyleSheet, View } from 'react-native';
import { artistLikedTracksExpandable } from '../../screens/artistTrackListModel';
import { catalogStrings } from '../../screens/catalogStrings';
import { layout } from '../../theme';
import { SectionHeader } from '../ui';
import { CatalogQueryBoundary } from './CatalogStates';
import { catalogQueryFlags, type CatalogQueryFlags } from './catalogQueryState';

export interface ArtistLikedTracksHeaderProps {
  artistName: string;
  /** The account's likes query: the block's only source, optimistic updates included. */
  likes: CatalogQueryFlags & { data: unknown; refetch: () => unknown };
  /** How many liked tracks credit this artist, listed or not. */
  trackCount: number;
  expanded: boolean;
  onToggleExpanded: () => void;
}

/**
 * Heading, "show all" link and remote state of the Artist page's "your liked
 * songs" block. The rows themselves are list items of the page's SectionList.
 *
 * The page mounts this only while the block exists (`artistLikedSectionVisible`):
 * with liked tracks to list, or when the likes could not be loaded at all,
 * which is reported here with a retry instead of the block silently missing.
 */
export function ArtistLikedTracksHeader({
  artistName,
  likes,
  trackCount,
  expanded,
  onToggleExpanded,
}: ArtistLikedTracksHeaderProps) {
  const title = catalogStrings.artist.likedTracks;
  return (
    <View testID="artist-liked-tracks" style={styles.section}>
      <SectionHeader
        title={title}
        subtitle={catalogStrings.artist.likedTracksBy(artistName)}
        onShowAll={artistLikedTracksExpandable(trackCount) ? onToggleExpanded : undefined}
        showAllLabel={expanded ? catalogStrings.artist.showFewerLikedTracks : undefined}
        showAllAccessibilityLabel={
          expanded
            ? catalogStrings.artist.showFewerLikedTracksOf(artistName)
            : catalogStrings.artist.showAllLikedTracks(artistName, trackCount)
        }
        showAllTestID="artist-liked-tracks-toggle"
      />
      <CatalogQueryBoundary
        id="artist-liked-tracks-state"
        hasData={likes.data !== undefined}
        empty={false}
        {...catalogQueryFlags(likes)}
        loadingLabel={catalogStrings.common.sectionLoading(title)}
        emptyLabel={catalogStrings.common.sectionEmpty(title)}
        errorLabel={catalogStrings.artist.likedTracksFailed}
        retryLabel={catalogStrings.common.retrySection(title)}
        onRetry={() => void likes.refetch()}
        skeleton="rows"
        refreshIndicator={false}
      >
        <View testID="artist-liked-track-list" />
      </CatalogQueryBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap },
});
