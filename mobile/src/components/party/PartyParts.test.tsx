import { describe, expect, it, vi } from 'vitest';
import type { PartyState, PartyTrack, Track } from '../../api/types';
import { strings } from '../../localization';
import type { TrackPresentationState } from '../../player/trackPresentation';
import { byTestId, elements, queryByTestId, textContent } from '../../test/render';
import {
  PartyLoadBadge,
  PartyMembers,
  PartyNotice,
  PartyNowPlayingCard,
  PartyQueueRow,
  PartySearchResultRow,
  partyTrackPresentation,
} from './PartyParts';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class MockAnimatedValue {
      constructor(public value: number) {}
      interpolate = () => 0;
    },
    View: 'Animated.View',
    loop: () => ({ start: vi.fn(), stop: vi.fn() }),
    sequence: () => ({}),
    timing: () => ({}),
  },
  Easing: {
    inOut: () => () => 0,
    sin: () => 0,
  },
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => true,
  getReducedMotionSnapshot: () => true,
}));
vi.mock('../../tv', () => ({
  isTvMode: () => false,
}));

const entry = (id: number, overrides: Partial<PartyTrack> = {}): PartyTrack => ({
  id,
  deezer_id: String(id * 10),
  title: `Song ${id}`,
  artist: 'Artist',
  artist_id: '1',
  artists: [],
  album: '',
  album_id: '',
  cover: '',
  duration_sec: 100,
  added_by: 'Kim',
  added_by_member: 'u:9',
  added_by_avatar_url: null,
  is_stored: true,
  load_state: 'ready',
  load_error: null,
  ...overrides,
});

const party = (overrides: Partial<PartyState> = {}): PartyState => ({
  code: 'ABC123',
  name: 'Friday',
  host_name: 'Host',
  is_host: false,
  current_index: 0,
  is_playing: true,
  position_sec: 0,
  playback_updated_at: null,
  server_time: '2026-11-24T00:00:00Z',
  guests_can_control: false,
  playback_changed_by: 'u:1',
  playback_revision: 1,
  ended: false,
  members: [
    { key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true },
    { key: 'u:2', name: 'Me', avatar_url: null, is_guest: false, is_host: false },
  ],
  tracks: [entry(1), entry(2, { added_by_member: 'u:2', added_by: 'Me' }), entry(3)],
  viewer_key: 'u:2',
  viewer_name: 'Me',
  viewer_is_guest: false,
  ...overrides,
});

const handlers = () => ({
  onPlay: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  onRemove: vi.fn(),
});

