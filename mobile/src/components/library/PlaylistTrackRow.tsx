import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import {
  libraryTestIdSegment,
  type LibraryAlbumRouteParams,
  type LibraryArtistRouteParams,
  type LibraryTrackOccurrence,
  type TrackMoveDirection,
} from '../../screens/libraryModel';
import { libraryStrings } from '../../screens/libraryStrings';
import type { QueueDragHandlers } from '../../screens/useQueueDrag';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import StandardTrackRow from '../track/StandardTrackRow';
import { IconButton } from '../ui';

export interface PlaylistTrackRowProps {
  track: Track;
  index: number;
  count: number;
  occurrence: LibraryTrackOccurrence;
  /** Shows the move/remove controls (owner or active collaborator in reorder mode). */
  canEdit: boolean;
  controlsDisabled: boolean;
  /** Optional drag-to-reorder handle wired to `useQueueDrag`. */
  dragHandle?: {
    handlers: QueueDragHandlers;
    dragging: boolean;
  };
  /** Optional ref callback for measuring the row container during drag-to-reorder. */
  rowRef?: (node: View | null) => void;
  /** Optional contributor attribution caption for collaborative playlists. */
  addedByLabel?: string;
  onPlay: () => void;
  onOpenActions: () => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
  onMove: (direction: TrackMoveDirection) => void;
  onRemove: () => void;
}

/** One playlist occurrence on the shared track row, with the owner's reorder controls. */
export function PlaylistTrackRow({
  track,
  index,
  count,
  occurrence,
  canEdit,
  controlsDisabled,
  dragHandle,
  rowRef,
  addedByLabel,
  onPlay,
  onOpenActions,
  onOpenAlbum,
  onOpenArtist,
  onMove,
  onRemove,
}: PlaylistTrackRowProps) {
  const rowId = `playlist-track-${libraryTestIdSegment(track.id)}-${index}`;
  const content = (
    <StandardTrackRow
      track={track}
      testID={rowId}
      occurrence={occurrence}
      position={index + 1}
      caption={addedByLabel}
      swipeToQueue={!canEdit}
      onPlay={onPlay}
      onActions={onOpenActions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      trailingControls={canEdit ? (
        <View style={[styles.controls, dragHandle?.dragging ? styles.draggingRow : null]}>
          {dragHandle !== undefined ? (
            <View
              testID={`${rowId}-drag`}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={libraryStrings.playlist.dragHandleLabel(track.title)}
              style={styles.dragHandle}
              {...dragHandle.handlers}
            >
              <AppIcon name="drag-horizontal-variant" size={20} color={colors.textSecondary} />
            </View>
          ) : null}
          <IconButton
            testID={`${rowId}-up`}
            icon="arrow-up"
            size="sm"
            variant="tonal"
            accessibilityLabel={libraryStrings.playlist.moveUp(track.title)}
            disabled={controlsDisabled || index === 0}
            onPress={() => onMove('up')}
          />
          <IconButton
            testID={`${rowId}-down`}
            icon="arrow-down"
            size="sm"
            variant="tonal"
            accessibilityLabel={libraryStrings.playlist.moveDown(track.title)}
            disabled={controlsDisabled || index === count - 1}
            onPress={() => onMove('down')}
          />
          <IconButton
            testID={`${rowId}-remove`}
            icon="close"
            size="sm"
            variant="tonal"
            color={colors.danger}
            accessibilityLabel={libraryStrings.playlist.remove(track.title)}
            disabled={controlsDisabled}
            onPress={onRemove}
          />
        </View>
      ) : undefined}
    />
  );
  if (rowRef === undefined) return content;
  return (
    <View ref={rowRef} collapsable={false}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  draggingRow: {
    opacity: opacity.disabled,
  },
  dragHandle: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.fill,
    marginRight: 'auto',
  },
});
