import React from 'react';
import { StyleSheet, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { spacing } from '../../theme';
import { ActionButton, AppText, BottomSheet } from '../ui';

export interface PlaylistDeleteSheetProps {
  visible: boolean;
  /** Name of the playlist that would be deleted. */
  name: string;
  busy: boolean;
  /** Localized failure of the last attempt; null hides the alert. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation for the irreversible playlist deletion. Cancel is the safe default. */
export function PlaylistDeleteSheet({
  visible,
  name,
  busy,
  error,
  onCancel,
  onConfirm,
}: PlaylistDeleteSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      closeLabel={libraryStrings.common.cancel}
      title={libraryStrings.playlist.deleteTitle}
      testID="playlist-delete-sheet"
      contentStyle={styles.sheet}
    >
      <AppText testID="playlist-delete-message" color="secondary">
        {libraryStrings.playlist.deleteMessage(name)}
      </AppText>
      {error === null ? null : (
        <AppText
          testID="playlist-delete-error"
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
          testID="playlist-delete-cancel"
          label={libraryStrings.common.cancel}
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
          style={styles.action}
        />
        <ActionButton
          testID="playlist-delete-confirm"
          label={libraryStrings.playlist.deleteConfirm}
          icon="delete-outline"
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
