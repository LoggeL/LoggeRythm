import { describe, expect, it, vi } from 'vitest';
import type { PartyState, PartyTrack } from '../../api/types';
import { strings } from '../../localization';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import { PartyLoadBadge, PartyMembers, PartyNotice, PartyQueueRow } from './PartyParts';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

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
  members: [],
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
  it('gives a member only the removal of their own upcoming song', () => {
    const own = PartyQueueRow({ party: party(), index: 1, buffering: false, locked: false, ...handlers() });
    expect(queryByTestId(own, 'party-track-2-play')).toBeNull();
    expect(queryByTestId(own, 'party-track-2-up')).toBeNull();
    expect(byTestId(own, 'party-track-2-remove').props.accessibilityLabel).toBe(strings.party.remove('Song 2'));
    expect(textContent(own)).toContain(`Artist · ${strings.party.addedByYou}`);

    const other = PartyQueueRow({ party: party(), index: 2, buffering: false, locked: false, ...handlers() });
    expect(queryByTestId(other, 'party-track-3-remove')).toBeNull();
    expect(textContent(other)).toContain(`Artist · ${strings.party.addedBy('Kim')}`);
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

  it('shows the server load state, its failure cause and this device buffering', () => {
    expect(byTestId(PartyLoadBadge({ entry: entry(4, { load_state: 'queued' }), buffering: false }), 'party-load-4')
      .props.accessibilityLabel).toBe(strings.party.loadQueued);
    expect(textContent(PartyLoadBadge({
      entry: entry(5, { load_state: 'failed', load_error: 'Deezer 404' }),
      buffering: false,
    }))).toContain(strings.party.loadFailedState('Deezer 404'));
    expect(byTestId(PartyLoadBadge({ entry: entry(6), buffering: true }), 'party-load-6')
      .props.accessibilityLabel).toBe(strings.party.buffering);
  });

  it('marks host and guests among the members', () => {
    const rendered = PartyMembers({
      hostName: 'Host',
      members: [
        { name: 'Host', avatar_url: null, is_guest: false },
        { name: 'Sam', avatar_url: null, is_guest: true },
      ],
    });
    expect(textContent(rendered)).toEqual(expect.arrayContaining([
      'Host', strings.party.hostBadge, 'Sam', strings.party.guestBadge,
    ]));
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
