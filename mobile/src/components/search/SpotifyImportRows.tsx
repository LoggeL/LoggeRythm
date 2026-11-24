import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { PlaylistSummary, UnmatchedTrack } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { strings } from '../../localization';
import { colors, layout, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import {
  ActionButton,
  AppText,
  FocusRingOverlay,
  SectionHeader,
  createFocusRingController,
} from '../ui';
import { spotifyImportInputStyle } from './SpotifyImportForm';

interface SpotifyImportSaveControlsProps {
  name: string;
  saving: boolean;
  savingNew: boolean;
  onChangeName: (name: string) => void;
  onSaveNew: (name: string) => void;
}

/** "Save as a new playlist" block plus the heading of the destination list. */
export function SpotifyImportSaveControls({
  name,
  saving,
  savingNew,
  onChangeName,
  onSaveNew,
}: SpotifyImportSaveControlsProps) {
  return (
    <View style={styles.saveBlock}>
      <SectionHeader title={strings.search.importSaveTitle} padded={false} />
      <TextInput
        testID="spotify-import-new-name"
        accessibilityLabel={strings.search.importNewPlaylistName}
        value={name}
        onChangeText={onChangeName}
        editable={!saving}
        maxLength={120}
        placeholder={strings.search.importNewPlaylistName}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={spotifyImportInputStyle}
      />
      <ActionButton
        testID="spotify-import-save-new"
        label={savingNew ? strings.search.importSaving : strings.search.importCreateAndSave}
        variant="secondary"
        icon="playlist-plus"
        fullWidth
        busy={savingNew}
        disabled={saving || name.trim().length === 0}
        onPress={() => onSaveNew(name.trim())}
      />
      <AppText variant="overline" color="secondary" style={styles.destinationsTitle}>
        {strings.search.importExistingPlaylists}
      </AppText>
    </View>
  );
}

interface SpotifyImportDestinationRowProps {
  playlist: PlaylistSummary;
  /** Any save is in flight: every destination is locked. */
  saving: boolean;
  /** This playlist is the one being saved to. */
  busy: boolean;
  onPress: () => void;
}

/** One existing playlist the matched tracks can be added to. */
export function SpotifyImportDestinationRow({
  playlist,
  saving,
  busy,
  onPress,
}: SpotifyImportDestinationRowProps) {
  const focusController = createFocusRingController();
  return (
    <Pressable
      testID={`spotify-import-save-existing-${playlist.id}`}
      accessibilityRole="button"
      accessibilityLabel={strings.search.importSaveToPlaylist(playlist.name)}
      accessibilityState={{ disabled: saving, busy }}
      disabled={saving}
      focusable={!saving}
      android_ripple={{ color: colors.fillStrong }}
      onFocus={() => focusController.setFocused(true)}
      onBlur={() => focusController.setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.destination,
        saving ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.destinationGlyph}>
        {busy ? (
          <ActivityIndicator accessible={false} color={colors.accent} size="small" />
        ) : (
          <AppIcon
            name={playlist.is_collaborative ? 'account-multiple-outline' : 'playlist-plus'}
            color={playlist.is_collaborative ? colors.accentSoft : colors.textSecondary}
            size={22}
          />
        )}
      </View>
      <View style={styles.destinationCopy}>
        <AppText variant="bodyStrong" numberOfLines={1}>{playlist.name}</AppText>
        <AppText variant="caption" color="secondary" numberOfLines={1}>
          {!playlist.is_owner && playlist.owner_name
            ? strings.trackActions.playlistSharedTrackCount(
                playlist.owner_name,
                playlist.track_count,
              )
            : playlist.is_collaborative
              ? strings.trackActions.playlistCollaborativeCount(playlist.track_count)
              : strings.common.trackCount(playlist.track_count)}
        </AppText>
      </View>
      <FocusRingOverlay
        controller={focusController}
        borderRadius={radii.sm}
        disabled={saving}
      />
    </Pressable>
  );
}

/** Heading above the tracks Spotify listed but the catalog could not match. */
export function SpotifyImportUnmatchedHeader() {
  return (
    <View testID="spotify-import-unmatched" style={styles.unmatchedHeader}>
      <SectionHeader title={strings.search.importUnmatchedTitle} padded={false} />
    </View>
  );
}

export function SpotifyImportUnmatchedRow({ track }: { track: UnmatchedTrack }) {
  return (
    <View style={styles.unmatchedRow}>
      <AppIcon name="help-circle-outline" color={colors.textMuted} size={18} />
      <AppText variant="callout" color="secondary" numberOfLines={1} style={styles.unmatchedCopy}>
        {track.title} — {trackArtistLabel(track)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  saveBlock: {
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
  },
  destinationsTitle: { marginTop: spacing.xs },
  destination: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
  },
  destinationGlyph: {
    width: layout.artwork.sm,
    height: layout.artwork.sm,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  destinationCopy: { flex: 1, minWidth: 0 },
  disabled: { opacity: opacity.disabled },
  pressed: { opacity: opacity.pressed },
  unmatchedHeader: { paddingHorizontal: layout.pagePadding, paddingTop: spacing.xl },
  unmatchedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: layout.pagePadding,
    paddingVertical: spacing.xs,
  },
  unmatchedCopy: { flex: 1 },
});
