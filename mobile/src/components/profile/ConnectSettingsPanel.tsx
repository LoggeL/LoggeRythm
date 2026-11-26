import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { connectSession, useConnectSession } from '../../connect/connectRuntime';
import { strings } from '../../localization';
import { partyErrorDetail } from '../../party/partyErrors';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { showDevicePicker } from '../connect/devicePicker';
import { spotifyImportInputStyle } from '../search/SpotifyImportForm';
import { ActionButton, AppText } from '../ui';
import { ProfileGroup } from './ProfileGroup';

/**
 * Isolated Profile section for personal multi-device Connect settings:
 * enable/disable WebSocket sync, rename this device, view connected devices.
 */
export default function ConnectSettingsPanel() {
  const connect = useConnectSession();
  const [draftName, setDraftName] = useState(connect.selfDeviceName);
  const [lastKnownName, setLastKnownName] = useState(connect.selfDeviceName);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (connect.selfDeviceName !== lastKnownName) {
    setLastKnownName(connect.selfDeviceName);
    setDraftName(connect.selfDeviceName);
  }

  const deviceCount = connect.state?.devices.length ?? 0;

  const handleToggle = () => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    setFeedback(null);
    void connectSession()
      .setEnabled(!connect.enabled)
      .catch((cause: unknown) => {
        setError(strings.connect.connectionFailed(partyErrorDetail(cause)));
      })
      .finally(() => setToggling(false));
  };

  const handleSaveName = () => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setError(strings.connect.deviceNameEmpty);
      return;
    }
    setSaving(true);
    setError(null);
    setFeedback(null);
    void connectSession()
      .renameDevice(trimmed)
      .then(() => setFeedback(strings.connect.deviceNameSaved))
      .catch((cause: unknown) => {
        setError(strings.connect.deviceNameFailed(partyErrorDetail(cause)));
      })
      .finally(() => setSaving(false));
  };

  return (
    <ProfileGroup
      testID="profile-connect"
      icon="devices"
      title={strings.connect.settingsTitle}
    >
      <Pressable
        testID="profile-connect-toggle"
        accessibilityRole="switch"
        accessibilityLabel={strings.connect.syncEnabledLabel}
        accessibilityHint={strings.connect.syncEnabledHint}
        accessibilityState={{ checked: connect.enabled, disabled: toggling }}
        disabled={toggling}
        onPress={handleToggle}
        style={({ pressed }) => [styles.toggleRow, pressed ? styles.pressed : null]}
      >
        <AppText variant="bodyStrong" style={styles.toggleLabel}>{strings.connect.syncEnabledLabel}</AppText>
        <AppIcon
          name={connect.enabled ? 'toggle-switch' : 'toggle-switch-off-outline'}
          size={32}
          color={connect.enabled ? colors.accent : colors.textMuted}
        />
      </Pressable>

      <View style={styles.nameRow}>
        <TextInput
          testID="profile-connect-name-input"
          accessibilityLabel={strings.connect.deviceNameLabel}
          value={draftName}
          onChangeText={setDraftName}
          placeholder={strings.connect.deviceNamePlaceholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={handleSaveName}
          style={[spotifyImportInputStyle, styles.nameInput]}
        />
        <ActionButton
          testID="profile-connect-name-save"
          label={strings.connect.deviceNameSave}
          variant="secondary"
          busy={saving}
          disabled={saving}
          onPress={handleSaveName}
        />
      </View>

      {error !== null ? (
        <AppText testID="profile-connect-error" accessibilityRole="alert" variant="callout" color="danger">
          {error}
        </AppText>
      ) : null}
      {connect.error !== null ? (
        <AppText testID="profile-connect-ws-error" accessibilityRole="alert" variant="callout" color="danger">
          {connect.error}
        </AppText>
      ) : null}
      {feedback !== null ? (
        <AppText testID="profile-connect-feedback" variant="callout" color="accent">
          {feedback}
        </AppText>
      ) : null}

      <ActionButton
        testID="profile-connect-open-devices"
        icon="speaker-wireless"
        label={
          connect.phase === 'connected'
            ? `${strings.connect.connectToDevice} (${deviceCount})`
            : strings.connect.connectToDevice
        }
        variant="secondary"
        fullWidth
        onPress={() => showDevicePicker('devices')}
      />
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: metrics.minimumTouchTarget,
  },
  toggleLabel: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nameInput: { flex: 1, minWidth: 0, borderRadius: radii.md },
  pressed: { opacity: opacity.pressed },
});
