import { describe, expect, it, vi } from 'vitest';
import type { ConnectDevice, ConnectState } from '../../api/types';
import { IDLE_CONNECT_SNAPSHOT, type ConnectSessionSnapshot } from '../../connect/connectModel';
import type { PartySessionSnapshot } from '../../party/partySession';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import { DevicePickerSheetContent } from './DevicePickerSheet';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T | (() => T)) => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../TrackStateIndicator', () => ({ MemoEqualizerBars: 'MemoEqualizerBars' }));
vi.mock('../library/useKeyboardInset', () => ({ useKeyboardInset: () => 301 }));
vi.mock('../search/SpotifyImportForm', () => ({ spotifyImportInputStyle: {} }));
vi.mock('../../tv', () => ({ isTvMode: () => false, tvFocusRegistry: { pushCheckpoint: vi.fn(), popAndRestore: vi.fn() } }));
vi.mock('../../connect/connectRuntime', () => ({ connectSession: vi.fn(), useConnectSession: vi.fn() }));
vi.mock('../../party/partyErrors', () => ({ partyErrorDetail: (e: unknown) => String(e) }));
vi.mock('../../party/partyRuntime', () => ({ partySession: vi.fn(), startPartyFromQueue: vi.fn(), usePartySession: vi.fn() }));
vi.mock('../../localization/LocaleProvider', () => ({ useLocaleRevision: () => 0 }));

const webDevice: ConnectDevice = {
  device_id: 'web-1',
  name: 'MacBook Chrome',
  device_type: 'web',
  capabilities: { can_play_audio: true, can_control_volume: true },
  volume: 0.7,
  muted: false,
  is_active: true,
  party_code: null,
  connected_at: '2026-11-24T00:00:00Z',
  last_seen_at: '2026-11-24T00:00:01Z',
};

const phoneDevice: ConnectDevice = {
  device_id: 'phone-1',
  name: 'Pixel 9',
  device_type: 'mobile',
  capabilities: { can_play_audio: true, can_control_volume: false },
  volume: 1,
  muted: false,
  is_active: false,
  party_code: null,
  connected_at: '2026-11-24T00:00:00Z',
  last_seen_at: '2026-11-24T00:00:01Z',
};

const emptyParty: PartySessionSnapshot = {
  code: null,
  party: null,
  phase: 'idle',
  error: null,
  detached: false,
  controlOnly: false,
  playbackError: null,
  endedNotice: null,
};

function makeState(devices: ConnectDevice[], activeId: string): ConnectState {
  return {
    revision: 1,
    active_device_id: activeId,
    devices,
    playback: {
      queue: [],
      origins: [],
      queue_context: null,
      current_index: -1,
      is_playing: false,
      position_sec: 0,
      duration_sec: 0,
      shuffle: false,
      repeat: 'off',
      volume: 0.7,
      muted: false,
      updated_at: null,
    },
    server_time: '2026-11-24T00:00:01Z',
  };
}

describe('DevicePickerSheetContent', () => {
  it('keeps the Jam code and device name fields above the keyboard', () => {
    const tree = DevicePickerSheetContent({
      connect: IDLE_CONNECT_SNAPSHOT,
      party: { party: null, detached: false } as unknown as PartySessionSnapshot,
      initialFocus: 'jam',
      onClose: vi.fn(),
      onOpenParty: vi.fn(),
      onTransfer: vi.fn(),
      onRetryConnect: vi.fn(),
      onToggleConnectEnabled: vi.fn(),
      onRenameDevice: vi.fn(),
      onSetRemoteVolume: vi.fn(),
      onSetRemoteMute: vi.fn(),
      onStartJam: vi.fn(),
      onResumePersisted: vi.fn(),
    });

    // The sheet is not resized by the keyboard: the spacer is what lifts the fields.
    expect(byTestId(tree, 'device-picker-keyboard-spacer').props.style).toEqual({ height: 301 });
  });

  it('shows active remote device with volume slider and allows transferring to another device', () => {
    const onTransfer = vi.fn(async () => undefined);
    const connect: ConnectSessionSnapshot = {
      ...IDLE_CONNECT_SNAPSHOT,
      phase: 'connected',
      enabled: true,
      selfDeviceId: 'phone-1',
      selfDeviceName: 'Pixel 9',
      selfDeviceType: 'mobile',
      state: makeState([webDevice, phoneDevice], 'web-1'),
      activeDevice: webDevice,
      isSelfActive: false,
      isControllingRemote: true,
    };

    const tree = DevicePickerSheetContent({
      connect,
      party: emptyParty,
      initialFocus: 'devices',
      onClose: vi.fn(),
      onOpenParty: vi.fn(),
      onTransfer,
      onRetryConnect: vi.fn(),
      onToggleConnectEnabled: vi.fn(async () => undefined),
      onRenameDevice: vi.fn(async () => undefined),
      onSetRemoteVolume: vi.fn(async () => undefined),
      onSetRemoteMute: vi.fn(async () => undefined),
      onStartJam: vi.fn(async () => undefined),
    });

    expect(textContent(byTestId(tree, 'device-picker-active-card'))).toContain('MacBook Chrome');
    expect(queryByTestId(tree, 'device-picker-volume')).not.toBeNull();
    const selfRow = byTestId(tree, 'device-picker-item-phone-1');
    (selfRow.props.onPress as () => void)();
    expect(onTransfer).toHaveBeenCalledWith(phoneDevice);
  });

  it('hides remote volume slider when controlling a device without remote volume support and shows WS errors loudly', () => {
    const tvNoVol: ConnectDevice = {
      ...phoneDevice,
      device_id: 'tv-1',
      name: 'Living Room TV',
      device_type: 'tv',
      is_active: true,
    };
    const connect: ConnectSessionSnapshot = {
      ...IDLE_CONNECT_SNAPSHOT,
      phase: 'error',
      enabled: true,
      selfDeviceId: 'phone-1',
      selfDeviceName: 'Pixel 9',
      selfDeviceType: 'mobile',
      state: makeState([tvNoVol, phoneDevice], 'tv-1'),
      activeDevice: tvNoVol,
      isSelfActive: false,
      isControllingRemote: true,
      error: 'Device connection failed: WS 4401',
    };

    const onRetryConnect = vi.fn();
    const tree = DevicePickerSheetContent({
      connect,
      party: emptyParty,
      initialFocus: 'devices',
      onClose: vi.fn(),
      onOpenParty: vi.fn(),
      onTransfer: vi.fn(async () => undefined),
      onRetryConnect,
      onToggleConnectEnabled: vi.fn(async () => undefined),
      onRenameDevice: vi.fn(async () => undefined),
      onSetRemoteVolume: vi.fn(async () => undefined),
      onSetRemoteMute: vi.fn(async () => undefined),
      onStartJam: vi.fn(async () => undefined),
    });

    expect(queryByTestId(tree, 'device-picker-volume')).toBeNull();
    expect(textContent(byTestId(tree, 'device-picker-connect-error')).join(' ')).toContain('WS 4401');
    (byTestId(tree, 'device-picker-retry').props.onPress as () => void)();
    expect(onRetryConnect).toHaveBeenCalledOnce();
  });
});
