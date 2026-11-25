import React from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, spacing } from '../../theme';
import OfflinePlaylistControl, {
  type OfflinePlaylistControlCopy,
  type OfflinePlaylistControlState,
} from '../offline/OfflinePlaylistControl';
import { AppText, BottomSheet, IconButton, ListSeparator } from '../ui';
import { SheetActionRow } from './SheetActionRow';

export interface PlaylistActionsOffline {
  state: OfflinePlaylistControlState;
  copy: OfflinePlaylistControlCopy;
  disabled: boolean;
  onDownload: () => void;
  onRetry: () => void;
  onRemove: () => void;
}

export interface PlaylistActionsOwner {
  isPublic: boolean;
  isCollaborative?: boolean;
  collaboratorCount?: number;
  /** A mutation is in flight: every owner action is disabled. */
  busy: boolean;
  /** Reordering needs at least one track. */
  canReorder: boolean;
  reordering: boolean;
  onVisibilityChange: (isPublic: boolean) => void;
  onCollaborativeChange?: (isCollaborative: boolean) => void;
  onOpenCollaborators?: () => void;
  onEdit: () => void;
  onToggleReorder: () => void;
  onDelete: () => void;
}

export interface PlaylistActionsCollaborator {
  isCollaborative: boolean;
  canEditTracks: boolean;
  collaboratorCount: number;
  busy: boolean;
  canReorder: boolean;
  reordering: boolean;
  onOpenCollaborators: () => void;
  onToggleReorder: () => void;
  onLeave: () => void;
}

export interface PlaylistActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Offline download section; null for collections that cannot be downloaded. */
  offline: PlaylistActionsOffline | null;
  /** Owner section; null for non-owners. */
  owner: PlaylistActionsOwner | null;
  /** Non-owner collaborator section; null for owners and non-members. */
  collaborator?: PlaylistActionsCollaborator | null;
  /** Explains to a viewer why there are no edit actions. */
  showViewerNotice: boolean;
  /** Share canonical playlist URL via the native Android share sheet. */
  onShare?: () => void;
  /** Start a seeded radio queue from the playlist's or Liked Songs' tracks. */
  onStartRadio?: () => void;
  /** Open the duplicate inspector & deduplicator sheet (editable playlists only). */
  onFindDuplicates?: () => void;
}

/**
 * The playlist's overflow menu: offline download with live status,
 * owner management (visibility, collaboration, collaborators, edit, reorder, delete),
 * or collaborator actions (collaborators, reorder when active, leave).
 */
