import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import type { ConnectDevice } from '../../api/types';
import {
  deviceTypeIcon,
  deviceTypeLabel,
  type ConnectSessionSnapshot,
} from '../../connect/connectModel';
import { connectSession, useConnectSession } from '../../connect/connectRuntime';
import { strings } from '../../localization';
import { useLocaleRevision } from '../../localization/LocaleProvider';
import { partyErrorDetail } from '../../party/partyErrors';
import { normalizePartyCode, partyDisplayName } from '../../party/partyModel';
import { partySession, startPartyFromQueue, usePartySession } from '../../party/partyRuntime';
import type { PartySessionSnapshot } from '../../party/partySession';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import { isTvMode, tvFocusRegistry } from '../../tv';
import AppIcon from '../AppIcon';
import { spotifyImportInputStyle } from '../search/SpotifyImportForm';
import { MemoEqualizerBars } from '../TrackStateIndicator';
import {
  ActionButton,
  AppText,
  BottomSheet,
  createFocusRingController,
  FocusRingOverlay,
  IconButton,
  ListSeparator,
} from '../ui';
import {
  dismissDevicePicker,
  getDevicePickerRequest,
  subscribeDevicePicker,
  type DevicePickerInitialFocus,
} from './devicePicker';

export interface DevicePickerSheetContentProps {
  connect: ConnectSessionSnapshot;
  party: PartySessionSnapshot;
  initialFocus: DevicePickerInitialFocus;
  onClose: () => void;
  onOpenParty: (code: string) => void;
  onTransfer: (device: ConnectDevice) => Promise<void>;
  onRetryConnect: () => void;
  onToggleConnectEnabled: (enabled: boolean) => Promise<void>;
  onRenameDevice: (name: string) => Promise<void>;
  onSetRemoteVolume: (volume: number) => Promise<void>;
  onSetRemoteMute: (muted: boolean) => Promise<void>;
  onStartJam: () => Promise<void>;
}

