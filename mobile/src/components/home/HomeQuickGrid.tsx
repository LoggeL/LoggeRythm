import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import TrackStateIndicator from '../TrackStateIndicator';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import TrackIdentityLinks from '../track/TrackIdentityLinks';
import { buildTrackMetadata } from '../track/trackMetadata';
import {
  trackIdentityCopy,
  trackStateIndicatorCopy,
} from '../track/trackPresentationCopy';
import { Artwork, Skeleton } from '../ui';
import type { HomeSectionSkeletonProps } from './HomeSection';

export const QUICK_GRID_COLUMNS = 2;
const TILE_HEIGHT = layout.artwork.md;

/** Chunks the grid items into rows; the last row may be shorter. */
export function quickGridRows<T>(
  data: readonly T[],
  columns = QUICK_GRID_COLUMNS,
): { item: T; index: number }[][] {
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`Quick grid needs a positive column count; received ${String(columns)}`);
  }
  const rows: { item: T; index: number }[][] = [];
  data.forEach((item, index) => {
    if (index % columns === 0) rows.push([]);
    rows[rows.length - 1].push({ item, index });
  });
  return rows;
}

interface HomeQuickGridProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
}

/**
 * The two-column "jump back in" grid at the top of Home. Cells share the row
 * width equally, so it needs no screen measurement and holds at 360dp; a
 * short last row is padded with an empty cell to keep the column width.
 */
export function HomeQuickGrid<T>({ id, data, keyExtractor, renderItem }: HomeQuickGridProps<T>) {
  return (
    <View testID={`home-shelf-${id}`} style={styles.grid}>
      {quickGridRows(data).map((row) => (
        <View key={keyExtractor(row[0].item, row[0].index)} style={styles.row}>
          {row.map(({ item, index }) => (
            <View key={keyExtractor(item, index)} style={styles.cell}>
              {renderItem(item, index)}
            </View>
          ))}
          {Array.from({ length: QUICK_GRID_COLUMNS - row.length }, (_, filler) => (
            <View key={`filler-${filler}`} style={styles.cell} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Loading placeholder with the exact footprint of a full quick grid. */
export function HomeQuickGridSkeleton({
  testID,
  accessibilityLabel,
  count = 6,
}: HomeSectionSkeletonProps & { count?: number }) {
  const cells = Array.from({ length: count }, (_, index) => index);
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={styles.grid}
    >
      {quickGridRows(cells).map((row) => (
        <View key={row[0].index} style={styles.row}>
          {row.map(({ index }) => (
            <View key={index} style={styles.cell}>
              <Skeleton height={TILE_HEIGHT} radius="sm" />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

interface RecentCardProps {
  play: RecentPlay;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * A history tile: the cover is the dedicated play target, the title and the
 * artists stay separate catalog links. The tile tints while its track is the
 * active one and the cover then shows the transport state.
 */
export function HomeRecentCard({
  play,
  testID,
  occurrence,
  busy,
  disabled,
  onPlay,
  onOpenAlbum,
  onOpenArtist,
}: RecentCardProps) {
  const presentation = useTrackPresentation({ trackId: play.id, ...occurrence });
  const working = busy || presentation.playback === 'buffering';
  return (
    <View style={[styles.tile, presentation.active ? styles.tileActive : null]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={strings.home.playTrack(play.title, play.artist)}
        accessibilityState={{ disabled, busy: working, selected: presentation.active }}
        disabled={disabled}
        onPress={onPlay}
        style={({ pressed }) => [
          styles.tilePlay,
          pressed ? styles.pressed : null,
          disabled && !working ? styles.disabled : null,
        ]}
      >
        <Artwork uri={play.cover} size={TILE_HEIGHT} style={styles.tileArtwork} />
        {working || presentation.active ? (
          <View testID={`${testID}-transport`} accessible={false} style={styles.tileTransport}>
            {working ? (
              <ActivityIndicator accessible={false} color={colors.textPrimary} size="small" />
            ) : (
              <AppIcon
                name={presentation.playback === 'playing' ? 'pause' : 'play'}
                color={colors.textPrimary}
                size={24}
              />
            )}
          </View>
        ) : null}
      </Pressable>
      <View style={styles.tileIdentity}>
        <TrackIdentityLinks
          metadata={buildTrackMetadata(play)}
          testID={`${testID}-identity`}
          copy={trackIdentityCopy}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          showAlbumLabel={false}
          showDuration={false}
          showPopularity={false}
        />
        <TrackStateIndicator
          presentation={presentation}
          copy={trackStateIndicatorCopy}
          testID={`${testID}-state`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.xs, paddingHorizontal: layout.pagePadding },
  row: { flexDirection: 'row', gap: spacing.xs },
  cell: { flex: 1, minWidth: 0 },
  tile: {
    minHeight: TILE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  tileActive: { backgroundColor: colors.accentSubtle },
  tilePlay: {
    width: TILE_HEIGHT,
    minHeight: TILE_HEIGHT,
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  tileArtwork: { borderRadius: 0 },
  tileTransport: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
  },
  tileIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
