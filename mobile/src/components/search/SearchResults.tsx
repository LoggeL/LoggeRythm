import React from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Track, TrackPlayCount } from '../../api/types';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { colors, radii, spacing, typography } from '../../theme';
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
  landscape?: boolean;
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
  landscape = false,
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
      style={({ pressed }) => [
        styles.entityCard,
        landscape && styles.landscapeCard,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.artworkFrame}>
        {imageUri ? (
          <Image
            accessible={false}
            source={{ uri: imageUri }}
            style={[styles.entityArtwork, landscape && styles.landscapeArtwork, round && styles.roundArtwork]}
          />
        ) : (
          <View style={[styles.entityArtwork, landscape && styles.landscapeArtwork, round && styles.roundArtwork, styles.placeholder]}>
            <AppIcon name="music-note" color={colors.accentSoft} size={22} />
          </View>
        )}
        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color={colors.onAccent} size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
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
      keyboardShouldPersistTaps="handled"
      initialNumToRender={5}
      maxToRenderPerBatch={6}
      windowSize={5}
      contentContainerStyle={styles.rail}
    />
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
  entityCard: { width: 148, gap: spacing.sm, paddingBottom: spacing.xxs },
  landscapeCard: { width: 188 },
  artworkFrame: { position: 'relative' },
  entityArtwork: { width: 148, height: 148, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated },
  landscapeArtwork: { width: 188, height: 112 },
  roundArtwork: { borderRadius: radii.pill },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSubtle },
  busyOverlay: { position: 'absolute', right: spacing.xs, bottom: spacing.xs, padding: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.accent },
  copy: { gap: spacing.xxs },
  title: { ...typography.label, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  rail: { gap: spacing.md, paddingHorizontal: spacing.lg },
});
