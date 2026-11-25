import { describe, expect, it, vi } from 'vitest';
import { byTestId, textContent } from '../../test/render';
import { PlaylistDuplicatesView } from './PlaylistDuplicatesSheet';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock('../../data', () => ({
  musicQueries: { playlistDuplicates: vi.fn() },
  musicRepository: { deduplicatePlaylist: vi.fn() },
  queryKeys: { playlists: { detail: vi.fn(), duplicates: vi.fn(), owned: vi.fn() } },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('PlaylistDuplicatesView', () => {
  it('renders duplicate groups and confirms deduplication', () => {
    const onDeduplicate = vi.fn();
    const tree = PlaylistDuplicatesView({
      data: {
        playlist_id: 9,
        total_duplicates: 2,
        groups: [
          {
            keep_entry_id: 101,
            duplicate_entry_ids: [102, 103],
            title: 'Midnight Signal',
            artist: 'Neon Pulse',
            isrc: 'USRC17607839',
          },
        ],
      },
      isPending: false,
      isError: false,
      deduplicating: false,
      dedupeError: null,
      removedCount: null,
      onRetry: vi.fn(),
      onDeduplicate,
      onClose: vi.fn(),
    });

    expect(textContent(byTestId(tree, 'playlist-dup-group-101')).join(' ')).toContain('Midnight Signal');
    (byTestId(tree, 'playlist-duplicates-confirm').props.onPress as () => void)();
    expect(onDeduplicate).toHaveBeenCalledOnce();
  });
});