describe('party parts', () => {
  it('gives a member only the removal of their own upcoming song unless guests_can_control is on', () => {
    const own = PartyQueueRow({ party: party(), index: 1, buffering: false, locked: false, ...handlers() });
    expect(queryByTestId(own, 'party-track-2-play')).toBeNull();
    expect(queryByTestId(own, 'party-track-2-up')).toBeNull();
    expect(byTestId(own, 'party-track-2-remove').props.accessibilityLabel).toBe(strings.party.remove('Song 2'));
    expect(textContent(own)).toContain(`Artist · ${strings.party.addedByYou}`);

    const other = PartyQueueRow({ party: party(), index: 2, buffering: false, locked: false, ...handlers() });
    expect(queryByTestId(other, 'party-track-3-remove')).toBeNull();
    expect(textContent(other)).toContain(`Artist · ${strings.party.addedBy('Kim')}`);

    const shared = PartyQueueRow({
      party: party({ guests_can_control: true }),
      index: 2,
      buffering: false,
      locked: false,
      ...handlers(),
    });
    expect(queryByTestId(shared, 'party-track-3-play')).not.toBeNull();
    expect(queryByTestId(shared, 'party-track-3-up')).not.toBeNull();
    expect(queryByTestId(shared, 'party-track-3-remove')).not.toBeNull();
  });

  it('gives the host play, move and remove, bounded by the queue ends and the lock', () => {
    const actions = handlers();
    const first = PartyQueueRow({ party: party({ is_host: true }), index: 0, buffering: false, locked: false, ...actions });
    const play = byTestId(first, 'party-track-1-play');
    expect(play.props).toMatchObject({
      accessibilityLabel: strings.party.playAt('Song 1'),
      accessibilityState: { selected: true, disabled: false },
    });
    (play.props.onPress as () => void)();
    expect(actions.onPlay).toHaveBeenCalledOnce();
    expect(byTestId(first, 'party-track-1-up').props.disabled).toBe(true);
    expect(byTestId(first, 'party-track-1-down').props.disabled).toBe(false);
    expect(textContent(first)).toContain(strings.party.nowPlaying);

    const locked = PartyQueueRow({ party: party({ is_host: true }), index: 1, buffering: false, locked: true, ...handlers() });
    expect(byTestId(locked, 'party-track-2-play').props.disabled).toBe(true);
    expect(byTestId(locked, 'party-track-2-remove').props.disabled).toBe(true);
  });

  it('renders normal TrackStateIndicator icons for stored/downloaded tracks and hides static load badges', () => {
    // Stored on server (no local download) -> cloud-check-outline via TrackStateIndicator; no static PartyLoadBadge.
    const storedRow = PartyQueueRow({
      party: party({
        tracks: [entry(1, { is_stored: true, load_state: 'ready' })],
      }),
      index: 0,
      buffering: false,
      locked: false,
      ...handlers(),
    });
    const storedState = byTestId(storedRow, 'party-track-1-state');
    expect(
      elements(storedState).some(
        (el) => el.type === 'AppIcon' && el.props.name === 'cloud-check-outline',
      ),
    ).toBe(true);
    expect(queryByTestId(storedRow, 'party-load-1')).toBeNull();
    expect(PartyLoadBadge({ entry: entry(1, { load_state: 'ready' }), buffering: false })).toBeNull();
    expect(PartyLoadBadge({ entry: entry(1, { is_stored: false, load_state: 'idle' }), buffering: false })).toBeNull();

    // Device-downloaded track -> renders normal green download-circle icon via TrackStateIndicator.
    const downloadedPresentation: TrackPresentationState = {
      active: false,
      playback: 'inactive',
      serverCache: 'cached',
      rollingDeviceCache: null,
      explicitDownload: { kind: 'downloaded' },
    };
    const downloadedRow = PartyQueueRow({
      party: party({
        tracks: [entry(2, { is_stored: true, load_state: 'ready' })],
      }),
      index: 0,
      buffering: false,
      locked: false,
      presentation: downloadedPresentation,
      ...handlers(),
    });
    const downloadedState = byTestId(downloadedRow, 'party-track-2-state');
    expect(
      elements(downloadedState).some(
        (el) => el.type === 'AppIcon' && el.props.name === 'download-circle',
      ),
    ).toBe(true);
    const merged = partyTrackPresentation(
      entry(2, { is_stored: true, load_state: 'ready' }),
      downloadedPresentation,
      false,
      false,
      false,
    );
    expect(merged.explicitDownload).toEqual({ kind: 'downloaded' });
    expect(merged.serverCache).toBe('cached');

    // Search result row shows TrackStateIndicator (download-circle) and both Play Next + Add buttons.
    const onAdd = vi.fn();
    const onPlayNext = vi.fn();
    const searchTrack: Track = {
      id: '500',
      title: 'Found Song',
      artist: 'Artist',
      artist_id: '1',
      artists: [],
      album: '',
      album_id: '',
      cover: '',
      duration_sec: 120,
      preview_url: null,
      rank: 0,
      release_date: '',
    };
    const searchRow = PartySearchResultRow({
      track: searchTrack,
      locked: false,
      adding: false,
      presentation: downloadedPresentation,
      onAdd,
      onPlayNext,
    });
    const searchState = byTestId(searchRow, 'party-search-result-500-state');
    expect(
      elements(searchState).some(
        (el) => el.type === 'AppIcon' && el.props.name === 'download-circle',
      ),
    ).toBe(true);
    (byTestId(searchRow, 'party-search-result-500-play-next').props.onPress as () => void)();
    (byTestId(searchRow, 'party-search-result-500-add').props.onPress as () => void)();
    expect(onPlayNext).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('shows transient server load states, failure causes, and local buffering', () => {
    expect(byTestId(PartyLoadBadge({ entry: entry(4, { load_state: 'queued' }), buffering: false }), 'party-load-4')
      .props.accessibilityLabel).toBe(strings.party.loadQueued);
    expect(textContent(PartyLoadBadge({
      entry: entry(5, { load_state: 'failed', load_error: 'Deezer 404' }),
      buffering: false,
    }))).toContain(strings.party.loadFailedState('Deezer 404'));
    expect(byTestId(PartyLoadBadge({ entry: entry(6), buffering: true }), 'party-load-6')
      .props.accessibilityLabel).toBe(strings.party.buffering);
  });

  it('renders PartyNowPlayingCard with live controls only when permitted', () => {
    const onTogglePlay = vi.fn();
    const guestCard = PartyNowPlayingCard({
      party: party({ is_host: false, guests_can_control: false }),
      buffering: false,
      locked: false,
      onPrev: vi.fn(),
      onTogglePlay,
      onNext: vi.fn(),
    });
    expect(queryByTestId(guestCard, 'party-now-playing-controls')).toBeNull();
    expect(textContent(guestCard)).toContain(strings.party.controlledByHost('Host'));

    const sharedCard = PartyNowPlayingCard({
      party: party({ is_host: false, guests_can_control: true }),
      buffering: false,
      locked: false,
      onPrev: vi.fn(),
      onTogglePlay,
      onNext: vi.fn(),
    });
    (byTestId(sharedCard, 'party-now-playing-toggle').props.onPress as () => void)();
    expect(onTogglePlay).toHaveBeenCalledOnce();
    expect(elements(sharedCard).some((el) => el.props.testID === 'party-now-playing-state-1')).toBe(true);
  });

  it('marks host strictly via member.is_host so display-name collisions still expose Kick', () => {
    const onKick = vi.fn();
    const rendered = PartyMembers({
      isHost: true,
      onKick,
      members: [
        { key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true },
        { key: 'g:1', name: 'Sam', avatar_url: null, is_guest: true, is_host: false },
        { key: 'g:2', name: 'Host', avatar_url: null, is_guest: true, is_host: false },
      ],
    });
    expect(textContent(rendered)).toEqual(expect.arrayContaining([
      'Host', strings.party.hostBadge, 'Sam', strings.party.guestBadge,
    ]));
    expect(queryByTestId(rendered, 'party-member-kick-u:1')).toBeNull();
    (byTestId(rendered, 'party-member-kick-g:1').props.onPress as () => void)();
    expect(onKick).toHaveBeenCalledWith(expect.objectContaining({ key: 'g:1', name: 'Sam' }));
    (byTestId(rendered, 'party-member-kick-g:2').props.onPress as () => void)();
    expect(onKick).toHaveBeenCalledWith(expect.objectContaining({ key: 'g:2', name: 'Host' }));
  });

  it('renders danger notices as alerts and requires complete actions', () => {
    const onAction = vi.fn();
    const notice = PartyNotice({ testID: 'n', tone: 'danger', message: 'kaputt', actionLabel: 'Neu', onAction });
    expect(byTestId(notice, 'n').props.accessibilityRole).toBe('alert');
    (byTestId(notice, 'n-action').props.onPress as () => void)();
    expect(onAction).toHaveBeenCalledOnce();
    expect(() => PartyNotice({ testID: 'n', tone: 'info', message: 'x', actionLabel: 'Neu' })).toThrow(
      /both a label and callback/,
    );
  });
});
