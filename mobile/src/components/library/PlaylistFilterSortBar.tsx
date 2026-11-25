import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import { ActionButton, FilterChip } from '../ui';

export type PlaylistSortKey = 'custom' | 'title' | 'artist' | 'duration';

const SORT_OPTIONS: readonly PlaylistSortKey[] = ['custom', 'title', 'artist', 'duration'];

export interface IndexedPlaylistTrack {
  readonly track: Track;
  /** Original canonical index in the playlist's server track list. */
  readonly sourceIndex: number;
}

/**
 * Filter and sort a playlist's track list while retaining every row's exact
 * canonical source index so playback occurrences and edits stay aligned.
 */
export function filterAndSortPlaylistTracks(
  tracks: readonly Track[],
  query: string,
  sort: PlaylistSortKey,
): IndexedPlaylistTrack[] {
  const indexed: IndexedPlaylistTrack[] = tracks.map((track, sourceIndex) => ({
    track,
    sourceIndex,
  }));
  const needle = query.trim().toLocaleLowerCase('en-US');
  const filtered = needle.length === 0
    ? indexed
    : indexed.filter(({ track }) => {
        const haystack = `${track.title} ${trackArtistLabel(track)} ${track.album}`.toLocaleLowerCase('en-US');
        return haystack.includes(needle);
      });
  if (sort === 'custom') return filtered;
  return [...filtered].sort((left, right) => {
    switch (sort) {
      case 'title':
        return left.track.title.localeCompare(right.track.title);
      case 'artist':
        return trackArtistLabel(left.track).localeCompare(trackArtistLabel(right.track));
      case 'duration':
        return left.track.duration_sec - right.track.duration_sec;
    }
  });
}

export interface PlaylistFilterSortBarProps {
  query: string;
  onChangeQuery: (value: string) => void;
  sort: PlaylistSortKey;
  onChangeSort: (sort: PlaylistSortKey) => void;
  canQuickAdd: boolean;
  onOpenQuickAdd?: () => void;
}

function sortLabel(key: PlaylistSortKey): string {
  switch (key) {
    case 'custom':
      return libraryStrings.playlist.sortCustom;
    case 'title':
      return libraryStrings.playlist.sortTitle;
    case 'artist':
      return libraryStrings.playlist.sortArtist;
    case 'duration':
      return libraryStrings.playlist.sortDuration;
  }
}

export function PlaylistFilterSortBar({
  query,
  onChangeQuery,
  sort,
  onChangeSort,
  canQuickAdd,
  onOpenQuickAdd,
}: PlaylistFilterSortBarProps) {
  return (
    <View testID="playlist-filter-sort-bar" style={styles.container}>
      <View style={styles.inputRow}>
        <TextInput
          testID="playlist-filter-input"
          accessibilityLabel={libraryStrings.playlist.filterLabel}
          placeholder={libraryStrings.playlist.filterPlaceholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          value={query}
          onChangeText={onChangeQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={styles.input}
        />
        {canQuickAdd && onOpenQuickAdd !== undefined ? (
          <ActionButton
            testID="playlist-quick-add"
            variant="secondary"
            icon="plus"
            label={libraryStrings.playlist.quickAdd}
            onPress={onOpenQuickAdd}
          />
        ) : null}
      </View>
      <View style={styles.chips}>
        {SORT_OPTIONS.map((option) => (
          <FilterChip
            key={option}
            testID={`playlist-sort-${option}`}
            label={sortLabel(option)}
            selected={sort === option}
            onPress={() => onChangeSort(option)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.xs,
  },
});
