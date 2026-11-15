import React from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
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
  /** A mutation is in flight: every owner action is disabled. */
  busy: boolean;
  /** Reordering needs at least one track. */
  canReorder: boolean;
  reordering: boolean;
  onVisibilityChange: (isPublic: boolean) => void;
  onEdit: () => void;
  onToggleReorder: () => void;
  onDelete: () => void;
}

export interface PlaylistActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Offline download section; null for collections that cannot be downloaded. */
  offline: PlaylistActionsOffline | null;
  /** Owner section; null for viewers. */
  owner: PlaylistActionsOwner | null;
  /** Explains to a viewer why there are no edit actions. */
  showViewerNotice: boolean;
}

/**
 * The playlist's overflow menu: the offline download with its live status,
 * and — for the owner — visibility, edit, reorder and delete.
 */
export function PlaylistActionsSheet({
  visible,
  onClose,
  offline,
  owner,
  showViewerNotice,
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
