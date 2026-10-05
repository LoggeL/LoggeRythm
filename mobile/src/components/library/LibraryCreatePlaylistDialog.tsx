import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics, radii, spacing, typography } from '../../theme';
import { ActionButton } from '../ui';

interface LibraryCreatePlaylistDialogProps {
  visible: boolean;
  name: string;
  description: string;
  error: string | null;
  busy: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** The keyboard and small viewports must never cover creation or dismissal. */
export function LibraryCreatePlaylistDialog({
  visible,
  name,
  description,
  error,
  busy,
  onNameChange,
  onDescriptionChange,
  onClose,
  onSubmit,
}: LibraryCreatePlaylistDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        testID="library-create-modal"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <ScrollView
          testID="library-create-form-scroll"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View accessibilityViewIsModal style={styles.card}>
            <Text accessibilityRole="header" style={styles.title}>
              {libraryStrings.library.createTitle}
            </Text>
            <View style={styles.field}>
              <Text style={styles.label}>{libraryStrings.library.name}</Text>
              <TextInput
                testID="library-create-name"
                accessibilityLabel={libraryStrings.library.name}
                placeholder={libraryStrings.library.name}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={onNameChange}
                editable={!busy}
                autoFocus
                maxLength={120}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{libraryStrings.library.description}</Text>
              <TextInput
                testID="library-create-description"
                accessibilityLabel={libraryStrings.library.description}
                placeholder={libraryStrings.library.description}
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={onDescriptionChange}
                editable={!busy}
                multiline
                maxLength={500}
                style={[styles.input, styles.descriptionInput]}
              />
            </View>
            {error !== null ? (
              <Text
                testID="library-create-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.error}
              >
                {error}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <ActionButton
                testID="library-create-cancel"
                label={libraryStrings.common.cancel}
                variant="secondary"
                disabled={busy}
                onPress={onClose}
                style={styles.action}
              />
              <ActionButton
                testID="library-create-submit"
                label={busy ? libraryStrings.library.creating : libraryStrings.library.createPlaylist}
                busy={busy}
                icon="plus"
                onPress={onSubmit}
                style={styles.action}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: colors.backgroundElevated,
  },
  title: { ...typography.title, color: colors.textPrimary },
  field: { gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary },
  input: {
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  descriptionInput: { minHeight: 100, textAlignVertical: 'top' },
  error: { ...typography.caption, color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  action: { flexGrow: 1, flexBasis: 120 },
});
