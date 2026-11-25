import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { PlaylistSummary } from '../../api/types';
import { strings } from '../../localization';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import { ActionButton, AppText, FilterChip, Surface } from '../ui';
import { SearchErrorNotice } from './SearchRemoteStates';

export type ImportTargetMode = 'none' | 'new' | 'existing';

interface SpotifyImportFormProps {
  value: string;
  error: string | null;
  /** The import is being started; the action is locked meanwhile. */
  starting: boolean;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  targetMode?: ImportTargetMode;
  onTargetModeChange?: (mode: ImportTargetMode) => void;
  createPlaylistName?: string;
  onCreatePlaylistNameChange?: (name: string) => void;
  targetPlaylistId?: number | null;
  onTargetPlaylistIdChange?: (id: number | null) => void;
  playlists?: readonly PlaylistSummary[];
}

/** Link entry: title, one-line explanation, URL field, optional target playlist, and import action. */
export function SpotifyImportForm({
  value,
  error,
  starting,
  onChangeText,
  onSubmit,
  targetMode = 'none',
  onTargetModeChange,
  createPlaylistName = '',
  onCreatePlaylistNameChange,
  targetPlaylistId = null,
  onTargetPlaylistIdChange,
  playlists = [],
}: SpotifyImportFormProps) {
  const editablePlaylists = playlists.filter((playlist) => playlist.can_edit_tracks);

  return (
    <Surface testID="spotify-import-panel" padded style={styles.panel}>
      <AppText variant="section" accessibilityRole="header">{strings.search.importTitle}</AppText>
      <AppText variant="callout" color="secondary">{strings.search.importIntro}</AppText>
      <TextInput
        testID="spotify-import-input"
        accessibilityLabel={strings.search.importInputLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={strings.search.importPlaceholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        maxLength={8_192}
        style={styles.input}
      />
      {onTargetModeChange !== undefined ? (
        <View testID="spotify-import-target-picker" style={styles.targetSection}>
          <AppText variant="caption" color="secondary">
            {wave2Strings.importTarget.label}
          </AppText>
          <View style={styles.chipRow}>
            <FilterChip
              testID="spotify-import-target-none"
              label={wave2Strings.importTarget.modeNone}
              selected={targetMode === 'none'}
              disabled={starting}
              onPress={() => onTargetModeChange('none')}
            />
            <FilterChip
              testID="spotify-import-target-new"
              label={wave2Strings.importTarget.modeNew}
              selected={targetMode === 'new'}
              disabled={starting}
              onPress={() => onTargetModeChange('new')}
            />
            {editablePlaylists.length > 0 ? (
              <FilterChip
                testID="spotify-import-target-existing"
                label={wave2Strings.importTarget.modeExisting}
                selected={targetMode === 'existing'}
                disabled={starting}
                onPress={() => onTargetModeChange('existing')}
              />
            ) : null}
          </View>
          {targetMode === 'new' && onCreatePlaylistNameChange !== undefined ? (
            <TextInput
              testID="spotify-import-new-playlist-name"
              accessibilityLabel={wave2Strings.importTarget.newPlaylistPlaceholder}
              value={createPlaylistName}
              onChangeText={onCreatePlaylistNameChange}
              placeholder={wave2Strings.importTarget.newPlaylistPlaceholder}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              maxLength={120}
              style={styles.input}
            />
          ) : null}
          {targetMode === 'existing' && onTargetPlaylistIdChange !== undefined ? (
            <View style={styles.chipRow}>
              {editablePlaylists.slice(0, 8).map((playlist) => (
                <FilterChip
                  key={playlist.id}
                  testID={`spotify-import-dest-${playlist.id}`}
                  label={playlist.name}
                  selected={targetPlaylistId === playlist.id}
                  disabled={starting}
                  onPress={() => onTargetPlaylistIdChange(playlist.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <ActionButton
        testID="spotify-import-resolve"
        label={starting ? strings.search.importStarting : strings.search.importResolve}
        icon="arrow-right"
        fullWidth
        busy={starting}
        disabled={starting || value.trim().length === 0}
        onPress={onSubmit}
      />
      {error !== null ? (
        <View style={styles.flushNotice}>
          <SearchErrorNotice testID="spotify-import-input-error" message={error} />
        </View>
      ) : null}
    </Surface>
  );
}

/** Shared look of the import text fields (link, new playlist name). */
export const spotifyImportInputStyle = StyleSheet.create({
  input: {
    ...typography.body,
    minHeight: metrics.minimumTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
    color: colors.textPrimary,
  },
}).input;

const styles = StyleSheet.create({
  /** The notice brings its own page gutter; cancel it inside the padded panel. */
  flushNotice: { marginHorizontal: -layout.pagePadding, marginBottom: -spacing.sm },
  panel: { marginHorizontal: layout.pagePadding, marginTop: spacing.xs, gap: spacing.sm },
  targetSection: { gap: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  input: spotifyImportInputStyle,
});
