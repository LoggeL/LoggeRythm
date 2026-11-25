import { describe, expect, it, vi } from 'vitest';
import type { PartyState } from '../../api/types';
import { byTestId, textContent } from '../../test/render';
import { buildCodeMatrix, PartyKioskContent } from './PartyKioskModal';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: <T,>(factory: () => T) => factory(),
}));
vi.mock('react-native', () => ({
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 1080, height: 720 }),
}));
vi.mock('../player/LyricsPanel', () => ({ LiveLyricsPanel: 'LiveLyricsPanel' }));
vi.mock('../player/NowPlayingArtwork', () => ({
  MemoNowPlayingArtwork: 'MemoNowPlayingArtwork',
  MemoNowPlayingBackdrop: 'MemoNowPlayingBackdrop',
}));
vi.mock('../player/VisualizerStage', () => ({ VisualizerStage: 'VisualizerStage' }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const sampleParty: PartyState = {
  code: 'JAM999',
  name: 'Friday Loft',
  host_name: 'Alex',
  is_host: true,
  current_index: 0,
  is_playing: true,
  position_sec: 42,
  playback_updated_at: '2026-11-25T00:00:00Z',
  server_time: '2026-11-25T00:00:01Z',
  guests_can_control: true,
  auto_dj: true,
  skip_votes: ['u:2'],
  skip_votes_needed: 2,
  latest_reaction: {
    id: 'r1',
    emoji: '🔥',
    member_key: 'u:2',
    member_name: 'Sam',
    created_at: '2026-11-25T00:00:01Z',
  },
  playback_changed_by: 'Alex',
  playback_revision: 3,
  ended: false,
  members: [],
  tracks: [
    {
      id: 1,
      deezer_id: '101',
      title: 'Midnight Signal',
      artist: 'Neon Pulse',
      artist_id: '10',
      artists: [{ id: '10', name: 'Neon Pulse' }],
      album: 'Loft',
      album_id: '20',
      cover: 'https://img.example/1.jpg',
      duration_sec: 210,
      added_by: 'Sam',
      added_by_member: 'u:2',
      added_by_avatar_url: null,
      load_state: 'ready',
      load_error: null,
      is_stored: true,
    },
    {
      id: 2,
      deezer_id: '102',
      title: 'Afterglow',
      artist: 'Signal Wave',
      artist_id: '11',
      artists: [{ id: '11', name: 'Signal Wave' }],
      album: 'Loft',
      album_id: '21',
      cover: 'https://img.example/2.jpg',
      duration_sec: 195,
      added_by: 'Alex',
      added_by_member: 'u:1',
      added_by_avatar_url: null,
      load_state: 'ready',
      load_error: null,
      is_stored: true,
    },
  ],
  viewer_key: 'u:1',
  viewer_name: 'Alex',
  viewer_is_guest: false,
};

describe('PartyKioskModal', () => {
  it('generates a deterministic scannable ISO/IEC 18004 QR matrix with 7x7 finder patterns', () => {
    const url = 'https://music.example/party/JAM999';
    const a = buildCodeMatrix(url);
    const b = buildCodeMatrix(url);
    expect(a).toEqual(b);
    const size = a.length;
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 21) % 4).toBe(0);
    expect(a.every((row) => row.length === size)).toBe(true);
    // Top-left 7x7 finder pattern border and 3x3 dark core.
    for (let i = 0; i < 7; i += 1) {
      expect(a[0][i]).toBe(true);
      expect(a[6][i]).toBe(true);
      expect(a[i][0]).toBe(true);
      expect(a[i][6]).toBe(true);
    }
    expect(a[3][3]).toBe(true);
    expect(a[1][1]).toBe(false);
  });

  it('renders active track attribution, join code, QR matrix, latest reaction, visualizer, and up next', () => {
    const tree = PartyKioskContent({
      party: sampleParty,
      joinUrl: 'https://music.example/party/JAM999',
      onClose: vi.fn(),
    });
    expect(byTestId(tree, 'party-kiosk-qr')).toBeDefined();
    expect(textContent(byTestId(tree, 'party-kiosk-code')).join('')).toBe('JAM999');
    expect(textContent(byTestId(tree, 'party-kiosk-added-by')).join(' ')).toContain('Sam');
    expect(textContent(byTestId(tree, 'party-kiosk-reaction')).join(' ')).toContain('🔥');
    expect(textContent(byTestId(tree, 'party-kiosk-up-next')).join(' ')).toContain('Afterglow');
  });
});