export function PlaylistActionsSheet({
  visible,
  onClose,
  offline,
  owner,
  collaborator = null,
  showViewerNotice,
  onShare,
  onStartRadio,
  onFindDuplicates,
}: PlaylistActionsSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={libraryStrings.playlist.closeMenu}
      testID="playlist-actions-modal"
      contentStyle={styles.sheet}
    >
      <View style={styles.header}>
        <AppText accessibilityRole="header" variant="section" numberOfLines={1} style={styles.title}>
          {libraryStrings.playlist.actionsTitle}
        </AppText>
        <IconButton
          testID="playlist-actions-close"
          icon="close"
          variant="tonal"
          accessibilityLabel={libraryStrings.playlist.closeMenu}
          onPress={onClose}
        />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {offline === null ? null : (
          <View style={styles.section}>
            <AppText variant="overline" color="muted">{libraryStrings.playlist.menuTitle}</AppText>
            <OfflinePlaylistControl
              testID="playlist-offline-menu-control"
              state={offline.state}
              copy={offline.copy}
              disabled={offline.disabled}
              onDownload={offline.onDownload}
              onRetry={offline.onRetry}
              onRemove={offline.onRemove}
            />
          </View>
        )}

        {onStartRadio === undefined ? null : (
          <SheetActionRow
            testID="playlist-start-radio"
            icon="radio-tower"
            label={wave2Strings.playlistTools.startRadio}
            description={wave2Strings.playlistTools.startRadioHint}
            onPress={onStartRadio}
          />
        )}

        {onFindDuplicates === undefined ? null : (
          <SheetActionRow
            testID="playlist-find-duplicates"
            icon="broom"
            label={wave2Strings.playlistTools.findDuplicates}
            description={wave2Strings.playlistTools.findDuplicatesHint}
            onPress={onFindDuplicates}
          />
        )}

        {onShare === undefined ? null : (
          <SheetActionRow
            testID="playlist-share"
            icon="share-variant"
            label={libraryStrings.playlist.share}
            description={libraryStrings.playlist.shareHint}
            onPress={onShare}
          />
        )}

        {owner === null ? null : (
          <View testID="playlist-owner-controls">
            {offline === null ? null : <ListSeparator style={styles.separator} />}
            <SheetActionRow
              icon={owner.isPublic ? 'earth' : 'lock-outline'}
              label={owner.isPublic
                ? libraryStrings.playlist.public
                : libraryStrings.playlist.private}
              description={owner.isPublic
                ? libraryStrings.playlist.publicHint
                : libraryStrings.playlist.privateHint}
              trailing={
                <Switch
                  testID="playlist-visibility"
                  accessibilityLabel={owner.isPublic
                    ? libraryStrings.playlist.makePrivate
                    : libraryStrings.playlist.makePublic}
                  accessibilityState={{ disabled: owner.busy }}
                  disabled={owner.busy}
                  value={owner.isPublic}
                  onValueChange={owner.onVisibilityChange}
                  trackColor={{ false: colors.border, true: colors.accentSolid }}
                  thumbColor={owner.isPublic ? colors.accentSoft : colors.textSecondary}
                />
              }
            />
            {owner.onCollaborativeChange === undefined ? null : (
              <SheetActionRow
                icon="account-multiple-outline"
                label={libraryStrings.playlist.collaborative}
                description={owner.isCollaborative
                  ? libraryStrings.playlist.collaborativeHint
                  : libraryStrings.playlist.collaborativeOffHint}
                trailing={
                  <Switch
                    testID="playlist-collaborative"
                    accessibilityLabel={owner.isCollaborative
                      ? libraryStrings.playlist.disableCollaborative
                      : libraryStrings.playlist.makeCollaborative}
                    accessibilityState={{ disabled: owner.busy }}
                    disabled={owner.busy}
                    value={owner.isCollaborative === true}
                    onValueChange={owner.onCollaborativeChange}
                    trackColor={{ false: colors.border, true: colors.accentSolid }}
                    thumbColor={owner.isCollaborative ? colors.accentSoft : colors.textSecondary}
                  />
                }
              />
            )}
            {owner.onOpenCollaborators === undefined ? null : (
              <SheetActionRow
                testID="playlist-collaborators"
                icon="account-group-outline"
                label={libraryStrings.playlist.collaborators}
                description={
                  owner.collaboratorCount !== undefined && owner.collaboratorCount > 0
                    ? libraryStrings.playlist.collaboratorCount(owner.collaboratorCount)
                    : libraryStrings.playlist.collaboratorsHint
                }
                disabled={owner.busy}
                onPress={owner.onOpenCollaborators}
              />
            )}
            <SheetActionRow
              testID="playlist-edit"
              icon="pencil-outline"
              label={libraryStrings.playlist.edit}
              description={libraryStrings.playlist.editHint}
              disabled={owner.busy}
              onPress={owner.onEdit}
            />
            {owner.canReorder ? (
              <SheetActionRow
                testID="playlist-reorder"
                icon="swap-vertical"
                label={owner.reordering
                  ? libraryStrings.playlist.reorderDone
                  : libraryStrings.playlist.reorder}
                description={libraryStrings.playlist.reorderHint}
                onPress={owner.onToggleReorder}
              />
            ) : null}
            <SheetActionRow
              testID="playlist-delete"
              icon="delete-outline"
              tone="danger"
              label={libraryStrings.playlist.delete}
              disabled={owner.busy}
              onPress={owner.onDelete}
            />
          </View>
        )}

        {collaborator === null ? null : (
          <View testID="playlist-collaborator-controls">
            {offline === null ? null : <ListSeparator style={styles.separator} />}
            <SheetActionRow
              testID="playlist-collaborators"
              icon="account-group-outline"
              label={libraryStrings.playlist.collaborators}
              description={
                collaborator.collaboratorCount > 0
                  ? libraryStrings.playlist.collaboratorCount(collaborator.collaboratorCount)
                  : libraryStrings.playlist.collaboratorsViewHint
              }
              disabled={collaborator.busy}
              onPress={collaborator.onOpenCollaborators}
            />
            {collaborator.canEditTracks && collaborator.canReorder ? (
              <SheetActionRow
                testID="playlist-reorder"
                icon="swap-vertical"
                label={collaborator.reordering
                  ? libraryStrings.playlist.reorderDone
                  : libraryStrings.playlist.reorder}
                description={libraryStrings.playlist.reorderHint}
                onPress={collaborator.onToggleReorder}
              />
            ) : null}
            {!collaborator.isCollaborative ? (
              <AppText
                testID="playlist-frozen-notice"
                variant="caption"
                color="muted"
                style={styles.viewerNotice}
              >
                {libraryStrings.playlist.frozenNotice}
              </AppText>
            ) : null}
            <SheetActionRow
              testID="playlist-leave"
              icon="logout"
              tone="danger"
              label={libraryStrings.playlist.leave}
              description={libraryStrings.playlist.leaveHint}
              disabled={collaborator.busy}
              onPress={collaborator.onLeave}
            />
          </View>
        )}

        {showViewerNotice ? (
          <AppText
            testID="playlist-viewer-permissions"
            variant="caption"
            color="muted"
            style={styles.viewerNotice}
          >
            {libraryStrings.playlist.ownerOnly}
          </AppText>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.xs,
  },
  title: { flex: 1 },
  content: { gap: spacing.xs, paddingBottom: spacing.xs },
  section: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  separator: { marginVertical: spacing.xs },
  viewerNotice: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
});
