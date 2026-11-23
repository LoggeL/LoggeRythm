import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { colors, layout, spacing } from '../../theme';
import type { TvEnvironment } from '../../tv';
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
  /** Optional TV metrics; enables 16:9 side-by-side hero + tracklist split when `tv.isTv` is true. */
  tv?: TvEnvironment;
  /** Optional bottom inset for the TV hero pane so it clears TV MiniPlayer. */
  bottomInset?: number;
}

/**
 * The scaffold of a single-collection detail page (album, mix, release
 * radar): one pull-to-refresh list whose header is hero → status → track
 * heading on phones, or a 16:9 side-by-side split (hero left, tracklist right)
 * on Android TV. Screens supply data and copy; spacing, scroll ownership and
 * the mini-player inset live here once.
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
  tv,
  bottomInset,
}: CatalogCollectionPageProps) {
  const trackHeading =
    trackListTitle !== undefined ? (
      <View testID={`${id}-track-list`} style={styles.trackHeading}>
        <SectionHeader title={trackListTitle} />
      </View>
    ) : tracks.length > 0 ? (
      <View testID={`${id}-track-list`} />
    ) : null;

  if (tv?.isTv) {
    const leftWidth = Math.round(tv.contentWidth * tv.splitPrimaryRatio);
    return (
      <View
        testID={`${id}-screen`}
        style={[
          styles.screen,
          styles.tvSplit,
          { gap: tv.gridGap },
        ]}
      >
        <ScrollView
          testID={`${id}-tv-hero-pane`}
          showsVerticalScrollIndicator={false}
          style={{ width: leftWidth, flexGrow: 0, flexShrink: 0 }}
          contentContainerStyle={[
            styles.tvHeroPane,
            bottomInset !== undefined ? { paddingBottom: bottomInset } : null,
          ]}
        >
          {hero}
          {status}
        </ScrollView>
        <View testID={`${id}-tv-tracks-pane`} style={styles.tvTracksPane}>
          <CatalogTrackList
            id={id}
            tracks={tracks}
            refreshing={refreshing}
            refreshAccessibilityLabel={refreshAccessibilityLabel}
            onRefresh={onRefresh}
            header={trackHeading}
            empty={empty}
            renderTrack={renderTrack}
          />
        </View>
      </View>
    );
  }

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
            {trackHeading}
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
  tvSplit: { flexDirection: 'row', alignItems: 'stretch' },
  tvHeroPane: { gap: layout.stackGap, paddingBottom: spacing.xl },
  tvTracksPane: { flex: 1, minWidth: 0 },
});
