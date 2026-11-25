import { describe, expect, it, vi } from 'vitest';
import type { FriendActivityItem } from '../../api/types';
import { byTestId, textContent } from '../../test/render';
import { FriendsListeningView } from './FriendsListeningSection';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('../../config', () => ({ getCurrentApiBase: () => 'https://music.example' }));
vi.mock('../../connectivity/store', () => ({
  getConnectivitySnapshot: () => ({ status: 'online', showRecovery: false }),
  subscribeConnectivity: () => () => undefined,
}));
vi.mock('../../data', () => ({
  musicQueries: { socialActivity: vi.fn() },
  queryKeys: { social: { activity: vi.fn() } },
}));
vi.mock('../../hooks/useHaptics', () => ({
  triggerHaptic: vi.fn(),
  useHaptics: () => ({ trigger: vi.fn() }),
}));
vi.mock('../../player/controller', () => ({ playTrackRow: vi.fn() }));
vi.mock('../../player/errors', () => ({ reportPlayerError: vi.fn() }));
vi.mock('../../social/socialActivityStream', () => ({ openSocialActivityStream: vi.fn() }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const activeFriend: FriendActivityItem = {
  user_id: 7,
  display_name: 'Mira',
  avatar_url: null,
  is_playing: true,
  track: {
    id: '555',
    title: 'Neon Drift',
    artist: 'Pulse',
    artist_id: '1',
    artists: [{ id: '1', name: 'Pulse' }],
    album: 'Drift',
    album_id: '2',
    cover: '',
    duration_sec: 200,
    preview_url: null,
    rank: 0,
    release_date: '2026-01-01',
  },
  device_name: 'Pixel 9',
  device_type: 'mobile',
  party_code: 'ABC123',
  updated_at: '2026-11-25T18:00:00Z',
};

describe('FriendsListeningView', () => {
  it('renders active friends, triggers playback on track tap, and joins active Jam', () => {
    const onPlayTrack = vi.fn();
    const onJoinJam = vi.fn();
    const tree = FriendsListeningView({
      items: [activeFriend],
      apiBase: 'https://music.example',
      streamError: null,
      onPlayTrack,
      onJoinJam,
    });

    expect(textContent(byTestId(tree, 'friend-activity-7')).join(' ')).toContain('Mira');
    (byTestId(tree, 'friend-play-7').props.onPress as () => void)();
    expect(onPlayTrack).toHaveBeenCalledWith(activeFriend.track);

    (byTestId(tree, 'friend-join-jam-ABC123').props.onPress as () => void)();
    expect(onJoinJam).toHaveBeenCalledWith('ABC123');
  });
});
