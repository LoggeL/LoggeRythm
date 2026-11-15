import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { strings } from '../localization';
import { colors, layout, metrics, opacity, radii, spacing, typography } from '../theme';
import AppIcon, { type AppIconName } from './AppIcon';
import { ActionButton, AppText, Artwork, IconButton } from './ui';

export interface TrackActionRowProps {
  testID: string;
  label: string;
  icon: AppIconName;
  disabled: boolean;
  busy?: boolean;
  /** Destructive actions are tinted with the danger colour. */
  destructive?: boolean;
  onPress: () => void;
}

/**
 * One full-width action of the track sheet: leading glyph, label and a
 * trailing spinner while its own command runs. The whole row is the 48dp+
 * button, so the label is its accessible name.
 */
export function TrackActionRow({
  testID,
  label,
  icon,
  disabled,
  busy = false,
  destructive = false,
  onPress,
}: TrackActionRowProps) {
  const foreground = destructive ? colors.danger : colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        pressed ? styles.rowPressed : null,
        disabled && !busy ? styles.disabled : null,
      ]}
    >
      <AppIcon name={icon} color={destructive ? colors.danger : colors.textSecondary} size={24} />
      <AppText
        variant="body"
        numberOfLines={2}
        style={[styles.rowLabel, { color: foreground }]}
      >
        {label}
      </AppText>
      {busy ? <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" /> : null}
    </Pressable>
  );
}

export interface TrackActionsHeaderProps {
  title: string;
  subtitle: string;
  coverUri: string | null | undefined;
  /** Shown instead of the artwork to return to the previous sheet page. */
  back?: { label: string; onPress: () => void; testID: string };
  closeDisabled: boolean;
  onClose: () => void;
}

/** Sheet header: what the actions apply to, plus the explicit close control. */
export function TrackActionsHeader({
  title,
  subtitle,
  coverUri,
  back,
  closeDisabled,
  onClose,
}: TrackActionsHeaderProps) {
  return (
    <View style={styles.header}>
      {back !== undefined ? (
        <IconButton
          testID={back.testID}
          icon="arrow-left"
          accessibilityLabel={back.label}
          disabled={closeDisabled}
          onPress={back.onPress}
        />
      ) : (
        <Artwork uri={coverUri} size={layout.artwork.md} />
      )}
      <View style={styles.headerCopy}>
        <AppText accessibilityRole="header" variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>
      <IconButton
        testID="track-actions-close"
        icon="close"
        variant="tonal"
        size="sm"
        accessibilityLabel={strings.trackActions.close}
        disabled={closeDisabled}
        onPress={onClose}
      />
    </View>
  );
}

export interface TrackActionsPlaylistRowProps {
  testID: string;
  name: string;
  detail: string;
  accessibilityLabel: string;
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}

/** A destination playlist in the add-to-playlist page of the sheet. */
export function TrackActionsPlaylistRow({
  testID,
  name,
  detail,
  accessibilityLabel,
  disabled,
  busy,
  onPress,
}: TrackActionsPlaylistRowProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.playlistRow,
        pressed ? styles.rowPressed : null,
        disabled && !busy ? styles.disabled : null,
      ]}
    >
      <Artwork uri={null} size={layout.artwork.sm} icon="playlist-music" />
      <View style={styles.headerCopy}>
        <AppText variant="bodyStrong" numberOfLines={1}>{name}</AppText>
        <AppText variant="callout" color="secondary" numberOfLines={1}>{detail}</AppText>
      </View>
      {busy ? (
        <ActivityIndicator accessible={false} color={colors.accentSoft} size="small" />
      ) : (
        <AppIcon name="plus" color={colors.textMuted} size={20} />
      )}
    </Pressable>
  );
}

export interface TrackActionsCreateFormProps {
  name: string;
  onChangeName: (name: string) => void;
  /** Any sheet command is in flight: the form is read-only. */
  disabled: boolean;
  /** The create request itself is in flight. */
  submitting: boolean;
  onSubmit: () => void;
}

/** Name field plus the one primary action of the create-playlist page. */
export function TrackActionsCreateForm({
  name,
  onChangeName,
  disabled,
  submitting,
  onSubmit,
}: TrackActionsCreateFormProps) {
  return (
    <View style={styles.createForm}>
      <TextInput
        testID="track-action-new-playlist-name"
        accessibilityLabel={strings.trackActions.newPlaylistName}
        placeholder={strings.trackActions.newPlaylistName}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        value={name}
        onChangeText={onChangeName}
        editable={!disabled}
        autoFocus
        maxLength={120}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        style={styles.input}
      />
      <ActionButton
        testID="track-action-create-submit"
        label={strings.trackActions.createAndAdd}
        icon="playlist-plus"
        fullWidth
        busy={submitting}
        disabled={disabled || name.trim().length === 0}
        onPress={onSubmit}
      />
    </View>
  );
}

/**
 * Height of the on-screen keyboard in dp (0 while hidden). The track sheet is
 * anchored to the bottom of a translucent Modal window, which Android does
 * not resize for the keyboard, so the create form lifts itself by this much.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return height;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  actionRow: {
    minHeight: layout.artwork.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
  },
  rowLabel: { flex: 1 },
  playlistRow: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowPressed: { opacity: opacity.pressed, backgroundColor: colors.fill },
  disabled: { opacity: opacity.disabled },
  createForm: { gap: spacing.md, paddingHorizontal: spacing.sm, paddingTop: spacing.xs },
  input: {
    ...typography.body,
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.backgroundElevated,
  },
});
