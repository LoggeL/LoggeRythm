import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';
import { trackArtistLabel } from '../../api/trackArtists';
import type { RecentPlay } from '../../domain/listeningStats';
import { triggerHaptic } from '../../hooks/useHaptics';
import { strings } from '../../localization';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import TrackStateIndicator from '../TrackStateIndicator';
import { useTrackPresentation } from '../player/TrackPresentationProvider';
import type { TrackOccurrenceTarget } from '../track/StandardTrackRow';
import { trackStateIndicatorCopy } from '../track/trackPresentationCopy';
import {
  AppText,
  Artwork,
  Skeleton,
  createFocusRingController,
  FocusRingOverlay,
  type TvFocusProps,
} from '../ui';
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
  /** Column count (2 on phones, 3 on 16:9 Android TV). */
  columns?: number;
  /** Optional TV horizontal padding override. */
  paddingHorizontal?: number;
  /** Optional TV gap override. */
  gap?: number;
}

/**
 * The "jump back in" quick grid at the top of Home. Cells share the row width
 * equally (2 columns on phone, 3 on 16:9 TV); a short last row is padded with
 * empty cells to preserve exact column alignment.
 */
export function HomeQuickGrid<T>({
  id,
  data,
  keyExtractor,
  renderItem,
  columns = QUICK_GRID_COLUMNS,
  paddingHorizontal,
  gap,
}: HomeQuickGridProps<T>) {
  const gridStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.grid
      : [
          styles.grid,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  const rowStyle = gap === undefined ? styles.row : [styles.row, { gap }];
  return (
    <View testID={`home-shelf-${id}`} style={gridStyle}>
      {quickGridRows(data, columns).map((row) => (
        <View key={keyExtractor(row[0].item, row[0].index)} style={rowStyle}>
          {row.map(({ item, index }) => (
            <View key={keyExtractor(item, index)} style={styles.cell}>
              {renderItem(item, index)}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, filler) => (
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
  columns = QUICK_GRID_COLUMNS,
  tileHeight = TILE_HEIGHT,
  paddingHorizontal,
  gap,
}: HomeSectionSkeletonProps & {
  count?: number;
  columns?: number;
  tileHeight?: number;
  paddingHorizontal?: number;
  gap?: number;
}) {
  const cells = Array.from({ length: count }, (_, index) => index);
  const gridStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.grid
      : [
          styles.grid,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  const rowStyle = gap === undefined ? styles.row : [styles.row, { gap }];
  return (
    <View
      testID={testID}
      focusable={false}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      style={gridStyle}
    >
      {quickGridRows(cells, columns).map((row) => (
        <View key={row[0].index} style={rowStyle}>
          {row.map(({ index }) => (
            <View key={index} style={styles.cell}>
              <Skeleton height={tileHeight} radius="sm" />
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, filler) => (
            <View key={`filler-${filler}`} style={styles.cell} />
          ))}
        </View>
      ))}
    </View>
  );
}

export interface RecentCardProps extends TvFocusProps {
  play: RecentPlay;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
  /** Kept optional for backwards signature compatibility; full-tile tap plays. */
  onOpenAlbum?: (params: AlbumRouteParams) => void;
  onOpenArtist?: (params: ArtistRouteParams) => void;
  /** Optional tile height override (larger on 10-foot Android TV). */
  tileHeight?: number;
  /** Optional TV typography overrides for 10-foot legibility. */
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
}

/**
 * A history tile matching `web/QuickTile.tsx`: the ENTIRE tile is one
 * pressable/D-Pad-focusable play/toggle target with cover artwork, title,
 * artist subtitle, active tint, transport overlay, and cache state indicator.
 */
export function HomeRecentCard({
  play,
  testID,
  occurrence,
  busy,
  disabled,
  onPlay,
  tileHeight = TILE_HEIGHT,
  titleStyle,
  subtitleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused = false,
  focusedStyle,
}: RecentCardProps) {
  const presentation = useTrackPresentation({ trackId: play.id, ...occurrence });
  const working = busy || presentation.playback === 'buffering';
  const artistLabel = trackArtistLabel(play);
  const [focusController] = useState(createFocusRingController);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={strings.home.playTrack(play.title, artistLabel)}
      accessibilityState={{ disabled, busy: working, selected: presentation.active }}
      disabled={disabled}
      focusable={focusable ?? !disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      android_ripple={{ color: colors.fillStrong }}
      onFocus={(event) => {
        focusController.setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focusController.setFocused(false);
        onBlur?.(event);
      }}
      onPress={() => {
        triggerHaptic('tap');
        onPlay();
      }}
      style={({ pressed }) => [
        styles.tile,
        tileHeight !== TILE_HEIGHT ? { minHeight: tileHeight } : null,
        presentation.active ? styles.tileActive : null,
        pressed && !disabled ? styles.pressed : null,
        disabled && !working ? styles.disabled : null,
      ]}
    >
      <View
        style={[
          styles.tileArtworkWrap,
          tileHeight !== TILE_HEIGHT ? { width: tileHeight, minHeight: tileHeight } : null,
        ]}
      >
        <Artwork uri={play.cover} size={tileHeight} style={styles.tileArtwork} />
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
      </View>
      <View style={styles.tileIdentity}>
        <View testID={`${testID}-identity`} style={styles.tileCopy}>
          <AppText
            variant="bodyStrong"
            color={presentation.active ? 'accent' : 'primary'}
            numberOfLines={1}
            style={titleStyle}
          >
            {play.title}
          </AppText>
          {artistLabel.length > 0 ? (
            <AppText
              variant="caption"
              color="secondary"
              numberOfLines={1}
              style={subtitleStyle}
            >
              {artistLabel}
            </AppText>
          ) : null}
        </View>
        <TrackStateIndicator
          presentation={presentation}
          copy={trackStateIndicatorCopy}
          testID={`${testID}-state`}
        />
      </View>
      <FocusRingOverlay
        controller={focusController}
        borderRadius={radii.sm}
        controlledFocused={focused}
        disabled={disabled}
        focusedStyle={focusedStyle}
      />
    </Pressable>
  );
}

export const MemoHomeRecentCard = React.memo(HomeRecentCard);

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
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  tileActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
  },
  tileArtworkWrap: {
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
  tileCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
