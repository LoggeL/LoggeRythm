import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { artistLikedTracksExpandable } from '../../screens/artistTrackListModel';
import { catalogStrings } from '../../screens/catalogStrings';
import { colors, layout, metrics, opacity, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import { createFocusRingController, FocusRingOverlay, SectionHeader } from '../ui';
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
 * Heading and remote state of the Artist page's "your liked songs" block. The
 * rows themselves are list items of the page's SectionList.
 *
 * The block starts collapsed: the whole heading is one expander row naming
 * how many liked songs credit the artist, so it does not repeat the Popular
 * list right below. Tapping it lists every liked track; tapping again hides
 * them.
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
  const expandable = artistLikedTracksExpandable(trackCount);
  const focusController = createFocusRingController();
  const heading = (
    <SectionHeader
      title={title}
      subtitle={
        expandable
          ? catalogStrings.artist.likedTracksSummary(artistName, trackCount)
          : catalogStrings.artist.likedTracksBy(artistName)
      }
      trailing={
        expandable ? (
          <View style={styles.toggle}>
            <Text style={styles.toggleText}>
              {expanded
                ? catalogStrings.artist.hideLikedTracks
                : catalogStrings.artist.showLikedTracks}
            </Text>
            <AppIcon
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </View>
        ) : null
      }
    />
  );
  return (
    <View testID="artist-liked-tracks" style={styles.section}>
      {expandable ? (
        <Pressable
          testID="artist-liked-tracks-toggle"
          focusable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded
              ? catalogStrings.artist.hideLikedTracksOf(artistName)
              : catalogStrings.artist.showAllLikedTracks(artistName, trackCount)
          }
          onFocus={() => focusController.setFocused(true)}
          onBlur={() => focusController.setFocused(false)}
          onPress={onToggleExpanded}
          style={({ pressed }) => [styles.expander, pressed ? styles.pressed : null]}
        >
          {heading}
          <FocusRingOverlay controller={focusController} borderRadius={radii.md} />
        </Pressable>
      ) : (
        heading
      )}
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
  expander: { minHeight: metrics.minimumTouchTarget, justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  toggleText: { ...typography.label, color: colors.textSecondary },
  pressed: { opacity: opacity.pressed },
});