function DeviceRow({
  device,
  isSelf,
  transferring,
  disabled,
  hasTVPreferredFocus,
  onPress,
}: {
  device: ConnectDevice;
  isSelf: boolean;
  transferring: boolean;
  disabled: boolean;
  hasTVPreferredFocus?: boolean;
  onPress: () => void;
}) {
  const focusController = createFocusRingController();
  const label = isSelf ? `${device.name} (${strings.connect.thisDevice})` : device.name;
  return (
    <Pressable
      testID={`device-picker-item-${device.device_id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: device.is_active, busy: transferring, disabled }}
      disabled={disabled}
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => focusController.setFocused(true)}
      onBlur={() => focusController.setFocused(false)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.deviceRow,
        device.is_active ? styles.deviceRowActive : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <View style={styles.deviceIconWrap}>
        <AppIcon
          name={deviceTypeIcon(device.device_type)}
          size={22}
          color={device.is_active ? colors.accent : colors.textPrimary}
        />
      </View>
      <View style={styles.deviceCopy}>
        <View style={styles.deviceTitleRow}>
          <AppText
            variant="bodyStrong"
            color={device.is_active ? 'accent' : 'primary'}
            numberOfLines={1}
            style={styles.flexShrinkText}
          >
            {device.name}
          </AppText>
          {isSelf ? (
            <AppText variant="micro" color="secondary" style={styles.badge}>
              {strings.connect.thisDevice}
            </AppText>
          ) : null}
        </View>
        <AppText variant="caption" color="secondary" numberOfLines={1}>
          {deviceTypeLabel(device.device_type)}
          {device.party_code !== null ? ` · Jam ${device.party_code}` : ''}
        </AppText>
      </View>
      {transferring ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : null}
      <FocusRingOverlay controller={focusController} borderRadius={radii.md} disabled={disabled} />
    </Pressable>
  );
}

/** Pure inner sheet content for the Spotify-like Connect & Jam device selector. */
export function DevicePickerSheetContent({
  connect,
  party,
  initialFocus,
  onClose,
  onOpenParty,
  onTransfer,
  onRetryConnect,
  onToggleConnectEnabled,
  onRenameDevice,
  onSetRemoteVolume,
  onSetRemoteMute,
  onStartJam,
}: DevicePickerSheetContentProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingJam, setStartingJam] = useState(false);
  const [joinOpen, setJoinOpen] = useState(initialFocus === 'jam' && party.party === null);
  const [joinCode, setJoinCode] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState(connect.selfDeviceName);
  const [savingName, setSavingName] = useState(false);
  const [togglingSync, setTogglingSync] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);

  const devices = connect.state?.devices ?? [];
  const activeDevice = connect.activeDevice;
  const otherDevices = devices.filter((device) => device.device_id !== activeDevice?.device_id);
  const activeIsSelf =
    activeDevice !== null && activeDevice.device_id === connect.selfDeviceId;
  const canAdjustRemoteVolume =
    connect.isControllingRemote
    && activeDevice !== null
    && activeDevice.capabilities.can_control_volume;
  const remotePlayback = connect.state?.playback ?? null;
  const isActivePlaying =
    remotePlayback !== null && activeDevice !== null && remotePlayback.is_playing;
  const displayedVolume =
    volumeDraft ?? (activeDevice?.muted ? 0 : activeDevice?.volume ?? remotePlayback?.volume ?? 1);
  const isTv = isTvMode();

  const handleSelectDevice = (device: ConnectDevice) => {
    setActionError(null);
    if (party.party !== null && device.device_id !== connect.selfDeviceId) {
      Alert.alert(
        strings.connect.leaveJamToSwitchTitle,
        strings.connect.leaveJamToSwitchBody(device.name),
        [
          { text: strings.party.leaveStay, style: 'cancel' },
          {
            text: strings.connect.leaveJamAndSwitch,
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  if (party.party?.is_host) await partySession().end();
                  else await partySession().leave();
                  await onTransfer(device);
                } catch (error) {
                  setActionError(strings.connect.transferFailed(partyErrorDetail(error)));
                }
              })();
            },
          },
        ],
      );
      return;
    }
    void onTransfer(device).catch((error: unknown) => {
      setActionError(strings.connect.transferFailed(partyErrorDetail(error)));
    });
  };

  const handleStartJam = () => {
    if (startingJam) return;
    setStartingJam(true);
    setActionError(null);
    void onStartJam()
      .catch((error: unknown) => {
        setActionError(strings.party.startPartyFailed(partyErrorDetail(error)));
      })
      .finally(() => setStartingJam(false));
  };

  const handleJoinCode = () => {
    const normalized = normalizePartyCode(joinCode);
    if (normalized === null) {
      setActionError(strings.party.joinInvalidCode);
      return;
    }
    setActionError(null);
    setJoinCode('');
    onClose();
    onOpenParty(normalized);
  };

  const handleSaveName = () => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setActionError(strings.connect.deviceNameEmpty);
      return;
    }
    setSavingName(true);
    setActionError(null);
    void onRenameDevice(trimmed)
      .then(() => setRenameOpen(false))
      .catch((error: unknown) => {
        setActionError(strings.connect.deviceNameFailed(partyErrorDetail(error)));
      })
      .finally(() => setSavingName(false));
  };

  const handleToggleSync = () => {
    if (togglingSync) return;
    setTogglingSync(true);
    setActionError(null);
    void onToggleConnectEnabled(!connect.enabled)
      .catch((error: unknown) => {
        setActionError(strings.connect.connectionFailed(partyErrorDetail(error)));
      })
      .finally(() => setTogglingSync(false));
  };

  const statusText =
    connect.phase === 'disabled'
      ? strings.connect.syncDisabledNotice
      : connect.phase === 'offline'
        ? strings.connect.disconnected
        : connect.phase === 'connecting'
          ? strings.connect.connecting
          : connect.phase === 'reconnecting'
            ? strings.connect.reconnecting
            : connect.phase === 'connected'
              ? strings.connect.connected(devices.length)
              : strings.connect.disconnected;

  return (
    <ScrollView
      testID="device-picker-scroll"
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            connect.phase === 'connected'
              ? styles.statusDotConnected
              : connect.phase === 'error'
                ? styles.statusDotError
                : styles.statusDotMuted,
          ]}
        />
        <AppText variant="caption" color="secondary" style={styles.flexOne}>
          {statusText}
        </AppText>
        <IconButton
          testID="device-picker-close"
          icon="close"
          size="sm"
          accessibilityLabel={strings.connect.closeSheet}
          onPress={onClose}
        />
      </View>

      {connect.phase === 'disabled' ? (
        <View testID="device-picker-disabled" style={styles.noticeBox}>
          <AppText variant="callout" color="secondary">
            {strings.connect.syncDisabledNotice}
          </AppText>
          <ActionButton
            testID="device-picker-enable-sync"
            label={strings.connect.enableSync}
            variant="primary"
            busy={togglingSync}
            disabled={togglingSync}
            onPress={handleToggleSync}
          />
        </View>
      ) : null}

      {connect.error !== null ? (
        <View testID="device-picker-connect-error" accessibilityRole="alert" style={styles.errorBox}>
          <AppText variant="callout" color="danger" style={styles.flexOne}>
            {connect.error}
          </AppText>
          <ActionButton
            testID="device-picker-retry"
            label={strings.connect.retry}
            variant="secondary"
            onPress={onRetryConnect}
          />
        </View>
      ) : null}

      {actionError !== null ? (
        <View testID="device-picker-action-error" accessibilityRole="alert" style={styles.errorBox}>
          <AppText variant="callout" color="danger">{actionError}</AppText>
        </View>
      ) : null}

      {activeDevice !== null ? (
        <View testID="device-picker-active-card" style={styles.activeCard}>
          <View style={styles.activeCardHeader}>
            <AppIcon
              name={deviceTypeIcon(activeDevice.device_type)}
              size={26}
              color={colors.accent}
            />
            <View style={styles.deviceCopy}>
              <AppText variant="overline" color="accent">
                {activeIsSelf ? strings.connect.thisDevice : strings.connect.activeDevice}
              </AppText>
              <AppText variant="bodyStrong" color="primary" numberOfLines={1}>
                {activeDevice.name}
              </AppText>
              <AppText variant="caption" color="secondary">
                {deviceTypeLabel(activeDevice.device_type)}
              </AppText>
            </View>
            <MemoEqualizerBars
              testID="device-picker-active-eq"
              isPlaying={isActivePlaying}
            />
          </View>

          {canAdjustRemoteVolume ? (
            <View testID="device-picker-volume" style={styles.volumeRow}>
              <IconButton
                testID="device-picker-mute"
                icon={activeDevice.muted || displayedVolume === 0 ? 'volume-off' : 'volume-high'}
                size="sm"
                accessibilityLabel={activeDevice.muted ? strings.connect.unmute : strings.connect.mute}
                onPress={() => {
                  setActionError(null);
                  void onSetRemoteMute(!activeDevice.muted).catch((error: unknown) => {
                    setActionError(strings.connect.commandFailed(partyErrorDetail(error)));
                  });
                }}
              />
              <Slider
                testID="device-picker-volume-slider"
                accessibilityLabel={strings.connect.volumeLabel}
                style={styles.volumeSlider}
                minimumValue={0}
                maximumValue={1}
                value={displayedVolume}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.fillStrong}
                thumbTintColor={colors.textPrimary}
                onValueChange={setVolumeDraft}
                onSlidingComplete={(val) => {
                  setVolumeDraft(null);
                  setActionError(null);
                  void onSetRemoteVolume(val).catch((error: unknown) => {
                    setActionError(strings.connect.commandFailed(partyErrorDetail(error)));
                  });
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {connect.enabled ? (
        <View style={styles.section}>
          <AppText variant="overline" color="secondary" style={styles.sectionTitle}>
            {strings.connect.otherDevices}
          </AppText>
          {otherDevices.length === 0 ? (
            <AppText testID="device-picker-no-other" variant="callout" color="muted" style={styles.emptyText}>
              {strings.connect.noOtherDevices}
            </AppText>
          ) : (
            otherDevices.map((device, index) => (
              <DeviceRow
                key={device.device_id}
                device={device}
                isSelf={device.device_id === connect.selfDeviceId}
                transferring={connect.transferringToDeviceId === device.device_id}
                disabled={connect.transferringToDeviceId !== null}
                hasTVPreferredFocus={isTv && index === 0 ? true : undefined}
                onPress={() => handleSelectDevice(device)}
              />
            ))
          )}
        </View>
      ) : null}

      <ListSeparator />

      <View testID="device-picker-jam-section" style={styles.section}>
        <AppText variant="overline" color="secondary" style={styles.sectionTitle}>
          {strings.connect.jamSectionTitle}
        </AppText>
        {party.party !== null ? (
          <View testID="device-picker-active-jam" style={styles.jamCard}>
            <View style={styles.deviceCopy}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {partyDisplayName(party.party)}
              </AppText>
              <AppText variant="caption" color="secondary">
                {party.party.is_host
                  ? strings.party.youAreHost
                  : strings.party.hostedBy(party.party.host_name)}
                {' · '}
                {strings.party.memberCount(party.party.members.length)}
              </AppText>
            </View>
            <ActionButton
              testID="device-picker-open-jam"
              label={strings.connect.openJam}
              variant="primary"
              onPress={() => {
                const code = party.party?.code;
                if (code === undefined) return;
                onClose();
                onOpenParty(code);
              }}
            />
          </View>
        ) : (
          <View style={styles.jamActions}>
            <ActionButton
              testID="device-picker-start-jam"
              icon="account-group-outline"
              label={startingJam ? strings.party.startingParty : strings.connect.startJam}
              variant="primary"
              busy={startingJam}
              disabled={startingJam}
              onPress={handleStartJam}
            />
            <ActionButton
              testID="device-picker-join-jam-toggle"
              icon="key-variant"
              label={strings.connect.joinJam}
              variant="secondary"
              onPress={() => setJoinOpen((prev) => !prev)}
            />
          </View>
        )}

        {joinOpen && party.party === null ? (
          <View testID="device-picker-join-form" style={styles.inlineForm}>
            <TextInput
              testID="device-picker-join-input"
              accessibilityLabel={strings.party.joinCodeLabel}
              value={joinCode}
              onChangeText={(text) => setJoinCode(text.toUpperCase())}
              placeholder={strings.party.joinCodePlaceholder}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              returnKeyType="go"
              onSubmitEditing={handleJoinCode}
              style={[spotifyImportInputStyle, styles.inlineInput]}
            />
            <ActionButton
              testID="device-picker-join-submit"
              label={strings.party.joinSubmit}
              variant="primary"
              onPress={handleJoinCode}
            />
          </View>
        ) : null}
      </View>

      <ListSeparator />

      <View style={styles.footerControls}>
        {renameOpen ? (
          <View testID="device-picker-rename-form" style={styles.inlineForm}>
            <TextInput
              testID="device-picker-rename-input"
              accessibilityLabel={strings.connect.deviceNameLabel}
              value={draftName}
              onChangeText={setDraftName}
              placeholder={strings.connect.deviceNamePlaceholder}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={handleSaveName}
              style={[spotifyImportInputStyle, styles.inlineInput]}
            />
            <ActionButton
              testID="device-picker-rename-save"
              label={strings.connect.deviceNameSave}
              variant="secondary"
              busy={savingName}
              disabled={savingName}
              onPress={handleSaveName}
            />
          </View>
        ) : (
          <View style={styles.footerButtonRow}>
            <ActionButton
              testID="device-picker-rename-open"
              icon="pencil-outline"
              label={connect.selfDeviceName || strings.connect.deviceNameLabel}
              variant="secondary"
              onPress={() => {
                setDraftName(connect.selfDeviceName);
                setRenameOpen(true);
              }}
            />
            <ActionButton
              testID="device-picker-toggle-sync"
              icon={connect.enabled ? 'lan-connect' : 'lan-disconnect'}
              label={connect.enabled ? strings.connect.syncEnabledLabel : strings.connect.enableSync}
              variant="secondary"
              busy={togglingSync}
              disabled={togglingSync}
              onPress={handleToggleSync}
            />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/** Global bottom-sheet host for the Spotify-like Connect device picker & Jam hub. */
export default function DevicePickerHost({
  onOpenParty,
}: {
  onOpenParty: (code: string) => void;
}) {
  useLocaleRevision();
  const request = useSyncExternalStore(
    subscribeDevicePicker,
    getDevicePickerRequest,
    getDevicePickerRequest,
  );
  const connect = useConnectSession();
  const party = usePartySession();
  const visible = request !== null;
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      wasVisibleRef.current = true;
      if (isTvMode()) tvFocusRegistry.pushCheckpoint('device-picker');
    } else if (!visible && wasVisibleRef.current) {
      wasVisibleRef.current = false;
      if (isTvMode()) tvFocusRegistry.popAndRestore();
    }
  }, [visible]);

  const close = () => dismissDevicePicker(request?.requestId);

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      closeLabel={strings.connect.closeSheet}
      title={strings.connect.connectToDevice}
      testID="device-picker-sheet"
    >
      {request !== null ? (
        <DevicePickerSheetContent
          key={request.requestId}
          connect={connect}
          party={party}
          initialFocus={request.initialFocus}
          onClose={close}
          onOpenParty={onOpenParty}
          onTransfer={(device) =>
            connectSession().transferPlayback(
              device.device_id,
              device.device_id === connect.selfDeviceId ? undefined : undefined,
            )
          }
          onRetryConnect={() => connectSession().retry()}
          onToggleConnectEnabled={(enabled) => connectSession().setEnabled(enabled)}
          onRenameDevice={async (name) => {
            await connectSession().renameDevice(name);
          }}
          onSetRemoteVolume={(volume) =>
            connectSession().sendCommand('set_volume', { volume })
          }
          onSetRemoteMute={(muted) =>
            connectSession().sendCommand('set_mute', { muted })
          }
          onStartJam={async () => {
            const created = await startPartyFromQueue();
            close();
            onOpenParty(created.code);
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: radii.pill },
  statusDotConnected: { backgroundColor: colors.success },
  statusDotError: { backgroundColor: colors.danger },
  statusDotMuted: { backgroundColor: colors.textMuted },
  flexOne: { flex: 1, minWidth: 0 },
  flexShrinkText: { flexShrink: 1, minWidth: 0 },
  noticeBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
    gap: spacing.xs,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSubtle,
  },
  activeCard: {
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.accentSubtle,
    gap: spacing.sm,
  },
  activeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  volumeSlider: { flex: 1, height: metrics.minimumTouchTarget },
  section: { gap: spacing.xs },
  sectionTitle: { paddingHorizontal: spacing.xxs },
  emptyText: { paddingHorizontal: spacing.xxs, paddingVertical: spacing.xs },
  deviceRow: {
    minHeight: metrics.minimumTouchTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  deviceRowActive: { backgroundColor: colors.accentSubtle },
  deviceIconWrap: { width: 32, alignItems: 'center', justifyContent: 'center' },
  deviceCopy: { flex: 1, minWidth: 0, gap: 2 },
  deviceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fillStrong,
    overflow: 'hidden',
  },
  jamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  jamActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  inlineForm: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  inlineInput: { flex: 1, minWidth: 0 },
  footerControls: { gap: spacing.xs },
  footerButtonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
});
