import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartyState } from '../../api/types';
import { strings } from '../../localization';
import { byTestId } from '../../test/render';
import { GuestJamEntry } from './GuestJamEntry';

const mocks = vi.hoisted(() => ({
  joinPartyAsGuest: vi.fn(),
  getGuestPartyState: vi.fn(),
  guestSearchTracks: vi.fn(),
  guestAddPartyTrack: vi.fn(),
  guestLeaveParty: vi.fn(),
  stateSlots: [] as unknown[],
  stateCursor: 0,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useEffect: vi.fn(),
    useState: <T,>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] => {
      const index = mocks.stateCursor++;
      if (!(index in mocks.stateSlots)) {
        mocks.stateSlots[index] = typeof initial === 'function'
          ? (initial as () => T)()
          : initial;
      }
      const setter = (next: T | ((prev: T) => T)) => {
        mocks.stateSlots[index] = typeof next === 'function'
          ? (next as (prev: T) => T)(mocks.stateSlots[index] as T)
          : next;
      };
      return [mocks.stateSlots[index] as T, setter];
    },
  };
});

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  TextInput: 'TextInput',
  View: 'View',
}));

vi.mock('../../api/guestParty', () => ({
  joinPartyAsGuest: mocks.joinPartyAsGuest,
  getGuestPartyState: mocks.getGuestPartyState,
  guestSearchTracks: mocks.guestSearchTracks,
  guestAddPartyTrack: mocks.guestAddPartyTrack,
  guestLeaveParty: mocks.guestLeaveParty,
}));

vi.mock('../../party/partyErrors', () => ({
  partyErrorDetail: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../ui', () => ({
  ActionButton: 'ActionButton',
  AppText: 'AppText',
  Artwork: 'Artwork',
  IconButton: 'IconButton',
}));

function renderEntry(serverUrl = 'https://loggerythm.logge.top') {
  mocks.stateCursor = 0;
  return GuestJamEntry({ serverUrl });
}

const sampleParty: PartyState = {
  code: 'ABC123',
  name: 'Friday Jam',
  host_name: 'Logge',
  is_host: false,
  guests_can_control: false,
  current_index: 0,
  is_playing: true,
  position_sec: 12,
  playback_updated_at: '2026-11-25T18:00:00Z',
  playback_changed_by: 'u:1',
  playback_revision: 1,
  ended: false,
  server_time: '2026-11-25T18:00:01Z',
  members: [{ key: 'g:1', name: 'Alex', avatar_url: null, is_host: false, is_guest: true }],
  tracks: [],
  viewer_key: 'g:1',
  viewer_name: 'Alex',
  viewer_is_guest: true,
};

describe('GuestJamEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateSlots = [];
  });

  it('validates party code and nickname before hitting the network', async () => {
    let tree = renderEntry();
    (byTestId(tree, 'login-guest-jam').props.onPress as () => void)();
    tree = renderEntry();

    await (byTestId(tree, 'guest-jam-submit').props.onPress as () => Promise<void>)();
    tree = renderEntry();
    expect(byTestId(tree, 'guest-jam-error').props.children).toBe(strings.party.joinInvalidCode);
    expect(mocks.joinPartyAsGuest).not.toHaveBeenCalled();

    (byTestId(tree, 'guest-jam-code-input').props.onChangeText as (v: string) => void)('abc123');
    tree = renderEntry();
    await (byTestId(tree, 'guest-jam-submit').props.onPress as () => Promise<void>)();
    tree = renderEntry();
    expect(byTestId(tree, 'guest-jam-error').props.children).toBe(strings.party.guestNicknameRequired);
    expect(mocks.joinPartyAsGuest).not.toHaveBeenCalled();
  });

  it('joins a Jam as a guest and displays the active queue + leave control', async () => {
    mocks.joinPartyAsGuest.mockResolvedValueOnce({
      session: {
        origin: 'https://loggerythm.logge.top',
        code: 'ABC123',
        cookieHeader: 'sf_party_guest=tok123',
      },
      state: sampleParty,
    });
    let tree = renderEntry();
    (byTestId(tree, 'login-guest-jam').props.onPress as () => void)();
    tree = renderEntry();
    (byTestId(tree, 'guest-jam-code-input').props.onChangeText as (v: string) => void)('abc123');
    (byTestId(tree, 'guest-jam-nickname-input').props.onChangeText as (v: string) => void)('Alex');
    tree = renderEntry();

    await (byTestId(tree, 'guest-jam-submit').props.onPress as () => Promise<void>)();
    tree = renderEntry();

    expect(mocks.joinPartyAsGuest).toHaveBeenCalledWith(
      'ABC123',
      'Alex',
      'https://loggerythm.logge.top',
    );
    expect(byTestId(tree, 'guest-jam-queue')).toBeTruthy();
    expect(byTestId(tree, 'guest-jam-leave')).toBeTruthy();

    // Refreshing an ended Jam clears session/party and surfaces endedNotice.
    mocks.getGuestPartyState.mockResolvedValueOnce({ ...sampleParty, ended: true });
    await (byTestId(tree, 'guest-jam-refresh').props.onPress as () => Promise<void>)();
    tree = renderEntry();
    expect(byTestId(tree, 'guest-jam-error').props.children).toBe(strings.party.endedNotice);
    expect(byTestId(tree, 'guest-jam-submit')).toBeTruthy();
  });

  it('clears an active guest session when serverUrl changes', async () => {
    mocks.joinPartyAsGuest.mockResolvedValueOnce({
      session: {
        origin: 'https://loggerythm.logge.top',
        code: 'ABC123',
        cookieHeader: 'sf_party_guest=tok123',
      },
      state: sampleParty,
    });
    let tree = renderEntry('https://loggerythm.logge.top');
    (byTestId(tree, 'login-guest-jam').props.onPress as () => void)();
    tree = renderEntry('https://loggerythm.logge.top');
    (byTestId(tree, 'guest-jam-code-input').props.onChangeText as (v: string) => void)('abc123');
    (byTestId(tree, 'guest-jam-nickname-input').props.onChangeText as (v: string) => void)('Alex');
    tree = renderEntry('https://loggerythm.logge.top');
    await (byTestId(tree, 'guest-jam-submit').props.onPress as () => Promise<void>)();
    tree = renderEntry('https://loggerythm.logge.top');
    expect(byTestId(tree, 'guest-jam-queue')).toBeTruthy();

    // Switching server URL clears the session bound to the previous server.
    renderEntry('https://other.example.test');
    tree = renderEntry('https://other.example.test');
    expect(byTestId(tree, 'guest-jam-submit')).toBeTruthy();
  });
});
