import { describe, expect, it } from 'vitest';
import type { PartyState, PartyTrack } from '../api/types';
import { strings } from '../localization';
import {
  canRemovePartyTrack,
  expectedHostPosition,
  movedPartyIds,
  normalizePartyCode,
  partyDisplayName,
  partyInviteUrl,
  partyLoadLabel,
} from './partyModel';

const entry = (id: number, member: string): PartyTrack => ({
  id,
  deezer_id: String(id),
  title: `Song ${id}`,
  artist: 'A',
  artist_id: '1',
  artists: [],
  album: '',
  album_id: '',
  cover: '',
  duration_sec: 100,
  added_by: 'X',
  added_by_member: member,
  load_state: 'idle',
  load_error: null,
});

const state = (overrides: Partial<PartyState> = {}): PartyState => ({
  code: 'ABC123',
  name: '',
  host_name: 'Host',
  is_host: false,
  current_index: 0,
  is_playing: true,
  position_sec: 20,
  playback_updated_at: '2026-11-20T12:00:00Z',
  members: [],
  tracks: [entry(1, 'u:2'), entry(2, 'u:2'), entry(3, 'u:9')],
  viewer_key: 'u:2',
  viewer_name: 'Me',
  viewer_is_guest: false,
  ...overrides,
});

describe('party model', () => {
  it('accepts only six-character codes, case-insensitively', () => {
    expect(normalizePartyCode(' abc123 ')).toBe('ABC123');
    expect(normalizePartyCode('ABC12')).toBeNull();
    expect(normalizePartyCode('ABC-123')).toBeNull();
    expect(normalizePartyCode(42)).toBeNull();
    expect(partyInviteUrl('https://music.test', 'ABC123')).toBe('https://music.test/party/ABC123');
    expect(partyDisplayName(state())).toBe(strings.party.defaultName);
  });

  it('extrapolates the host position only while playing', () => {
    const now = Date.parse('2026-11-20T12:00:03.5Z');
    expect(expectedHostPosition(state(), now)).toBe(23.5);
    expect(expectedHostPosition(state({ is_playing: false }), now)).toBe(20);
    expect(() => expectedHostPosition(state({ playback_updated_at: 'nope' }), now)).toThrow(/not a date/);
  });

  it('lets members remove only their own upcoming additions; the host removes anything', () => {
    expect(canRemovePartyTrack(state(), 0)).toBe(false); // own, but playing now
    expect(canRemovePartyTrack(state(), 1)).toBe(true);
    expect(canRemovePartyTrack(state(), 2)).toBe(false);
    expect(canRemovePartyTrack(state({ is_host: true }), 0)).toBe(true);
    expect(canRemovePartyTrack(state(), 7)).toBe(false);
  });

  it('labels load states and requires a cause for failures', () => {
    expect(partyLoadLabel({ load_state: 'queued', load_error: null })).toBe(strings.party.loadQueued);
    expect(partyLoadLabel({ load_state: 'failed', load_error: 'Deezer 404' })).toBe(
      strings.party.loadFailedState('Deezer 404'),
    );
    expect(() => partyLoadLabel({ load_state: 'failed', load_error: null })).toThrow(/cause/);
  });

  it('moves entry IDs and rejects out-of-range moves', () => {
    expect(movedPartyIds([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(() => movedPartyIds([1, 2, 3], 0, 3)).toThrow(RangeError);
  });
});
