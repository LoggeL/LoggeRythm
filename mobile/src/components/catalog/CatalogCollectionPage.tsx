import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { colors, layout, spacing } from '../../theme';
import { SectionHeader } from '../ui';
import { CatalogTrackList } from './CatalogTrackList';

export interface CatalogCollectionPageProps {
  /**
   * Page prefix. Yields the `${id}-screen`, `${id}-scroll`, `${id}-refresh`
   * and `${id}-track-list` testIDs.
   */
  id: string;
  tracks: readonly Track[];
  /** The `CatalogDetailHero` of the page. */
  hero: React.ReactElement;
  /** Runtime errors and the cached-content notice, between hero and tracks. */
  status?: React.ReactNode;
  /** Heading above the rows. Without it the track-list marker only exists while there are rows. */
  trackListTitle?: string;
  /** Shown instead of rows for a successful empty collection. */
  empty: React.ReactElement | null;
  refreshing: boolean;
  refreshAccessibilityLabel: string;
  onRefresh: () => void;
  renderTrack: (track: Track, index: number) => React.ReactElement;
}

/**
 * The scaffold of a single-collection detail page (album, mix, release
 * radar): one pull-to-refresh list whose header is hero → status → track
 * heading. Screens supply data and copy; spacing, scroll ownership and the
 * mini-player inset live here once.
 */
export function CatalogCollectionPage({
  id,
  tracks,
  hero,
  status,
  trackListTitle,
  empty,
  refreshing,
  refreshAccessibilityLabel,
  onRefresh,
  renderTrack,
}: CatalogCollectionPageProps) {
  return (
    <View testID={`${id}-screen`} style={styles.screen}>
      <CatalogTrackList
        id={id}
        tracks={tracks}
        refreshing={refreshing}
        refreshAccessibilityLabel={refreshAccessibilityLabel}
        onRefresh={onRefresh}
        header={
          <View style={styles.header}>
            <View style={styles.lead}>
              {hero}
              {status}
            </View>
            {trackListTitle !== undefined ? (
              <View testID={`${id}-track-list`} style={styles.trackHeading}>
                <SectionHeader title={trackListTitle} />
              </View>
            ) : tracks.length > 0 ? (
              <View testID={`${id}-track-list`} />
            ) : null}
          </View>
        }
        empty={empty}
        renderTrack={renderTrack}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  lead: { gap: layout.stackGap },
  trackHeading: { paddingTop: layout.sectionGap - spacing.sm },
});
