import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, layout, radii, spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from '../track/StandardTrackRow';
import type { TrackPopularityPolicy } from '../track/trackMetadata';
import { AppText, Artwork, PressableScale } from '../ui';

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

/** The rendered sort order is the queue's original context order. */
export function searchTrackOccurrence(
  query: string,
  index: number,
): TrackOccurrenceTarget {
  const id = query.trim();
  if (id.length === 0) throw new Error('Search track occurrence requires a query identity');
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Search track occurrence index must be non-negative; received ${index}`);
  }
  return {
    queueContext: { type: 'search', id },
    originalContextOrder: index,
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

interface SearchEntityCardProps {
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
}: SearchEntityCardProps) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={styles.entityCard}
    >
      <View>
        <Artwork
          uri={imageUri}
          size={layout.artwork.card}
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
        <AppText variant="label" numberOfLines={2} align={round ? 'center' : undefined}>
          {title}
        </AppText>
        <AppText
          variant="caption"
          color="secondary"
          numberOfLines={1}
          align={round ? 'center' : undefined}
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
}

export function SearchResultRail<T>({ id, data, keyExtractor, renderItem }: SearchResultRailProps<T>) {
  return (
    <FlatList
      testID={`search-rail-${id}`}
      horizontal
      data={[...data]}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => renderItem(item, index)}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={5}
      maxToRenderPerBatch={6}
      windowSize={5}
      contentContainerStyle={styles.rail}
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
