import React from 'react';
import { StyleSheet, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { spacing } from '../../theme';
import { ActionButton, AppText, BottomSheet } from '../ui';

export interface PlaylistLeaveSheetProps {
  visible: boolean;
  /** Name of the playlist the collaborator would leave. */
  name: string;
  busy: boolean;
  /** Localized failure of the last attempt; null hides the alert. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation for leaving a collaborative playlist. Cancel is the safe default. */
export function PlaylistLeaveSheet({
  visible,
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: PlaylistLeaveSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      closeLabel={libraryStrings.common.cancel}
      title={libraryStrings.playlist.leaveTitle}
      testID="playlist-leave-sheet"
      contentStyle={styles.sheet}
    >
      <AppText testID="playlist-leave-message" color="secondary">
        {libraryStrings.playlist.leaveMessage(name)}
      </AppText>
      {error === null ? null : (
        <AppText
          testID="playlist-leave-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          variant="callout"
          color="danger"
        >
          {error}
        </AppText>
      )}
      <View style={styles.actions}>
        <ActionButton
          testID="playlist-leave-cancel"
          label={libraryStrings.common.cancel}
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
          style={styles.action}
        />
        <ActionButton
          testID="playlist-leave-confirm"
          label={busy ? libraryStrings.playlist.leaving : libraryStrings.playlist.leaveConfirm}
          icon="logout"
          variant="danger"
          busy={busy}
          onPress={onConfirm}
          style={styles.action}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: spacing.md, paddingHorizontal: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: spacing.xs },
  action: { flexGrow: 1, flexBasis: 120 },
});
