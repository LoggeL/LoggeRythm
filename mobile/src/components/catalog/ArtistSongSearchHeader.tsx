import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { catalogStrings } from '../../screens/catalogStrings';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import AppIcon from '../AppIcon';
import { IconButton, SectionHeader } from '../ui';
import { CatalogQueryBoundary } from './CatalogStates';
import { catalogQueryFlags, type CatalogQueryFlags } from './catalogQueryState';

export interface ArtistSongSearchHeaderProps {
  artistName: string;
  input: string;
  onChangeInput: (value: string) => void;
  onSubmit?: () => void;
  /** The debounced query the results belong to. */
  query: string;
  search: CatalogQueryFlags & { data: unknown; refetch: () => unknown };
  resultCount: number;
}

/**
 * Heading, field and remote state of the Artist page's song search. The
 * result rows themselves are list items of the page's SectionList; this
 * header only reports loading, failure and "no songs for <query>".
 */
export function ArtistSongSearchHeader({
  artistName,
  input,
  onChangeInput,
  onSubmit,
  query,
  search,
  resultCount,
}: ArtistSongSearchHeaderProps) {
  return (
    <View testID="artist-song-search" style={styles.section}>
      <SectionHeader title={catalogStrings.artist.searchSongs} />
      <View style={styles.field}>
        <AppIcon name="magnify" color={colors.textMuted} size={typography.title.fontSize} />
        <TextInput
          testID="artist-song-search-input"
          accessibilityLabel={catalogStrings.artist.searchSongsLabel(artistName)}
          value={input}
          onChangeText={onChangeInput}
          onSubmitEditing={onSubmit}
          placeholder={catalogStrings.artist.searchSongsPlaceholder(artistName)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {input.length > 0 ? (
          <IconButton
            testID="artist-song-search-clear"
            icon="close"
            size="sm"
            accessibilityLabel={catalogStrings.artist.clearSongSearch}
            onPress={() => onChangeInput('')}
          />
        ) : null}
      </View>
      {query.length === 0 ? null : (
        <CatalogQueryBoundary
          id="artist-song-search-state"
          hasData={search.data !== undefined}
          empty={search.data !== undefined && resultCount === 0}
          {...catalogQueryFlags(search)}
          loadingLabel={catalogStrings.artist.searchSongsLoading}
          emptyLabel={catalogStrings.artist.searchSongsEmpty(query)}
          emptyIcon="text-search"
          errorLabel={catalogStrings.artist.searchSongsFailed}
          retryLabel={catalogStrings.common.retry}
          onRetry={() => void search.refetch()}
          skeleton="rows"
          refreshIndicator={false}
        >
          <View testID="artist-song-search-results" />
        </CatalogQueryBoundary>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.headerGap },
  field: {
    minHeight: metrics.minimumTouchTarget,
    marginHorizontal: layout.pagePadding,
    paddingLeft: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  input: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    minHeight: metrics.minimumTouchTarget,
    paddingVertical: 0,
    paddingRight: spacing.md,
    color: colors.textPrimary,
  },
});
