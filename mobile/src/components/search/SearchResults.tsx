import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors } from '../../theme';
import AppIcon from '../AppIcon';
import StandardTrackRow, {
  type TrackOccurrenceTarget,
} from '../track/StandardTrackRow';
import type { TrackPopularityPolicy } from '../track/trackMetadata';

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
  imageUri: string;
  round?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}

export function SearchEntityCard({
  testID,
  accessibilityLabel,
  title,
  subtitle,
  imageUri,
  round = false,
  disabled = false,
  busy = false,
  onPress,
}: SearchEntityCardProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.entityCard, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {imageUri ? (
        <Image
          accessible={false}
          source={{ uri: imageUri }}
          style={[styles.entityArtwork, round && styles.roundArtwork]}
        />
      ) : (
        <View style={[styles.entityArtwork, round && styles.roundArtwork, styles.placeholder]}>
          <AppIcon name="music-note" color={colors.accentSoft} size={22} />
        </View>
      )}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
    </Pressable>
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
      contentContainerStyle={styles.rail}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7, backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.5 },
  entityCard: { width: 152, minHeight: 210, gap: 5 },
  entityArtwork: { width: 152, height: 152, borderRadius: 12, backgroundColor: colors.surfaceElevated },
  roundArtwork: { borderRadius: 76 },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  placeholderGlyph: { color: colors.accentSoft, fontSize: 28 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  rail: { gap: 12, paddingHorizontal: 16 },
});
