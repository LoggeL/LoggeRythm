import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type TextStyle } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, radii, spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from '../track/StandardTrackRow';
import type { TrackPopularityPolicy } from '../track/trackMetadata';
import { AppText, Artwork, PressableScale, type TvFocusProps } from '../ui';

export interface SearchTrackResultRowProps {
  track: Track;
  testID: string;
  occurrence: TrackOccurrenceTarget;
  position: number;
  popularity?: TrackPopularityPolicy;
  plays?: TrackPlayCount;
  /** Screen-owned progress evidence; the row/provider never polls progress. */
  rollingDeviceCacheSeconds?: unknown;
  onPlay: () => void;
  onActions: () => void;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * A tapped search result plays as the seed of its own track radio (first item
 * of the `radio` context keyed by the track id), so every row showing that
 * track — remote result, top result or library match — is the active one.
 */
export function searchTrackRadioOccurrence(trackId: string): TrackOccurrenceTarget {
  if (trackId.trim().length === 0) {
    throw new Error('Search track radio occurrence requires a track id');
  }
  return {
    queueContext: { type: 'radio', id: trackId },
    originalContextOrder: 0,
  };
}

export function SearchTrackResultRow({
  track,
  testID,
  occurrence,
  position,
  popularity = 'search',
  plays,
  rollingDeviceCacheSeconds,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: SearchTrackResultRowProps) {
  return (
    <StandardTrackRow
      track={track}
      testID={testID}
      occurrence={occurrence}
      position={position}
      popularity={popularity}
      plays={plays}
      rollingDeviceCacheSeconds={rollingDeviceCacheSeconds}
      onPlay={onPlay}
      onActions={onActions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

interface SearchEntityCardProps extends TvFocusProps {
  testID: string;
  accessibilityLabel: string;
  title: string;
  subtitle: string;
  imageUri: string | null;
  /** Round artwork for artists. */
  round?: boolean;
  /** Placeholder glyph while there is no artwork. */
  icon?: AppIconName;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  /** Optional square card size override for 16:9 Android TV. */
  cardSize?: number;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
}

/** One card of a horizontal result rail: artwork, title and one meta line. */
export function SearchEntityCard({
  testID,
  accessibilityLabel,
  title,
  subtitle,
  imageUri,
  round = false,
  icon,
  disabled = false,
  busy = false,
  onPress,
  cardSize = layout.artwork.card,
  titleStyle,
  subtitleStyle,
  focusable,
  hasTVPreferredFocus,
  onFocus,
  onBlur,
  focused,
  focusedStyle,
}: SearchEntityCardProps) {
  const cardStyle =
    cardSize === layout.artwork.card
      ? styles.entityCard
      : [styles.entityCard, { width: cardSize }];
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      focused={focused}
      focusedStyle={focusedStyle}
      onPress={onPress}
      style={cardStyle}
    >
      <View>
        <Artwork
          uri={imageUri}
          size={cardSize}
          shape={round ? 'round' : 'square'}
          icon={icon}
        />
        {busy ? (
          <View style={styles.busyBadge}>
            <ActivityIndicator accessible={false} color={colors.onAccent} size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <AppText
          variant="label"
          numberOfLines={2}
          align={round ? 'center' : undefined}
          style={titleStyle}
        >
          {title}
        </AppText>
        <AppText
          variant="caption"
          color="secondary"
          numberOfLines={1}
          align={round ? 'center' : undefined}
          style={subtitleStyle}
        >
          {subtitle}
        </AppText>
      </View>
    </PressableScale>
  );
}

interface SearchResultRailProps<T> {
  id: string;
  data: readonly T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement;
  paddingHorizontal?: number;
  gap?: number;
}

export function SearchResultRail<T>({
  id,
  data,
  keyExtractor,
  renderItem,
  paddingHorizontal,
  gap,
}: SearchResultRailProps<T>) {
  const containerStyle =
    paddingHorizontal === undefined && gap === undefined
      ? styles.rail
      : [
          styles.rail,
          paddingHorizontal !== undefined ? { paddingHorizontal } : null,
          gap !== undefined ? { gap } : null,
        ];
  return (
    <FlatList
      testID={`search-rail-${id}`}
      horizontal
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={5}
      maxToRenderPerBatch={6}
      windowSize={5}
      removeClippedSubviews={false}
      contentContainerStyle={containerStyle}
    />
  );
}

const styles = StyleSheet.create({
  entityCard: { width: layout.artwork.card, gap: spacing.xs },
  busyBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  copy: { gap: spacing.xxs / 2 },
  rail: { gap: layout.railGap, paddingHorizontal: layout.pagePadding },
});
