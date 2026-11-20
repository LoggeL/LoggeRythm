import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { strings } from '../../localization';
import { colors, layout, metrics, radii, spacing, typography } from '../../theme';
import { ActionButton, AppText, Surface } from '../ui';
import { SearchErrorNotice } from './SearchRemoteStates';

interface SpotifyImportFormProps {
  value: string;
  error: string | null;
  /** The import is being started; the action is locked meanwhile. */
  starting: boolean;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
}

/** Link entry: title, one-line explanation, URL field and the import action. */
export function SpotifyImportForm({
  value,
  error,
  starting,
  onChangeText,
  onSubmit,
}: SpotifyImportFormProps) {
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
  input: spotifyImportInputStyle,
});
